import assert from "node:assert/strict";
import test from "node:test";

import { onRequest } from "../functions/official/[[path]].js";

function installCache(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "caches");
  const entries = new Map();
  const matchCalls = [];
  const putCalls = [];

  const cache = {
    async match(request) {
      matchCalls.push({ method: request.method, url: request.url });
      return entries.get(request.url)?.clone();
    },
    async put(request, response) {
      putCalls.push({ method: request.method, url: request.url });
      entries.set(request.url, response.clone());
    },
  };

  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: { default: cache },
  });
  t.after(() => {
    if (previous) {
      Object.defineProperty(globalThis, "caches", previous);
    } else {
      delete globalThis.caches;
    }
  });

  return { entries, matchCalls, putCalls };
}

function makeBucket(body = "asset-body") {
  const getCalls = [];
  return {
    getCalls,
    bucket: {
      async get(key) {
        getCalls.push(key);
        return {
          body,
          httpEtag: '"asset-etag"',
          writeHttpMetadata() {},
        };
      },
    },
  };
}

async function invoke({ bucket, env, method = "GET", url }) {
  const pending = [];
  const response = await onRequest({
    request: { method, url },
    env: env ?? { ASSETS_BUCKET: bucket },
    waitUntil(promise) {
      pending.push(Promise.resolve(promise));
    },
  });
  await Promise.all(pending);
  return response;
}

test("serves generated, scorecard, and the three reviewed root assets", async (t) => {
  installCache(t);
  const { bucket, getCalls } = makeBucket();
  const allowed = [
    ["/official/generated/cards.json", "official/generated/cards.json"],
    ["/official/generated/cards/front.png", "official/generated/cards/front.png"],
    ["/official/scorecard/mai/jackets/000001.webp", "official/scorecard/mai/jackets/000001.webp"],
    ["/official/scorecard/chuni/jackets/cover.jpg", "official/scorecard/chuni/jackets/cover.jpg"],
    ["/official/scorecard/ongeki/jackets/cover.jpeg", "official/scorecard/ongeki/jackets/cover.jpeg"],
    ["/official/C310Busb_CardBack.png", "official/C310Busb_CardBack.png"],
    ["/official/UI_Card_Horo_Rainbow_Hard.png", "official/UI_Card_Horo_Rainbow_Hard.png"],
    ["/official/UI_Card_Horo_Pattern_00.png", "official/UI_Card_Horo_Pattern_00.png"],
  ];

  for (const [pathname] of allowed) {
    const response = await invoke({ bucket, url: `https://assets.example${pathname}` });
    assert.equal(response.status, 200, pathname);
  }

  assert.deepEqual(
    getCalls,
    allowed.map(([, key]) => key),
  );
});

test("denies unreviewed prefixes, root assets, hidden files, and non-public extensions", async (t) => {
  installCache(t);
  const { bucket, getCalls } = makeBucket();
  const denied = [
    "/official/MAI_cardbase_default.png",
    "/official/fonts/private/licensed.png",
    "/official/generated",
    "/official/scorecard/",
    "/official/generated/.logs/x.log",
    "/official/generated/tool.py",
    "/official/generated/run.cmd",
    "/official/generated/process.pid",
    "/official/scorecard/catalog.sqlite",
  ];

  for (const pathname of denied) {
    const response = await invoke({ bucket, url: `https://assets.example${pathname}` });
    assert.equal(response.status, 404, pathname);
  }

  assert.deepEqual(getCalls, []);
});

test("rejects malformed and ambiguous path segments before reading R2", async (t) => {
  installCache(t);
  const { bucket, getCalls } = makeBucket();
  const denied = [
    "/official/generated//card.png",
    "/official/generated/../secret.png",
    "/official/generated/%2e%2e/secret.png",
    "/official/generated/%2Ehidden/card.png",
    "/official/generated/a%2Fb.png",
    "/official/generated/a%5Cb.png",
    "/official/generated/a\\b.png",
    "/official/generated/%00.png",
    "/official/generated/%ZZ.png",
    "/official/generated/%252e%252e/card.png",
  ];

  for (const pathname of denied) {
    const response = await invoke({ bucket, url: `https://assets.example${pathname}` });
    assert.equal(response.status, 404, pathname);
  }

  assert.deepEqual(getCalls, []);
});

test("normalizes query parameters out of the shared edge-cache key", async (t) => {
  const cache = installCache(t);
  const { bucket, getCalls } = makeBucket("catalog");

  const first = await invoke({
    bucket,
    url: "https://assets.example/official/generated/cards.json?version=one",
  });
  const second = await invoke({
    bucket,
    url: "https://assets.example/official/generated/cards.json?version=two",
  });

  assert.equal(await first.text(), "catalog");
  assert.equal(await second.text(), "catalog");
  assert.deepEqual(getCalls, ["official/generated/cards.json"]);
  assert.deepEqual(
    cache.matchCalls,
    [
      { method: "GET", url: "https://assets.example/official/generated/cards.json" },
      { method: "GET", url: "https://assets.example/official/generated/cards.json" },
    ],
  );
  assert.deepEqual(cache.putCalls, [
    { method: "GET", url: "https://assets.example/official/generated/cards.json" },
  ]);
});

test("HEAD shares the GET cache entry and returns headers without a body", async (t) => {
  const cache = installCache(t);
  const { bucket, getCalls } = makeBucket("image-bytes");

  const response = await invoke({
    bucket,
    method: "HEAD",
    url: "https://assets.example/official/scorecard/mai/icon.png?cache=bust",
  });

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("etag"), '"asset-etag"');
  assert.deepEqual(getCalls, ["official/scorecard/mai/icon.png"]);
  assert.deepEqual(cache.matchCalls, [
    { method: "GET", url: "https://assets.example/official/scorecard/mai/icon.png" },
  ]);
  assert.deepEqual(cache.putCalls, [
    { method: "GET", url: "https://assets.example/official/scorecard/mai/icon.png" },
  ]);
});

test("returns a diagnostic 503 when the R2 binding is missing", async (t) => {
  const cache = installCache(t);

  const response = await invoke({
    env: {},
    url: "https://assets.example/official/generated/cards.json",
  });

  assert.equal(response.status, 503);
  assert.match(await response.text(), /ASSETS_BUCKET/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(cache.matchCalls, []);
  assert.deepEqual(cache.putCalls, []);
});

test("rejects unreviewed paths before revealing binding availability", async (t) => {
  const cache = installCache(t);

  const response = await invoke({
    env: {},
    url: "https://assets.example/official/private/source.png",
  });

  assert.equal(response.status, 404);
  assert.deepEqual(cache.matchCalls, []);
  assert.deepEqual(cache.putCalls, []);
});

test("allows only GET and HEAD", async (t) => {
  installCache(t);
  const { bucket, getCalls } = makeBucket();

  const response = await invoke({
    bucket,
    method: "POST",
    url: "https://assets.example/official/generated/cards.json",
  });

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
  assert.deepEqual(getCalls, []);
});
