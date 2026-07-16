import assert from "node:assert/strict";
import test from "node:test";
import { importTypeScriptModule } from "./helpers/import-typescript.mjs";

const { LruMap } = await importTypeScriptModule("src/lru.ts");
const { PriorityTaskScheduler } = await importTypeScriptModule("src/priorityTaskScheduler.ts");

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

test("a queued normal task can be promoted ahead of other normal work", async () => {
  const scheduler = new PriorityTaskScheduler(1);
  const order = [];
  let releaseBlocker;
  const blocker = scheduler.schedule(
    () =>
      new Promise((resolve) => {
        order.push("blocker");
        releaseBlocker = resolve;
      }),
  );
  const normal = scheduler.schedule(async () => {
    order.push("normal");
  });
  const selected = scheduler.schedule(async () => {
    order.push("selected");
  });

  assert.equal(selected.promote(), true);
  assert.equal(selected.promote(), false);
  releaseBlocker();
  await Promise.all([blocker.promise, normal.promise, selected.promise]);

  assert.deepEqual(order, ["blocker", "selected", "normal"]);
});

test("a rejected task releases its scheduler slot", async () => {
  const scheduler = new PriorityTaskScheduler(1);
  const failed = scheduler.schedule(async () => {
    throw new Error("expected failure");
  });
  const next = scheduler.schedule(async () => "completed");

  await assert.rejects(failed.promise, /expected failure/);
  await assert.doesNotReject(next.promise);
  assert.equal(await next.promise, "completed");
});

test("the scheduler rejects invalid concurrency limits", () => {
  assert.throws(() => new PriorityTaskScheduler(0), /positive integer/);
  assert.throws(() => new PriorityTaskScheduler(1.5), /positive integer/);
});
