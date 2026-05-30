import { STATIC_MANIFEST_URL } from "./constants";
import { CardRecord, OnlineManifestIndex, OnlineManifestShard, ScanResult } from "./types";

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} unavailable: ${response.status}`);
  }
  return (await response.json()) as T;
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
    const firstShard = index.shards[0];
    if (!firstShard) return scanResultFromIndex(index, []);

    const first = await fetchJson<OnlineManifestShard>(
      resolveManifestHref(firstShard.href, indexUrl),
    );
    let cards = first.cards;
    onPartial?.(scanResultFromIndex(index, cards), cards.length, index.totalCards);

    const remaining = await Promise.all(
      index.shards.slice(1).map((shard) =>
        fetchJson<OnlineManifestShard>(resolveManifestHref(shard.href, indexUrl)),
      ),
    );
    cards = [first, ...remaining].flatMap((shard) => shard.cards);
    return scanResultFromIndex(index, cards);
  } catch {
    return fetchJson<ScanResult>(STATIC_MANIFEST_URL);
  }
}

