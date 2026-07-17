import assert from "node:assert/strict";
import test from "node:test";
import { importTypeScriptModule } from "./helpers/import-typescript.mjs";

const { isStaticAssetPath, preloadWebImageUrl, resolveWebImageUrl } = await importTypeScriptModule(
  "src/imageLoader.ts",
);
const {
  buildOrderedAssetLoadPlans,
  loadEntriesIndependently,
  loadFirstAvailable,
  r2AssetFileName,
} = await importTypeScriptModule("src/assetLoading.ts");

test("maps generated R2 layer stems to the canonical lossless WebP key", () => {
  assert.equal(r2AssetFileName("ui_cardchara_400101"), "ui_cardchara_400101.webp");
  assert.equal(r2AssetFileName("ui_cardbase_0000004_400001.webp"), "ui_cardbase_0000004_400001.webp");
  assert.equal(r2AssetFileName("legacy-layer.png"), "legacy-layer.png");
});

test("accepts only the same-origin R2-backed browser routes", async () => {
  const originalWindow = globalThis.window;
  globalThis.window = { location: { origin: "https://cv.example" } };
  try {
    for (const path of [
      "/official/generated/assets/card.webp",
      "/official/scorecard/mai/jacket.png?v=1",
      "/official/cardviewer/v1/runtime/frame.png",
      "https://cv.example/official/cardviewer/v1/fonts/zen/font.ttf",
    ]) {
      assert.equal(isStaticAssetPath(path), true, path);
      assert.equal(await resolveWebImageUrl(path), path);
    }

    for (const path of [
      "data:image/png;base64,AAAA",
      "https://assets.example/official/generated/card.png",
      "/img/fallback.png",
      "/official/private/font.ttf",
      "/official/generated/.logs/log.png",
      "/official/generated/%2e%2e/secret.png",
      "/official/generated/a//b.png",
      "C:\\assets\\card.png",
    ]) {
      assert.equal(isStaticAssetPath(path), false, path);
      await assert.rejects(resolveWebImageUrl(path), /non-R2 image path/);
    }
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("preload rejects a missing R2 object and aborts an obsolete image decode", async () => {
  const originalImage = globalThis.Image;
  const instances = [];
  class FakeImage {
    constructor() {
      instances.push(this);
    }
    removeAttribute(name) {
      if (name === "src") this.src = "";
    }
  }
  globalThis.Image = FakeImage;

  try {
    const missing = preloadWebImageUrl("/official/generated/assets/chu/missing.webp");
    await Promise.resolve();
    instances[0].onerror();
    await assert.rejects(missing, /R2 image object unavailable/);

    const controller = new AbortController();
    const obsolete = preloadWebImageUrl(
      "/official/generated/assets/chu/obsolete.webp",
      controller.signal,
    );
    await Promise.resolve();
    controller.abort(new DOMException("selection changed", "AbortError"));
    await assert.rejects(obsolete, { name: "AbortError" });
    assert.equal(instances[1].src, "");
  } finally {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
  }
});

test("loads a dynamic MAI layer before its manifest fallback", async () => {
  const plans = buildOrderedAssetLoadPlans([
    { key: "maiChara", path: "/official/generated/dynamic-chara.png" },
    { key: "maiMask", path: "/official/generated/dynamic-mask.png" },
    { key: "maiCharaFallback", path: "/official/generated/manifest-chara.webp" },
    { key: "maiMaskFallback", path: "/official/generated/manifest-mask.webp" },
  ]);
  assert.deepEqual(plans, [
    {
      key: "maiChara",
      candidates: [
        { key: "maiChara", path: "/official/generated/dynamic-chara.png" },
        { key: "maiCharaFallback", path: "/official/generated/manifest-chara.webp" },
      ],
    },
    {
      key: "maiMask",
      candidates: [
        { key: "maiMask", path: "/official/generated/dynamic-mask.png" },
        { key: "maiMaskFallback", path: "/official/generated/manifest-mask.webp" },
      ],
    },
  ]);

  const attempts = [];
  const loaded = await loadFirstAvailable(plans[1].candidates, async (candidate) => {
    attempts.push(candidate.path);
    if (candidate.key === "maiMask") throw new Error("missing dynamic R2 object");
    return candidate.path;
  });
  assert.deepEqual(attempts, [
    "/official/generated/dynamic-mask.png",
    "/official/generated/manifest-mask.webp",
  ]);
  assert.equal(loaded.candidate.key, "maiMaskFallback");
  assert.equal(loaded.value, "/official/generated/manifest-mask.webp");
});

test("retains successful Unity font catalogs when one sibling fails", async () => {
  const failures = [];
  const fonts = await loadEntriesIndependently(
    [
      ["kaku40", "kaku40.json"],
      ["maru32", "maru32.json"],
      ["kaku16", "kaku16.json"],
      ["maru16", "maru16.json"],
    ],
    async (file) => {
      if (file === "maru32.json") throw new Error("catalog unavailable");
      return { file };
    },
    (key, file) => failures.push([key, file]),
  );
  assert.deepEqual(fonts, {
    kaku40: { file: "kaku40.json" },
    kaku16: { file: "kaku16.json" },
    maru16: { file: "maru16.json" },
  });
  assert.deepEqual(failures, [["maru32", "maru32.json"]]);
});
