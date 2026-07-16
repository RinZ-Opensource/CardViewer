import assert from "node:assert/strict";
import test from "node:test";
import { importTypeScriptModule } from "./helpers/import-typescript.mjs";

const { LruMap } = await importTypeScriptModule("src/lru.ts");

test("LRU refreshes reads and evicts the least-recent entry", () => {
  const cache = new LruMap({ maxEntries: 2 });
  cache.set("first", "1");
  cache.set("second", "2");
  assert.equal(cache.get("first"), "1");

  cache.set("third", "3");

  assert.equal(cache.has("first"), true);
  assert.equal(cache.has("second"), false);
  assert.equal(cache.has("third"), true);
});

test("LRU does not retain a single value larger than its byte budget", () => {
  const cache = new LruMap({ maxBytes: 4, sizeOf: (value) => value.length });

  cache.set("oversized", "12345");

  assert.equal(cache.size, 0);
  assert.equal(cache.has("oversized"), false);
});

test("LRU can evict an undefined key", () => {
  const cache = new LruMap({ maxEntries: 1 });
  cache.set(undefined, "oldest");
  cache.set("next", "newest");

  assert.equal(cache.size, 1);
  assert.equal(cache.has(undefined), false);
  assert.equal(cache.get("next"), "newest");
});
