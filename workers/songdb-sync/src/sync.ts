import { GAMES, dataKey, dataOriginUrl, type Env, type Game } from "./config.ts";
import { readValidatedData } from "./metadata.ts";

const DEFAULT_ORIGIN_TIMEOUT_MS = 20_000;

export interface SyncOptions {
  /** Override exists for deterministic tests; production uses the bounded default. */
  originTimeoutMs?: number;
}

export interface SyncResult {
  game: Game;
  result: "updated" | "unchanged" | `error: ${string}`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function putData(
  env: Env,
  game: Game,
  bytes: Uint8Array,
  sha256: string,
  rowCount: number,
): Promise<void> {
  await env.SONGDB.put(dataKey(game), bytes, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { sha256, rowCount: String(rowCount), syncedAt: new Date().toISOString() },
  });
}

function storedRowCount(object: R2Object | null): number | undefined {
  const value = Number(object?.customMetadata?.rowCount);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** Refresh one game's music-ex.json; the stored sha-256 skips no-op uploads. */
async function syncGame(env: Env, game: Game, timeoutMs: number): Promise<SyncResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort("song metadata origin timed out");
  }, timeoutMs);
  try {
    const origin = await fetch(dataOriginUrl(game), { signal: controller.signal });
    if (!origin.ok) return { game, result: `error: origin HTTP ${origin.status}` };
    const { bytes, rowCount } = await readValidatedData(game, origin);
    // The origin deadline covers headers and the complete body, not hashing or R2.
    clearTimeout(timer);
    if (timedOut) throw new Error(`origin timed out after ${timeoutMs}ms`);
    const sha256 = await sha256Hex(bytes);
    const existing = await env.SONGDB.head(dataKey(game));
    const previousRowCount = storedRowCount(existing);
    if (previousRowCount !== undefined && rowCount < Math.ceil(previousRowCount * 0.75)) {
      throw new Error(
        `origin JSON record count dropped from ${previousRowCount} to ${rowCount}`,
      );
    }
    if (existing?.customMetadata?.sha256 === sha256) {
      if (previousRowCount !== undefined) return { game, result: "unchanged" };
      // Older objects predate rowCount. Rewrite the same validated body once so
      // subsequent syncs can enforce the relative-drop guard.
      await putData(env, game, bytes, sha256, rowCount);
      return { game, result: "updated" };
    }
    await putData(env, game, bytes, sha256, rowCount);
    return { game, result: "updated" };
  } catch (error) {
    const message = timedOut
      ? `origin timed out after ${timeoutMs}ms`
      : error instanceof Error
        ? error.message
        : String(error);
    return { game, result: `error: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}

export function syncAll(env: Env, options: SyncOptions = {}): Promise<SyncResult[]> {
  const timeoutMs = options.originTimeoutMs ?? DEFAULT_ORIGIN_TIMEOUT_MS;
  return Promise.all(GAMES.map((game) => syncGame(env, game, timeoutMs)));
}

export function failedSyncs(results: readonly SyncResult[]): SyncResult[] {
  return results.filter(({ result }) => result.startsWith("error: "));
}

/** Manual callers can distinguish complete, partial, and total failure. */
export function syncHttpStatus(results: readonly SyncResult[]): 200 | 207 | 502 {
  const failures = failedSyncs(results).length;
  if (failures === 0) return 200;
  return failures === results.length ? 502 : 207;
}
