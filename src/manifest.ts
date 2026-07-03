import { STATIC_MANIFEST_URL } from "./constants";
import { CardRecord, OnlineManifestIndex, OnlineManifestShard, ScanResult } from "./types";

// Cap concurrent shard fetches and bound each request, so a many-shard manifest
// can't open hundreds of connections or hang on a stalled response.
export const SHARD_FETCH_CONCURRENCY = 6;
export const SHARD_FETCH_TIMEOUT_MS = 30_000;

export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new Error(`${url} unavailable: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = SHARD_FETCH_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchJson<T>(url, controller.signal);
  } finally {
    clearTimeout(timer);
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

export function siblingManifestUrl(manifestUrl: string, fileName: string) {
  const base = typeof window === "undefined" ? "http://localhost/" : window.location.href;
  const url = new URL(manifestUrl, base);
  url.pathname = url.pathname.replace(/[^/]*$/, fileName);
  return url.toString();
}

export function resolveManifestHref(href: string, manifestUrl: string) {
  const base = typeof window === "undefined" ? "http://localhost/" : manifestUrl;
  return new URL(href, base).toString();
}

export function scanResultFromIndex(index: OnlineManifestIndex, cards: CardRecord[]): ScanResult {
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
  const indexUrl = STATIC_MANIFEST_URL.endsWith("cards.index.json")
    ? STATIC_MANIFEST_URL
    : siblingManifestUrl(STATIC_MANIFEST_URL, "cards.index.json");
  try {
    const index = await fetchJson<OnlineManifestIndex>(indexUrl);
    if (!index.shards.length) return scanResultFromIndex(index, []);

    // Fetch all shards concurrently (capped by mapWithConcurrency); the first
    // drives an early partial render, and order is preserved for a stable merge.
    const shardResults = await mapWithConcurrency(
      index.shards,
      SHARD_FETCH_CONCURRENCY,
      async (shard, i) => {
        const result = await fetchJsonWithTimeout<OnlineManifestShard>(
          resolveManifestHref(shard.href, indexUrl),
        );
        if (i === 0) {
          onPartial?.(scanResultFromIndex(index, result.cards), result.cards.length, index.totalCards);
        }
        return result;
      },
    );
    const cards = shardResults.flatMap((shard) => shard.cards);
    return scanResultFromIndex(index, cards);
  } catch (err) {
    // Fall back to a single legacy (non-sharded) manifest, but surface the
    // original error so real failures aren't silently masked by the fallback.
    console.warn("Sharded manifest load failed; trying legacy manifest", err);
    return fetchJson<ScanResult>(STATIC_MANIFEST_URL);
  }
}

