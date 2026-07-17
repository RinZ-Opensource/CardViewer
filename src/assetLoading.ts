export type AssetPathCandidate = {
  key: string;
  path: string;
};

export type OrderedAssetLoadPlan = {
  key: string;
  candidates: AssetPathCandidate[];
};

const FALLBACK_KEY_SUFFIX = "Fallback";

/**
 * Generated card layers are published to R2 as lossless WebP. Keep an
 * explicitly supplied image extension, otherwise map the producer stem onto
 * the canonical WebP object name.
 */
export function r2AssetFileName(stem: string) {
  return /\.(png|jpg|jpeg|webp)$/i.test(stem) ? stem : `${stem}.webp`;
}

/**
 * Collapse a primary layer and its manifest fallback into one ordered request.
 * `visibleAssetLayers` emits the dynamic MAI path first, followed by a layer
 * whose key ends in `Fallback`, so insertion order is also retry order.
 */
export function buildOrderedAssetLoadPlans(
  layers: readonly AssetPathCandidate[],
): OrderedAssetLoadPlan[] {
  const plans = new Map<string, OrderedAssetLoadPlan>();
  for (const layer of layers) {
    const key = layer.key.endsWith(FALLBACK_KEY_SUFFIX)
      ? layer.key.slice(0, -FALLBACK_KEY_SUFFIX.length)
      : layer.key;
    const plan = plans.get(key) ?? { key, candidates: [] };
    if (!plans.has(key)) plans.set(key, plan);
    if (!plan.candidates.some((candidate) => candidate.path === layer.path)) {
      plan.candidates.push(layer);
    }
  }
  return [...plans.values()];
}

/** Try candidates sequentially and return both the winning candidate and value. */
export async function loadFirstAvailable<TCandidate, TValue>(
  candidates: readonly TCandidate[],
  load: (candidate: TCandidate) => Promise<TValue>,
  isCancelled: () => boolean = () => false,
) {
  let lastError: unknown;
  for (const candidate of candidates) {
    if (isCancelled()) throw lastError ?? new Error("Asset load cancelled.");
    try {
      return { candidate, value: await load(candidate) };
    } catch (error) {
      lastError = error;
      if (isCancelled()) throw error;
    }
  }
  throw lastError ?? new Error("No asset candidates were provided.");
}

/**
 * Load keyed catalogs concurrently without making one failed catalog discard
 * every successful sibling.
 */
export async function loadEntriesIndependently<Key extends string, Value>(
  entries: readonly (readonly [Key, string])[],
  load: (file: string, key: Key) => Promise<Value>,
  onFailure?: (key: Key, file: string, error: unknown) => void,
): Promise<Partial<Record<Key, Value>>> {
  const loaded = await Promise.all(
    entries.map(async ([key, file]) => {
      try {
        return [key, await load(file, key)] as const;
      } catch (error) {
        onFailure?.(key, file, error);
        return null;
      }
    }),
  );
  const result: Partial<Record<Key, Value>> = {};
  for (const entry of loaded) {
    if (entry) result[entry[0]] = entry[1];
  }
  return result;
}
