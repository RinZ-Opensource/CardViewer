import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";

const ORIGIN_ROOT = "https://raw.githubusercontent.com/zvuc/otoge-db/master";
const MAX_DATA_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();

function bytes(value) {
  return encoder.encode(value);
}

function bodyText(value) {
  return new TextDecoder().decode(value);
}

function validSongData(game, marker = "current") {
  if (game === "maimai") {
    return JSON.stringify([{ sort: "1", title: marker, image_url: "maimai.png" }]);
  }
  if (game === "chunithm") {
    return JSON.stringify([{ id: "1", title: marker, image: "chunithm.png" }]);
  }
  return JSON.stringify([{ id: "1", title: marker, image_url: "ongeki.png" }]);
}

function originContentType(game) {
  return game === "chunithm" ? "application/octet-stream" : "text/plain; charset=utf-8";
}

function validOriginResponse(game, marker) {
  return new Response(validSongData(game, marker), {
    headers: { "content-type": originContentType(game) },
  });
}

function makeObject(value, etag = '"etag"', customMetadata = undefined) {
  return { body: bytes(value), httpEtag: etag, customMetadata };
}

function makeR2(initial = {}) {
  const objects = new Map(Object.entries(initial));
  const calls = { get: [], head: [], put: [] };
  return {
    calls,
    objects,
    bucket: {
      async get(key) {
        calls.get.push(key);
        return objects.get(key) ?? null;
      },
      async head(key) {
        calls.head.push(key);
        return objects.get(key) ?? null;
      },
      async put(key, value, options) {
        const stored = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
        calls.put.push({ key, value: stored, options });
        objects.set(key, {
          body: stored,
          httpEtag: '"stored"',
          customMetadata: options?.customMetadata,
        });
      },
    },
  };
}

function makeContext() {
  const promises = [];
  return {
    promises,
    context: {
      waitUntil(promise) {
        promises.push(Promise.resolve(promise));
      },
      passThroughOnException() {},
      props: {},
    },
  };
}

function env(bucket, token = "secret") {
  return { SONGDB: bucket, SYNC_TOKEN: token };
}

async function request(url, options, environment, context = makeContext().context) {
  return worker.fetch(new Request(url, options), environment, context);
}

async function syncRequest(environment) {
  return request(
    "https://worker.example/sync",
    { method: "POST", headers: { authorization: "Bearer secret" } },
    environment,
  );
}

async function assertRejectedMaimaiSync(t, responseFactory, expectedResult) {
  const key = "songdb/data/maimai/music-ex.json";
  const oldBody = validSongData("maimai", "known-good");
  const r2 = makeR2({ [key]: makeObject(oldBody, '"known-good"') });
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url === `${ORIGIN_ROOT}/maimai/data/music-ex.json`) return responseFactory();
    return new Response(null, { status: 503 });
  });

  const response = await syncRequest(env(r2.bucket));
  const results = await response.json();
  assert.equal(results[0].result, expectedResult);
  assert.equal(r2.calls.head.length, 0, "invalid data must be rejected before R2 inspection");
  assert.equal(r2.calls.put.length, 0, "invalid data must never replace an R2 object");
  assert.equal(bodyText(r2.objects.get(key).body), oldBody);
}

function assertCors(response) {
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
}

test("validates preflight, sync authorization, methods, games, and paths", async () => {
  const r2 = makeR2();
  const environment = env(r2.bucket);
  const preflight = await request("https://worker.example/anything", { method: "OPTIONS" }, environment);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
  assertCors(preflight);

  for (const authorization of [undefined, "Bearer wrong"]) {
    const headers = authorization ? { authorization } : undefined;
    const response = await request("https://worker.example/sync", { method: "POST", headers }, environment);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "unauthorized" });
    assertCors(response);
  }
  const unconfigured = await request(
    "https://worker.example/sync",
    { method: "POST", headers: { authorization: "Bearer secret" } },
    { SONGDB: r2.bucket },
  );
  assert.equal(unconfigured.status, 401);
  assert.deepEqual(await unconfigured.json(), { error: "unauthorized" });

  const cases = [
    ["POST", "/data/maimai/music-ex.json", 405, "method not allowed"],
    ["PUT", "/sync", 405, "method not allowed"],
    ["GET", "/", 404, "not found"],
    ["GET", "/data/unknown/music-ex.json", 404, "not found"],
    ["GET", "/data/maimai/other.json", 404, "not found"],
    ["GET", "/jackets/maimai/nested/cover.png", 404, "not found"],
    ["GET", "/jackets/maimai/cover.svg", 404, "not found"],
    ["GET", "/hd-jackets/chunithm/cover.png/extra", 404, "not found"],
  ];
  for (const [method, path, status, error] of cases) {
    const response = await request(`https://worker.example${path}`, { method }, environment);
    assert.equal(response.status, status, `${method} ${path}`);
    assert.deepEqual(await response.json(), { error }, `${method} ${path}`);
    assertCors(response);
  }
  assert.deepEqual(r2.calls, { get: [], head: [], put: [] });
});

test("serves metadata and both jacket tiers directly from R2", async (t) => {
  const r2 = makeR2({
    "songdb/data/maimai/music-ex.json": makeObject('{"songs":1}', '"data-etag"'),
    "songdb/jackets/chunithm/cover.webp": makeObject("regular", '"regular-etag"'),
    "songdb/hd-jackets/ongeki/cover.png": makeObject("hd", '"hd-etag"'),
  });
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("R2 hits must not use the origin");
  });
  const environment = env(r2.bucket);

  const metadata = await request("https://worker.example/data/maimai/music-ex.json", undefined, environment);
  assert.equal(await metadata.text(), '{"songs":1}');
  assert.equal(metadata.headers.get("content-type"), "application/json");
  assert.equal(metadata.headers.get("cache-control"), "public, max-age=3600");
  assert.equal(metadata.headers.get("etag"), '"data-etag"');

  const regular = await request("https://worker.example/jackets/chunithm/cover.webp", undefined, environment);
  assert.equal(await regular.text(), "regular");
  assert.equal(regular.headers.get("content-type"), "image/webp");
  assert.equal(regular.headers.get("cache-control"), "public, max-age=2592000, immutable");
  assert.equal(regular.headers.get("etag"), '"regular-etag"');

  const hd = await request("https://worker.example/hd-jackets/ongeki/cover.png", undefined, environment);
  assert.equal(await hd.text(), "hd");
  assert.equal(hd.headers.get("content-type"), "image/png");
  assert.equal(hd.headers.get("etag"), '"hd-etag"');
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.deepEqual(r2.calls.get, [
    "songdb/data/maimai/music-ex.json",
    "songdb/jackets/chunithm/cover.webp",
    "songdb/hd-jackets/ongeki/cover.png",
  ]);
});

test("returns 404 for every R2 read miss without consulting the upstream origin", async (t) => {
  const r2 = makeR2();
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("GET routes must never consult the upstream origin");
  });
  const environment = env(r2.bucket);
  const urls = [
    "https://worker.example/data/ongeki/music-ex.json",
    "https://worker.example/jackets/maimai/cover.jpeg",
    "https://worker.example/hd-jackets/chunithm/cover.png",
  ];

  for (const url of urls) {
    const response = await request(url, undefined, environment);
    assert.equal(response.status, 404, url);
    assert.deepEqual(await response.json(), { error: "not found" }, url);
    assertCors(response);
  }

  assert.equal(fetchMock.mock.callCount(), 0);
  assert.deepEqual(r2.calls.get, [
    "songdb/data/ongeki/music-ex.json",
    "songdb/jackets/maimai/cover.jpeg",
    "songdb/hd-jackets/chunithm/cover.png",
  ]);
  assert.deepEqual(r2.calls.head, []);
  assert.deepEqual(r2.calls.put, []);
});

test("manual sync reports updated, unchanged, and failed games", async (t) => {
  const maiBody = validSongData("maimai", "maimai-new");
  const chuniBody = validSongData("chunithm", "chuni-current");
  const chuniBytes = bytes(chuniBody);
  const chuniHash = await crypto.subtle.digest("SHA-256", chuniBytes);
  const chuniSha = [...new Uint8Array(chuniHash)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  const r2 = makeR2({
    "songdb/data/chunithm/music-ex.json": makeObject("old body", '"old"', { sha256: chuniSha }),
  });
  const fetchMock = t.mock.method(globalThis, "fetch", async (url) => {
    if (url === `${ORIGIN_ROOT}/maimai/data/music-ex.json`) {
      return new Response(maiBody, { headers: { "content-type": originContentType("maimai") } });
    }
    if (url === `${ORIGIN_ROOT}/chunithm/data/music-ex.json`) {
      return new Response(chuniBytes, {
        headers: {
          "content-length": String(chuniBytes.byteLength),
          "content-type": originContentType("chunithm"),
        },
      });
    }
    if (url === `${ORIGIN_ROOT}/ongeki/data/music-ex.json`) return new Response(null, { status: 503 });
    throw new Error(`unexpected URL ${url}`);
  });
  const response = await request(
    "https://worker.example/sync",
    { method: "POST", headers: { authorization: "Bearer secret" } },
    env(r2.bucket),
  );
  assert.deepEqual(await response.json(), [
    { game: "maimai", result: "updated" },
    { game: "chunithm", result: "unchanged" },
    { game: "ongeki", result: "error: origin HTTP 503" },
  ]);
  assertCors(response);
  assert.equal(fetchMock.mock.callCount(), 3);
  assert.deepEqual(r2.calls.head.sort(), [
    "songdb/data/chunithm/music-ex.json",
    "songdb/data/maimai/music-ex.json",
  ]);
  assert.equal(r2.calls.put.length, 1);
  assert.equal(r2.calls.put[0].key, "songdb/data/maimai/music-ex.json");
  assert.equal(bodyText(r2.calls.put[0].value), maiBody);
});

test("rejects HTML and malformed JSON 200 responses without replacing R2", async (t) => {
  await t.test("HTML response", async (subtest) => {
    await assertRejectedMaimaiSync(
      subtest,
      () => new Response("<html>upstream error</html>", { headers: { "content-type": "text/html" } }),
      "error: unexpected origin content-type text/html",
    );
  });
  await t.test("malformed JSON", async (subtest) => {
    await assertRejectedMaimaiSync(
      subtest,
      () => new Response("[{", { headers: { "content-type": "application/json" } }),
      "error: origin body is not valid JSON",
    );
  });
});

test("rejects wrong JSON shape, empty arrays, and invalid records without replacing R2", async (t) => {
  const cases = [
    ["object", JSON.stringify({ sort: "1", title: "not an array", image_url: "cover.png" }),
      "error: origin JSON must be a non-empty top-level array"],
    ["empty array", "[]", "error: origin JSON must be a non-empty top-level array"],
    ["invalid record", JSON.stringify([{ sort: "1", title: "missing image" }]),
      "error: origin JSON has an invalid maimai record at index 0"],
    ["non-string field", JSON.stringify([{ sort: "1", title: "song", image_url: "cover.png", bpm: 120 }]),
      "error: origin JSON has an invalid maimai record at index 0"],
  ];
  for (const [name, body, expectedResult] of cases) {
    await t.test(name, async (subtest) => {
      await assertRejectedMaimaiSync(
        subtest,
        () => new Response(body, { headers: { "content-type": "application/json" } }),
        expectedResult,
      );
    });
  }
});

test("rejects declared and streamed bodies over the byte limit without replacing R2", async (t) => {
  await t.test("declared Content-Length", async (subtest) => {
    await assertRejectedMaimaiSync(
      subtest,
      () => new Response(validSongData("maimai"), {
        headers: {
          "content-length": String(MAX_DATA_BYTES + 1),
          "content-type": "application/json",
        },
      }),
      `error: origin body exceeds ${MAX_DATA_BYTES} bytes`,
    );
  });
  await t.test("actual streamed bytes", async (subtest) => {
    await assertRejectedMaimaiSync(
      subtest,
      () => new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(MAX_DATA_BYTES));
            controller.enqueue(new Uint8Array([0]));
            controller.close();
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
      `error: origin body exceeds ${MAX_DATA_BYTES} bytes`,
    );
  });
});

test("scheduled sync registers and completes the same refresh job", async (t) => {
  const r2 = makeR2();
  const { context, promises } = makeContext();
  t.mock.method(globalThis, "fetch", async (url) => {
    const game = url.includes("/maimai/")
      ? "maimai"
      : url.includes("/chunithm/")
        ? "chunithm"
        : "ongeki";
    return validOriginResponse(game, `scheduled:${url}`);
  });
  const logMock = t.mock.method(console, "log", () => {});
  await worker.scheduled({}, env(r2.bucket), context);
  assert.equal(promises.length, 1);
  await Promise.all(promises);
  assert.deepEqual(
    r2.calls.put.map((call) => call.key).sort(),
    [
      "songdb/data/chunithm/music-ex.json",
      "songdb/data/maimai/music-ex.json",
      "songdb/data/ongeki/music-ex.json",
    ],
  );
  assert.equal(logMock.mock.callCount(), 1);
  assert.equal(logMock.mock.calls[0].arguments[0], "songdb sync:");
  assert.deepEqual(JSON.parse(logMock.mock.calls[0].arguments[1]), [
    { game: "maimai", result: "updated" },
    { game: "chunithm", result: "updated" },
    { game: "ongeki", result: "updated" },
  ]);
});
