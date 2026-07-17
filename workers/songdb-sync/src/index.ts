/**
 * cardviewer-songdb: synchronizes otoge-db song metadata into R2 and exposes
 * read-only diagnostics for objects already present in the songdb namespace.
 * Browser runtime reads use the same-origin Pages Function instead.
 *
 * Routes (every response carries Access-Control-Allow-Origin: *):
 *   GET  /data/{game}/music-ex.json  R2 only; missing objects return 404.
 *   GET  /jackets/{game}/{file}      R2 only; missing objects return 404.
 *   GET  /hd-jackets/{game}/{file}   R2 only — high-res override tier uploaded
 *                                    out-of-band (scripts/upload-hd-jackets.mjs).
 *   POST /sync                       Bearer SYNC_TOKEN; fetches upstream
 *                                    metadata and writes it to R2.
 *
 * The binding points at the existing CardViewer bucket: every key this worker
 * reads or writes lives under KEY_PREFIX so it coexists with the bucket's
 * other contents (official/generated/...), which it never touches.
 */

export interface Env {
  SONGDB: R2Bucket;
  /** `wrangler secret put SYNC_TOKEN`; guards the manual POST /sync trigger. */
  SYNC_TOKEN?: string;
}

const GAMES = ["maimai", "chunithm", "ongeki"] as const;
type Game = (typeof GAMES)[number];

const OTOGEDB_ROOT = "https://raw.githubusercontent.com/zvuc/otoge-db/master";

/**
 * Current upstream files are below 3 MiB. Keeping the accepted body below
 * 8 MiB leaves room for growth while bounding the stream buffer, decoded
 * string, and parsed object graph well below the Workers memory limit.
 */
const MAX_DATA_BYTES = 8 * 1024 * 1024;

/** GitHub Raw currently varies these MIME types by repository object. */
const DATA_CONTENT_TYPES = new Set([
  "application/json",
  "application/octet-stream",
  "text/json",
  "text/plain",
]);

/** Namespace inside the shared CardViewer bucket; public routes map onto it. */
const KEY_PREFIX = "songdb/";

/** otoge-db jacket names are hashed basenames; anchoring the shape (plus the
    three-game allowlist) confines reads to the intended R2 object namespace. */
const JACKET_FILE = /^[A-Za-z0-9_.-]+\.(png|jpg|jpeg|webp)$/;

/** Metadata can move daily; jackets are content-addressed so effectively immutable. */
const DATA_CACHE = "public, max-age=3600";
const JACKET_CACHE = "public, max-age=2592000, immutable";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type",
  "access-control-max-age": "86400",
};

const REQUIRED_DATA_FIELDS: Record<Game, readonly string[]> = {
  maimai: ["sort", "title", "image_url"],
  chunithm: ["id", "title", "image"],
  ongeki: ["id", "title", "image_url"],
};

function isGame(value: string): value is Game {
  return (GAMES as readonly string[]).includes(value);
}

function contentTypeFor(file: string): string {
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function dataKey(game: Game): string {
  return `${KEY_PREFIX}data/${game}/music-ex.json`;
}

function dataOriginUrl(game: Game): string {
  return `${OTOGEDB_ROOT}/${game}/data/music-ex.json`;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

function r2Response(object: R2ObjectBody, contentType: string, cacheControl: string): Response {
  return new Response(object.body, {
    headers: {
      ...CORS,
      "content-type": contentType,
      "cache-control": cacheControl,
      etag: object.httpEtag,
    },
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function putData(env: Env, game: Game, bytes: Uint8Array, sha256: string): Promise<void> {
  await env.SONGDB.put(dataKey(game), bytes, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { sha256, syncedAt: new Date().toISOString() },
  });
}

function assertDataContentType(response: Response): void {
  const rawContentType = response.headers.get("content-type");
  const contentType = rawContentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (!contentType || !DATA_CONTENT_TYPES.has(contentType)) {
    throw new Error(`unexpected origin content-type ${contentType || "(missing)"}`);
  }
}

function assertDeclaredDataSize(response: Response): void {
  const rawLength = response.headers.get("content-length");
  if (rawLength === null) return;
  if (!/^\d+$/.test(rawLength)) throw new Error("invalid origin content-length");
  const length = Number(rawLength);
  if (!Number.isSafeInteger(length)) throw new Error("invalid origin content-length");
  if (length > MAX_DATA_BYTES) {
    throw new Error(`origin body exceeds ${MAX_DATA_BYTES} bytes`);
  }
}

/** Buffer an upstream body only after applying both declared and actual limits. */
async function readDataBytes(response: Response): Promise<Uint8Array> {
  assertDataContentType(response);
  assertDeclaredDataSize(response);
  if (!response.body) throw new Error("origin body is empty");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_DATA_BYTES) {
        try {
          await reader.cancel("song metadata exceeded the size limit");
        } catch {
          // The size error below is the stable sync result even if cancellation fails.
        }
        throw new Error(`origin body exceeds ${MAX_DATA_BYTES} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Reject a syntactically valid replacement that cannot be consumed by the app. */
function validateData(game: Game, bytes: Uint8Array): void {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new Error("origin body is not valid UTF-8");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("origin body is not valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("origin JSON must be a non-empty top-level array");
  }

  const requiredFields = REQUIRED_DATA_FIELDS[game];
  const invalidIndex = parsed.findIndex(
    (entry) =>
      !isRecord(entry) ||
      Object.values(entry).some((value) => typeof value !== "string") ||
      requiredFields.some((field) => typeof entry[field] !== "string" || entry[field].length === 0),
  );
  if (invalidIndex !== -1) {
    throw new Error(`origin JSON has an invalid ${game} record at index ${invalidIndex}`);
  }
}

interface SyncResult {
  game: Game;
  result: "updated" | "unchanged" | string;
}

/** Refresh one game's music-ex.json; the stored sha-256 skips no-op uploads. */
async function syncGame(env: Env, game: Game): Promise<SyncResult> {
  try {
    const origin = await fetch(dataOriginUrl(game));
    if (!origin.ok) return { game, result: `error: origin HTTP ${origin.status}` };
    const bytes = await readDataBytes(origin);
    validateData(game, bytes);
    const sha256 = await sha256Hex(bytes);
    const existing = await env.SONGDB.head(dataKey(game));
    if (existing?.customMetadata?.sha256 === sha256) return { game, result: "unchanged" };
    await putData(env, game, bytes, sha256);
    return { game, result: "updated" };
  } catch (error) {
    return { game, result: `error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function syncAll(env: Env): Promise<SyncResult[]> {
  return Promise.all(GAMES.map((game) => syncGame(env, game)));
}

async function serveData(env: Env, game: Game): Promise<Response> {
  const object = await env.SONGDB.get(dataKey(game));
  if (!object) return jsonResponse(404, { error: "not found" });
  return r2Response(object, "application/json", DATA_CACHE);
}

async function serveJacket(
  env: Env,
  game: Game,
  file: string,
): Promise<Response> {
  const key = `${KEY_PREFIX}jackets/${game}/${file}`;
  const object = await env.SONGDB.get(key);
  if (!object) return jsonResponse(404, { error: "not found" });
  return r2Response(object, contentTypeFor(file), JACKET_CACHE);
}

/** hd-jackets is R2-only: there is no upstream, so a miss is a plain 404 and
    the app's <img> fallback chain drops to the mirrored jacket. */
async function serveHdJacket(env: Env, game: Game, file: string): Promise<Response> {
  const object = await env.SONGDB.get(`${KEY_PREFIX}hd-jackets/${game}/${file}`);
  if (!object) return jsonResponse(404, { error: "not found" });
  return r2Response(object, contentTypeFor(file), JACKET_CACHE);
}

export default {
  async fetch(request, env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const [root, game, ...rest] = url.pathname.split("/").filter(Boolean);
    // Nested paths re-join with "/" and then fail the JACKET_FILE anchor.
    const file = rest.join("/");

    if (request.method === "POST" && root === "sync" && game === undefined) {
      if (!env.SYNC_TOKEN || request.headers.get("authorization") !== `Bearer ${env.SYNC_TOKEN}`) {
        return jsonResponse(401, { error: "unauthorized" });
      }
      return jsonResponse(200, await syncAll(env));
    }

    if (request.method !== "GET") return jsonResponse(405, { error: "method not allowed" });
    if (!root || !game || !isGame(game)) return jsonResponse(404, { error: "not found" });

    if (root === "data" && file === "music-ex.json") return serveData(env, game);
    if (root === "jackets" && JACKET_FILE.test(file)) return serveJacket(env, game, file);
    if (root === "hd-jackets" && JACKET_FILE.test(file)) return serveHdJacket(env, game, file);
    return jsonResponse(404, { error: "not found" });
  },

  async scheduled(_event, env, ctx): Promise<void> {
    ctx.waitUntil(
      syncAll(env).then((results) => console.log("songdb sync:", JSON.stringify(results))),
    );
  },
} satisfies ExportedHandler<Env>;
