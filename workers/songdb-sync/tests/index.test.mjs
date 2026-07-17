import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { syncAll } from "../src/sync.ts";

const ORIGIN_ROOT = "https://raw.githubusercontent.com/zvuc/otoge-db/master";
const MAX_DATA_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();
const MIN_DATA_ROWS = { maimai: 1_000, chunithm: 1_000, ongeki: 700 };

function bytes(value) {
  return encoder.encode(value);
}

function bodyText(value) {
  return new TextDecoder().decode(value);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", bytes(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validSongRow(game, marker = "current", index = 0) {
  if (game === "maimai") {
    return { sort: String(index + 1), title: `${marker}:${index}`, image_url: "maimai.png" };
  }
  if (game === "chunithm") {
    return { id: String(index + 1), title: `${marker}:${index}`, image: "chunithm.png" };
  }
  return { id: String(index + 1), title: `${marker}:${index}`, image_url: "ongeki.png" };
}

function validSongData(game, marker = "current", rowCount = MIN_DATA_ROWS[game]) {
  return JSON.stringify(
    Array.from({ length: rowCount }, (_value, index) => validSongRow(game, marker, index)),
  );
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

function makeStreamObject(value, etag = '"etag"') {
  const payload = bytes(value);
  return {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(payload);
        controller.close();
      },
    }),
    httpEtag: etag,
  };
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
    "songdb/data/maimai/music-ex.json": makeStreamObject('{"songs":1}', '"data-etag"'),
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
  const chuniSha = await sha256Hex(chuniBody);
  const r2 = makeR2({
    "songdb/data/chunithm/music-ex.json": makeObject("old body", '"old"', {
      rowCount: String(MIN_DATA_ROWS.chunithm),
      sha256: chuniSha,
    }),
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
  assert.equal(response.status, 207);
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

test("manual sync reports total upstream failure with a gateway error", async (t) => {
  const r2 = makeR2();
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));

  const response = await syncRequest(env(r2.bucket));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), [
    { game: "maimai", result: "error: origin HTTP 503" },
    { game: "chunithm", result: "error: origin HTTP 503" },
    { game: "ongeki", result: "error: origin HTTP 503" },
  ]);
  assert.deepEqual(r2.calls, { get: [], head: [], put: [] });
});

test("manual sync reports complete success with HTTP 200", async (t) => {
  const r2 = makeR2();
  t.mock.method(globalThis, "fetch", async (url) => {
    const game = url.includes("/maimai/")
      ? "maimai"
      : url.includes("/chunithm/")
        ? "chunithm"
        : "ongeki";
    return validOriginResponse(game, `manual:${url}`);
  });

  const response = await syncRequest(env(r2.bucket));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [
    { game: "maimai", result: "updated" },
    { game: "chunithm", result: "updated" },
    { game: "ongeki", result: "updated" },
  ]);
  assert.equal(r2.calls.put.length, 3);
  for (const [game, rowCount] of Object.entries(MIN_DATA_ROWS)) {
    const write = r2.calls.put.find(
      ({ key }) => key === `songdb/data/${game}/music-ex.json`,
    );
    assert.equal(write.options.customMetadata.rowCount, String(rowCount));
  }
});

test("unchanged legacy data is rewritten once to establish a row-count baseline", async (t) => {
  const body = validSongData("maimai", "legacy");
  const sha256 = await sha256Hex(body);
  const key = "songdb/data/maimai/music-ex.json";
  const r2 = makeR2({
    [key]: makeObject(body, '"legacy"', { sha256 }),
  });
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url === `${ORIGIN_ROOT}/maimai/data/music-ex.json`) {
      return validOriginResponse("maimai", "legacy");
    }
    return new Response(null, { status: 503 });
  });

  const response = await syncRequest(env(r2.bucket));
  const results = await response.json();
  assert.equal(response.status, 207);
  assert.equal(results[0].result, "updated");
  assert.equal(r2.calls.put.length, 1);
  assert.equal(r2.calls.put[0].key, key);
  assert.equal(r2.calls.put[0].options.customMetadata.sha256, sha256);
  assert.equal(
    r2.calls.put[0].options.customMetadata.rowCount,
    String(MIN_DATA_ROWS.maimai),
  );
});

test("sync aborts origins that exceed the bounded fetch deadline", async (t) => {
  const r2 = makeR2();
  t.mock.method(globalThis, "fetch", async (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    }),
  );

  const results = await syncAll(env(r2.bucket), { originTimeoutMs: 5 });
  assert.deepEqual(results, [
    { game: "maimai", result: "error: origin timed out after 5ms" },
    { game: "chunithm", result: "error: origin timed out after 5ms" },
    { game: "ongeki", result: "error: origin timed out after 5ms" },
  ]);
  assert.deepEqual(r2.calls, { get: [], head: [], put: [] });
});

test("sync deadline remains active while a response body is stalled", async (t) => {
  const r2 = makeR2();
  t.mock.method(globalThis, "fetch", async (_url, options) =>
    new Response(
      new ReadableStream({
        start(controller) {
          options.signal.addEventListener(
            "abort",
            () => controller.error(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        },
      }),
      { headers: { "content-type": "application/json" } },
    ),
  );

  const results = await syncAll(env(r2.bucket), { originTimeoutMs: 5 });
  assert.deepEqual(results, [
    { game: "maimai", result: "error: origin timed out after 5ms" },
    { game: "chunithm", result: "error: origin timed out after 5ms" },
    { game: "ongeki", result: "error: origin timed out after 5ms" },
  ]);
  assert.deepEqual(r2.calls, { get: [], head: [], put: [] });
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
    ["severely truncated", JSON.stringify([validSongRow("maimai")]),
      "error: origin JSON has 1 maimai records; expected at least 1000"],
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

test("rejects a large relative record-count drop after a baseline is stored", async (t) => {
  const key = "songdb/data/maimai/music-ex.json";
  const r2 = makeR2({
    [key]: makeObject(validSongData("maimai", "old", 1_600), '"old"', {
      rowCount: "1600",
      sha256: "old",
    }),
  });
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url === `${ORIGIN_ROOT}/maimai/data/music-ex.json`) {
      return validOriginResponse("maimai", "reduced");
    }
    return new Response(null, { status: 503 });
  });

  const response = await syncRequest(env(r2.bucket));
  const results = await response.json();
  assert.equal(results[0].result, "error: origin JSON record count dropped from 1600 to 1000");
  assert.deepEqual(r2.calls.head, [key]);
  assert.equal(r2.calls.put.length, 0);
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
  assert.deepEqual(JSON.parse(logMock.mock.calls[0].arguments[0]), {
    event: "songdb_sync",
    status: "ok",
    results: [
      { game: "maimai", result: "updated" },
      { game: "chunithm", result: "updated" },
      { game: "ongeki", result: "updated" },
    ],
  });
});

test("scheduled sync rejects its waitUntil task when any game fails", async (t) => {
  const r2 = makeR2();
  const { context, promises } = makeContext();
  t.mock.method(globalThis, "fetch", async (url) => {
    const game = url.includes("/maimai/")
      ? "maimai"
      : url.includes("/chunithm/")
        ? "chunithm"
        : "ongeki";
    return game === "ongeki"
      ? new Response(null, { status: 503 })
      : validOriginResponse(game, `scheduled:${url}`);
  });
  const errorMock = t.mock.method(console, "error", () => {});

  worker.scheduled({}, env(r2.bucket), context);
  assert.equal(promises.length, 1);
  await assert.rejects(promises[0], /songdb sync failed for ongeki/);
  assert.equal(errorMock.mock.callCount(), 1);
  assert.deepEqual(JSON.parse(errorMock.mock.calls[0].arguments[0]), {
    event: "songdb_sync",
    status: "error",
    results: [
      { game: "maimai", result: "updated" },
      { game: "chunithm", result: "updated" },
      { game: "ongeki", result: "error: origin HTTP 503" },
    ],
  });
});
