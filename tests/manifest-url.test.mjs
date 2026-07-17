import assert from "node:assert/strict";
import test from "node:test";
import { importTypeScriptModule } from "./helpers/import-typescript.mjs";

const { resolveManifestShardUrl } = await importTypeScriptModule("src/manifestUrl.ts");

const pageHref = "https://cv.example/#cards";
const manifestUrl = "/official/generated/cards.index.json";

test("resolves relative shards inside the same reviewed generated prefix", () => {
  assert.equal(
    resolveManifestShardUrl("cards-0001.json", manifestUrl, pageHref),
    "https://cv.example/official/generated/cards-0001.json",
  );
  assert.equal(
    resolveManifestShardUrl("shards/cards-0002.json?revision=1", manifestUrl, pageHref),
    "https://cv.example/official/generated/shards/cards-0002.json?revision=1",
  );
});

test("rejects cross-origin shard URLs", () => {
  assert.throws(
    () =>
      resolveManifestShardUrl(
        "https://assets.example/official/generated/cards-0001.json",
        manifestUrl,
        pageHref,
      ),
    /Unsafe manifest shard URL/,
  );
});

test("rejects cross-prefix and parent-segment escapes", () => {
  for (const href of [
    "../scorecard/cards-0001.json",
    "/official/scorecard/cards-0001.json",
    "shards/../cards-0001.json",
  ]) {
    assert.throws(
      () => resolveManifestShardUrl(href, manifestUrl, pageHref),
      /Unsafe manifest shard URL/,
      href,
    );
  }
});

test("rejects encoded traversal and encoded path separators", () => {
  for (const href of [
    "%2e%2e/scorecard/cards-0001.json",
    "%252e%252e/scorecard/cards-0001.json",
    "shards%2fcards-0001.json",
    "shards%5ccards-0001.json",
  ]) {
    assert.throws(
      () => resolveManifestShardUrl(href, manifestUrl, pageHref),
      /Unsafe manifest shard URL/,
      href,
    );
  }
});
