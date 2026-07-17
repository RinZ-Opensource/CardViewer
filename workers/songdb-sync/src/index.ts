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

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function putData(env: Env, game: Game, bytes: ArrayBuffer, sha256: string): Promise<void> {
  await env.SONGDB.put(dataKey(game), bytes, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { sha256, syncedAt: new Date().toISOString() },
  });
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
    const bytes = await origin.arrayBuffer();
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
