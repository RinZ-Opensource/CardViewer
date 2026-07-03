// A small Map-compatible LRU cache bounded by entry count and/or a byte budget
// (via `sizeOf`). get/set refresh recency; the least-recently-used is evicted.
export class LruMap<K, V> {
  private readonly map = new Map<K, V>();
  private readonly sizes = new Map<K, number>();
  private totalBytes = 0;

  constructor(
    private readonly limits: {
      maxEntries?: number;
      maxBytes?: number;
      sizeOf?: (value: V) => number;
    },
  ) {}

  get size() {
    return this.map.size;
  }

  has(key: K) {
    return this.map.has(key);
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Refresh recency: re-insert so this key becomes the most recent.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): this {
    if (this.map.has(key)) {
      this.map.delete(key);
      this.totalBytes -= this.sizes.get(key) ?? 0;
    }
    this.map.set(key, value);
    const byteSize = this.limits.sizeOf ? this.limits.sizeOf(value) : 0;
    this.sizes.set(key, byteSize);
    this.totalBytes += byteSize;
    this.evict();
    return this;
  }

  delete(key: K): boolean {
    if (!this.map.has(key)) return false;
    this.totalBytes -= this.sizes.get(key) ?? 0;
    this.sizes.delete(key);
    return this.map.delete(key);
  }

  private evict() {
    const { maxEntries, maxBytes } = this.limits;
    // Map iterates in insertion order, so the first key is least-recently-used.
    while (
      (maxEntries !== undefined && this.map.size > maxEntries) ||
      (maxBytes !== undefined && this.totalBytes > maxBytes && this.map.size > 1)
    ) {
      const oldest = this.map.keys().next().value as K | undefined;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }
}
