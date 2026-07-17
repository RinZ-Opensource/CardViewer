import assert from "node:assert/strict";
import test from "node:test";

import { onRequest } from "../functions/official/[[path]].js";
import { publicObjectKey } from "../functions/official/public-object-policy.js";
import { onRequest as onPrivateFontRequest } from "../functions/fonts/private/[[path]].js";

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

function makeBucket(body = "asset-body", contentType) {
  const getCalls = [];
  return {
    getCalls,
    bucket: {
      async get(key) {
        getCalls.push(key);
        return {
          body,
          httpEtag: '"asset-etag"',
          writeHttpMetadata(headers) {
            if (contentType) headers.set("content-type", contentType);
          },
        };
      },
    },
  };
}

test("public object policy maps URLs without Cloudflare runtime state", () => {
  assert.equal(
    publicObjectKey(
      "https://assets.example/official/generated/assets/chu/CHU_card_00001002.webp?revision=1",
    ),
    "official/generated/assets/chu/CHU_card_00001002.webp",
  );
  assert.equal(
    publicObjectKey("https://assets.example/official/songdb/data/ongeki/music-ex.json"),
    "songdb/data/ongeki/music-ex.json",
  );
  assert.equal(
    publicObjectKey("https://assets.example/official/generated/private/credentials.json"),
    null,
  );
});

test("private font paths always fail closed without consulting request context", async () => {
  const context = new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(`private font guard must not read context.${String(property)}`);
      },
    },
  );

  const response = await onPrivateFontRequest(context);

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "");
});

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

test("serves every reviewed publication shape and only approved fonts", async (t) => {
  installCache(t);
  const { bucket, getCalls } = makeBucket();
  const allowed = [
    ["/official/generated/cards.json", "official/generated/cards.json"],
    ["/official/generated/cards.index.json", "official/generated/cards.index.json"],
    ["/official/generated/cards.chu.json", "official/generated/cards.chu.json"],
    ["/official/generated/cards.mai.json", "official/generated/cards.mai.json"],
    ["/official/generated/cards.mu3.json", "official/generated/cards.mu3.json"],
    [
      "/official/generated/shards/cards-0002.json",
      "official/generated/shards/cards-0002.json",
    ],
    [
      "/official/generated/assets/chu/CHU_card_00001002.webp",
      "official/generated/assets/chu/CHU_card_00001002.webp",
    ],
    [
      "/official/generated/assets/thumbs/mai/card_card00010013.webp",
      "official/generated/assets/thumbs/mai/card_card00010013.webp",
    ],
    ["/official/scorecard/mai/UI_MSS_Rank_S.png", "official/scorecard/mai/UI_MSS_Rank_S.png"],
    ["/official/scorecard/mai/jackets/000001.webp", "official/scorecard/mai/jackets/000001.webp"],
    ["/official/scorecard/chuni/jackets/cover.jpg", "official/scorecard/chuni/jackets/cover.jpg"],
    ["/official/scorecard/ongeki/jackets/cover.jpeg", "official/scorecard/ongeki/jackets/cover.jpeg"],
    [
      "/official/scorecard/chuni/manifest_musicbox.json",
      "official/scorecard/chuni/manifest_musicbox.json",
    ],
    [
      "/official/scorecard/mai/jackets/jacket-map.json",
      "official/scorecard/mai/jackets/jacket-map.json",
    ],
    [
      "/official/scorecard/chuni/jackets/v2/music_0001.png",
      "official/scorecard/chuni/jackets/v2/music_0001.png",
    ],
    [
      "/official/scorecard/ongeki/boss/boss-map.json",
      "official/scorecard/ongeki/boss/boss-map.json",
    ],
    [
      "/official/scorecard/ongeki/boss/v1/UI_Card_Icon_000001.png",
      "official/scorecard/ongeki/boss/v1/UI_Card_Icon_000001.png",
    ],
    [
      "/official/cardviewer/v1/runtime/C310Busb_CardBack.png",
      "official/cardviewer/v1/runtime/C310Busb_CardBack.png",
    ],
    [
      "/official/cardviewer/v1/runtime/fonts/FONT_SegaKakuGothic_40px.json",
      "official/cardviewer/v1/runtime/fonts/FONT_SegaKakuGothic_40px.json",
    ],
    [
      "/official/cardviewer/v1/runtime/FONT_TMP_MAI_NEW_RODIN_EB_SDF_SUBSET_V1.json",
      "official/cardviewer/v1/runtime/FONT_TMP_MAI_NEW_RODIN_EB_SDF_SUBSET_V1.json",
    ],
    [
      "/official/cardviewer/v1/runtime/FONT_TMP_MAI_NEW_RODIN_EB_SDF_SUBSET_V1.png",
      "official/cardviewer/v1/runtime/FONT_TMP_MAI_NEW_RODIN_EB_SDF_SUBSET_V1.png",
    ],
    [
      "/official/cardviewer/v1/runtime/FONT_TMP_MAI_MARU_GOTHIC_DB_SDF_SUBSET_V1.json",
      "official/cardviewer/v1/runtime/FONT_TMP_MAI_MARU_GOTHIC_DB_SDF_SUBSET_V1.json",
    ],
    [
      "/official/cardviewer/v1/runtime/FONT_TMP_MAI_MARU_GOTHIC_DB_SDF_SUBSET_V1.png",
      "official/cardviewer/v1/runtime/FONT_TMP_MAI_MARU_GOTHIC_DB_SDF_SUBSET_V1.png",
    ],
    [
      "/official/cardviewer/v1/fonts/zen/ZenKakuGothicNew-Black.ttf",
      "official/cardviewer/v1/fonts/zen/ZenKakuGothicNew-Black.ttf",
    ],
    [
      "/official/cardviewer/v1/fonts/zen/ZenKakuGothicNew-Bold.ttf",
      "official/cardviewer/v1/fonts/zen/ZenKakuGothicNew-Bold.ttf",
    ],
    [
      "/official/cardviewer/v1/fonts/zen/ZenKakuGothicNew-Regular.ttf",
      "official/cardviewer/v1/fonts/zen/ZenKakuGothicNew-Regular.ttf",
    ],
    [
      "/official/cardviewer/v1/fonts/zen/ZenMaruGothic-Black.ttf",
      "official/cardviewer/v1/fonts/zen/ZenMaruGothic-Black.ttf",
    ],
    [
      "/official/cardviewer/v1/fonts/zen/ZenMaruGothic-Bold.ttf",
      "official/cardviewer/v1/fonts/zen/ZenMaruGothic-Bold.ttf",
    ],
    [
      "/official/cardviewer/v1/fonts/zen/ZenMaruGothic-Medium.ttf",
      "official/cardviewer/v1/fonts/zen/ZenMaruGothic-Medium.ttf",
    ],
    [
      "/official/cardviewer/v1/fonts/zen/ZenMaruGothic-Regular.ttf",
      "official/cardviewer/v1/fonts/zen/ZenMaruGothic-Regular.ttf",
    ],
    [
      "/official/cardviewer/v1/fonts/licenses/OFL-ZenKakuGothicNew.txt",
      "official/cardviewer/v1/fonts/licenses/OFL-ZenKakuGothicNew.txt",
    ],
    [
      "/official/cardviewer/v1/fonts/licenses/OFL-ZenMaruGothic.txt",
      "official/cardviewer/v1/fonts/licenses/OFL-ZenMaruGothic.txt",
    ],
    [
      "/official/songdb/data/maimai/music-ex.json",
      "songdb/data/maimai/music-ex.json",
    ],
    [
      "/official/songdb/data/chunithm/music-ex.json",
      "songdb/data/chunithm/music-ex.json",
    ],
    [
      "/official/songdb/data/ongeki/music-ex.json",
      "songdb/data/ongeki/music-ex.json",
    ],
    [
      "/official/songdb/jackets/maimai/3c88f7e0a.png",
      "songdb/jackets/maimai/3c88f7e0a.png",
    ],
    [
      "/official/songdb/hd-jackets/chunithm/music_0001.webp",
      "songdb/hd-jackets/chunithm/music_0001.webp",
    ],
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

test("forces response MIME types and nosniff instead of trusting R2 metadata", async (t) => {
  installCache(t);
  const { bucket } = makeBucket("<html>not executable</html>", "text/html");

  const json = await invoke({
    bucket,
    url: "https://assets.example/official/generated/cards.json",
  });
  const image = await invoke({
    bucket,
    url: "https://assets.example/official/scorecard/mai/icon.png",
  });
  const font = await invoke({
    bucket,
    url: "https://assets.example/official/cardviewer/v1/fonts/zen/ZenMaruGothic-Regular.ttf",
  });
  const license = await invoke({
    bucket,
    url: "https://assets.example/official/cardviewer/v1/fonts/licenses/OFL-ZenMaruGothic.txt",
  });

  assert.equal(json.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(font.headers.get("content-type"), "font/ttf");
  assert.equal(license.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(json.headers.get("x-content-type-options"), "nosniff");
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  assert.equal(font.headers.get("x-content-type-options"), "nosniff");
  assert.equal(license.headers.get("x-content-type-options"), "nosniff");
});

test("normalizes unsafe metadata already present in the edge cache", async (t) => {
  const cache = installCache(t);
  const url = "https://assets.example/official/scorecard/chuni/jackets/cover.jpg";
  cache.entries.set(
    url,
    new Response("cached-image", { headers: { "content-type": "text/html" } }),
  );
  const { bucket, getCalls } = makeBucket();

  const response = await invoke({ bucket, url });

  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(getCalls, []);
});

test("denies unreviewed prefixes, root assets, hidden files, and non-public extensions", async (t) => {
  installCache(t);
  const { bucket, getCalls } = makeBucket();
  const denied = [
    "/official/MAI_cardbase_default.png",
    "/official/C310Busb_CardBack.png",
    "/official/UI_Card_Horo_Rainbow_Hard.png",
    "/official/UI_Card_Horo_Pattern_00.png",
    "/official/fonts/private/licensed.png",
    "/official/generated",
    "/official/scorecard/",
    "/official/cardviewer/v1/runtime/",
    "/official/cardviewer/v1/fonts/",
    "/official/cardviewer/v1/runtime/font.ttf",
    "/official/cardviewer/v1/runtime/README.txt",
    "/official/cardviewer/v1/fonts/image.png",
    "/official/cardviewer/v1/fonts/metrics.json",
    "/official/cardviewer/v1/fonts/private/licensed.otf",
    "/official/cardviewer/v1/fonts/web/CardViewer.woff2",
    "/official/cardviewer/v1/fonts/zen/Regular.ttf",
    "/official/cardviewer/v1/fonts/zen/ZenMaruGothic-Regular.otf",
    "/official/cardviewer/v1/fonts/zen/nested/ZenMaruGothic-Regular.ttf",
    "/official/cardviewer/v1/fonts/licenses/OFL.txt",
    "/official/cardviewer/v1/fonts/licenses/nested/OFL-ZenMaruGothic.txt",
    "/official/cardviewer/v1/fonts/licenses/OFL-ZenMaruGothic.ttf",
    "/official/cardviewer/v1/private/asset.png",
    "/official/cardviewer/v2/runtime/asset.png",
    "/official/generated/.logs/x.log",
    "/official/cardviewer/v1/runtime/.logs/x.png",
    "/official/cardviewer/v1/fonts/.private/font.ttf",
    "/official/generated/tool.py",
    "/official/generated/README.txt",
    "/official/generated/run.cmd",
    "/official/generated/process.pid",
    "/official/scorecard/catalog.sqlite",
    "/official/cardviewer/v1/runtime/tool.py",
    "/official/cardviewer/v1/fonts/tool.exe",
    "/official/songdb/data/maimai/other.json",
    "/official/songdb/data/invalid/music-ex.json",
    "/official/songdb/data/maimai/nested/music-ex.json",
    "/official/songdb/jackets/ongeki/folder/0001.png",
    "/official/songdb/jackets/invalid/0001.png",
    "/official/songdb/jackets/ongeki/.0001.png",
    "/official/songdb/jackets/ongeki/0001.svg",
    "/official/songdb/jackets/ongeki/tool.exe",
    "/official/songdb/hd-jackets/maimai/README.txt",
    "/official/songdb/private/maimai/0001.png",
  ];

  for (const pathname of denied) {
    const response = await invoke({ bucket, url: `https://assets.example${pathname}` });
    assert.equal(response.status, 404, pathname);
    assert.equal(response.headers.get("cache-control"), "no-store", pathname);
  }

  assert.deepEqual(getCalls, []);
});

test("rejects media files that do not match a reviewed publication shape", async (t) => {
  installCache(t);
  const { bucket, getCalls } = makeBucket();
  const denied = [
    // Regression cases from the public-data audit: all have an otherwise
    // allowed extension but live outside a reviewed object shape.
    "/official/generated/private/credentials.json",
    "/official/scorecard/private/secret.json",
    "/official/cardviewer/v1/runtime/diagnostics/private.json",
    // Generated objects are direct manifests, named shards, or known game
    // asset trees; the old arbitrary nesting behavior must remain closed.
    "/official/generated/cards/front.png",
    "/official/generated/shards/index.json",
    "/official/generated/shards/cards-secret.json",
    "/official/generated/assets/private/card.webp",
    "/official/generated/assets/chu/private-preview.webp",
    "/official/generated/assets/chu/nested/card.webp",
    "/official/generated/assets/thumbs/private/card.webp",
    // Score-card nesting is limited to the jacket and ONGEKI boss contracts.
    "/official/scorecard/mai/private/card.png",
    "/official/scorecard/mai/jackets/v0/card.png",
    "/official/scorecard/chuni/boss/v1/card.png",
    "/official/scorecard/ongeki/boss/private/card.png",
    // The only reviewed runtime child directory is the FONT_* catalog/atlas
    // group. Other runtime assets are direct children.
    "/official/cardviewer/v1/runtime/fonts/regular.json",
    "/official/cardviewer/v1/runtime/fonts/private.json",
    "/official/cardviewer/v1/runtime/fonts/FONT_private.json",
    "/official/cardviewer/v1/runtime/fonts/nested/FONT_Test.json",
    "/official/cardviewer/v1/runtime/diagnostics.json",
    "/official/cardviewer/v1/runtime/private-preview.png",
  ];

  for (const pathname of denied) {
    const response = await invoke({ bucket, url: `https://assets.example${pathname}` });
    assert.equal(response.status, 404, pathname);
    assert.equal(response.headers.get("cache-control"), "no-store", pathname);
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
    "/official/cardviewer/v1/runtime/../private.png",
    "/official/cardviewer/v1/runtime/%2e%2e/private.png",
    "/official/cardviewer/v1/runtime/a%2Fb.png",
    "/official/cardviewer/v1/fonts/%2Ehidden/font.ttf",
    "/official/cardviewer/v1/fonts/a%5Cb.ttf",
  ];

  for (const pathname of denied) {
    const response = await invoke({ bucket, url: `https://assets.example${pathname}` });
    assert.equal(response.status, 404, pathname);
    assert.equal(response.headers.get("cache-control"), "no-store", pathname);
  }

  assert.deepEqual(getCalls, []);
});

test("mutable JSON bypasses stale edge cache entries and reads the current R2 object", async (t) => {
  const cache = installCache(t);
  const url = "https://assets.example/official/generated/cards.json";
  cache.entries.set(url, new Response("stale-catalog"));
  const { bucket, getCalls } = makeBucket("current-catalog");

  const response = await invoke({ bucket, url: `${url}?revision=current` });

  assert.equal(await response.text(), "current-catalog");
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=60, stale-while-revalidate=86400",
  );
  assert.deepEqual(getCalls, ["official/generated/cards.json"]);
  assert.deepEqual(cache.matchCalls, []);
  assert.deepEqual(cache.putCalls, []);
});

test("normalizes query parameters out of the shared immutable-media cache key", async (t) => {
  const cache = installCache(t);
  const { bucket, getCalls } = makeBucket("image-bytes");

  const first = await invoke({
    bucket,
    url: "https://assets.example/official/generated/assets/chu/front.png?version=one",
  });
  const second = await invoke({
    bucket,
    url: "https://assets.example/official/generated/assets/chu/front.png?version=two",
  });

  assert.equal(await first.text(), "image-bytes");
  assert.equal(await second.text(), "image-bytes");
  assert.deepEqual(getCalls, ["official/generated/assets/chu/front.png"]);
  assert.deepEqual(
    cache.matchCalls,
    [
      {
        method: "GET",
        url: "https://assets.example/official/generated/assets/chu/front.png",
      },
      {
        method: "GET",
        url: "https://assets.example/official/generated/assets/chu/front.png",
      },
    ],
  );
  assert.deepEqual(cache.putCalls, [
    {
      method: "GET",
      url: "https://assets.example/official/generated/assets/chu/front.png",
    },
  ]);
});

test("maps same-origin songdb routes to R2 keys with data and image cache policies", async (t) => {
  installCache(t);
  const { bucket, getCalls } = makeBucket("songdb-object", "text/html");

  const data = await invoke({
    bucket,
    url: "https://assets.example/official/songdb/data/ongeki/music-ex.json?revision=one",
  });
  const jacket = await invoke({
    bucket,
    url: "https://assets.example/official/songdb/jackets/ongeki/0001.jpg?revision=one",
  });
  const hdJacket = await invoke({
    bucket,
    url: "https://assets.example/official/songdb/hd-jackets/maimai/0002.webp",
  });

  assert.deepEqual(getCalls, [
    "songdb/data/ongeki/music-ex.json",
    "songdb/jackets/ongeki/0001.jpg",
    "songdb/hd-jackets/maimai/0002.webp",
  ]);
  assert.equal(data.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(
    data.headers.get("cache-control"),
    "public, max-age=60, stale-while-revalidate=86400",
  );
  assert.equal(jacket.headers.get("content-type"), "image/jpeg");
  assert.equal(jacket.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(hdJacket.headers.get("content-type"), "image/webp");
  assert.equal(hdJacket.headers.get("cache-control"), "public, max-age=31536000, immutable");
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

test("returns an uncacheable 404 when an allowed R2 object is missing", async (t) => {
  const cache = installCache(t);
  const getCalls = [];
  const bucket = {
    async get(key) {
      getCalls.push(key);
      return null;
    },
  };

  const response = await invoke({
    bucket,
    url: "https://assets.example/official/generated/assets/chu/missing.webp",
  });

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(getCalls, ["official/generated/assets/chu/missing.webp"]);
  assert.deepEqual(cache.putCalls, []);
});

test("rejects unreviewed paths before revealing binding availability", async (t) => {
  const cache = installCache(t);

  const response = await invoke({
    env: {},
    url: "https://assets.example/official/private/source.png",
  });

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
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
