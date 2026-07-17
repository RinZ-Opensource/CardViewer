import { STATIC_MANIFEST_URL } from "./constants";
import { resolveManifestShardUrl } from "./manifestUrl";
import { CardRecord, OnlineManifestIndex, OnlineManifestShard, ScanResult } from "./types";

// Cap concurrent shard fetches and bound each request, so a many-shard manifest
// can't open hundreds of connections or hang on a stalled response.
const SHARD_FETCH_CONCURRENCY = 6;
const MANIFEST_FETCH_TIMEOUT_MS = 30_000;

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new Error(`${url} unavailable: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function fetchJsonWithTimeout<T>(
  url: string,
  timeoutMs = MANIFEST_FETCH_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", abortFromParent, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetchJson<T>(url, controller.signal);
  } catch (err) {
    if (timedOut) {
      throw new Error(`${url} timed out after ${timeoutMs}ms`, { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromParent);
  }
}

// Runs `task` over `items` with at most `limit` in flight at a time, preserving
// input order in the result. Rejects as soon as any task rejects.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  };
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

function siblingManifestUrl(manifestUrl: string, fileName: string) {
  const base = typeof window === "undefined" ? "http://localhost/" : window.location.href;
  const url = new URL(manifestUrl, base);
  url.pathname = url.pathname.replace(/[^/]*$/, fileName);
  return url.toString();
}

function scanResultFromIndex(index: OnlineManifestIndex, cards: CardRecord[]): ScanResult {
  return {
    packageRoot: index.packageRoot,
    streamingAssets: index.streamingAssets,
    cards,
    stats: index.stats,
    warnings: index.warnings,
  };
}

export async function loadStaticScanResult(
  onPartial?: (result: ScanResult, loadedCards: number, totalCards: number) => void,
) {
  const staticPath = STATIC_MANIFEST_URL.split(/[?#]/, 1)[0];
  const staticUrlIsIndex = staticPath.endsWith("cards.index.json");
  const indexUrl = staticUrlIsIndex
    ? STATIC_MANIFEST_URL
    : siblingManifestUrl(STATIC_MANIFEST_URL, "cards.index.json");
  const legacyUrl = staticUrlIsIndex
    ? siblingManifestUrl(STATIC_MANIFEST_URL, "cards.json")
    : STATIC_MANIFEST_URL;
  let acceptPartial = true;
  let shardController: AbortController | null = null;
  try {
    const index = await fetchJsonWithTimeout<OnlineManifestIndex>(indexUrl);
    if (!index.shards.length) return scanResultFromIndex(index, []);

    // Fetch all shards concurrently (capped by mapWithConcurrency); the first
    // drives an early partial render, and order is preserved for a stable merge.
    shardController = new AbortController();
    const shardResults = await mapWithConcurrency(
      index.shards,
      SHARD_FETCH_CONCURRENCY,
      async (shard, i) => {
        let result: OnlineManifestShard;
        try {
          result = await fetchJsonWithTimeout<OnlineManifestShard>(
            resolveManifestShardUrl(
              shard.href,
              indexUrl,
              typeof window === "undefined" ? "http://localhost/" : window.location.href,
            ),
            MANIFEST_FETCH_TIMEOUT_MS,
            shardController?.signal,
          );
        } catch (err) {
          // Stop the other workers immediately. Besides avoiding wasted requests,
          // this prevents shard 0 from publishing a late partial result after the
          // caller has already entered the legacy-manifest fallback.
          shardController?.abort();
          throw err;
        }
        if (i === 0 && acceptPartial && !shardController?.signal.aborted) {
          onPartial?.(scanResultFromIndex(index, result.cards), result.cards.length, index.totalCards);
        }
        return result;
      },
    );
    const cards = shardResults.flatMap((shard) => shard.cards);
    return scanResultFromIndex(index, cards);
  } catch (err) {
    acceptPartial = false;
    shardController?.abort();
    // Fall back to a single legacy (non-sharded) manifest, but surface the
    // original error so real failures aren't silently masked by the fallback.
    console.warn("Sharded manifest load failed; trying legacy manifest", err);
    return fetchJsonWithTimeout<ScanResult>(legacyUrl);
  }
}
