import assert from "node:assert/strict";
import test from "node:test";
import { importTypeScriptModule } from "./helpers/import-typescript.mjs";

const {
  parseOnlineManifestIndex,
  parseOnlineManifestShard,
  parseScanResult,
  parseSongDbEntries,
  parseTmpFontMetrics,
  parseUnityFontMetrics,
} = await importTypeScriptModule("src/runtimeJson.ts");

const stats = {
  chuCards: 1,
  maiCards: 0,
  maiCardTypes: 0,
  maiCardCharas: 0,
  mu3AssetCards: 0,
  mu3XmlRecords: 0,
  pngAssets: 2,
  unityBundles: 0,
  unityBundleBytes: 0,
};

const card = {
  id: "CHU:0001",
  game: "CHU",
  recordType: "card",
  dataName: "Card0001",
  displayName: "Test card",
  characterName: "",
  skillName: "",
  skillText: "",
  rareType: null,
  labelType: null,
  difType: null,
  miss: null,
  combo: null,
  chain: null,
  imagePath: null,
  thumbnailPath: null,
  assetLayers: [],
  editableFields: [],
  printFields: [],
};

test("validates Unity and TMP font metric boundaries", () => {
  const unity = {
    name: "SegaMaruGothic_16px",
    lineSpacing: 16,
    characterSpacing: 0,
    texture: "FONT_SegaMaruGothic_16px_alpha.png",
    width: 2048,
    height: 2048,
    chars: {
      "65": { index: 65, uv: [0, 0, 0.01, 0.02], vert: [0, 12, 8, -12], advance: 8 },
    },
  };
  assert.equal(parseUnityFontMetrics(unity, "unit font"), unity);

  const tmp = {
    name: "SEGA HUMMING",
    fontInfo: { PointSize: 48, LineHeight: 50, Ascender: 42, Descender: -6, Padding: 5 },
    texture: "FONT_TMP.png",
    width: 4096,
    height: 4096,
    glyphs: {
      "65": {
        id: 65,
        x: 1,
        y: 2,
        width: 20,
        height: 30,
        xOffset: 0,
        yOffset: 25,
        xAdvance: 21,
        scale: 1,
      },
    },
  };
  assert.equal(parseTmpFontMetrics(tmp, "unit TMP font"), tmp);
});

test("rejects malformed font metrics with an actionable field path", () => {
  assert.throws(
    () =>
      parseUnityFontMetrics(
        {
          name: "broken",
          lineSpacing: 16,
          characterSpacing: 0,
          texture: "../font.png",
          width: 2048,
          height: 2048,
          chars: { "65": { index: 65, uv: [0, 0, 1, 1], vert: [0, 0, 1, 1], advance: 1 } },
        },
        "broken font",
      ),
    /Invalid broken font at \$\.texture: expected a local PNG or WebP filename/,
  );

  assert.throws(
    () =>
      parseTmpFontMetrics(
        {
          name: "broken",
          fontInfo: { PointSize: 48, LineHeight: 50, Ascender: 42, Descender: -6, Padding: 5 },
          texture: "font.png",
          width: 4096,
          height: 4096,
          glyphs: { "65": { id: 65, x: 0, y: 0, width: 1, height: 1, xOffset: 0 } },
        },
        "broken TMP font",
      ),
    /Invalid broken TMP font at \$\.glyphs\["65"\]\.yOffset/,
  );
});

test("validates manifest indexes, shards, and legacy results", () => {
  const index = {
    packageRoot: "package",
    streamingAssets: "StreamingAssets",
    stats,
    warnings: [],
    totalCards: 1,
    shards: [{ key: "chu", game: "CHU", href: "cards-chu.json", cardCount: 1 }],
  };
  assert.equal(parseOnlineManifestIndex(index, "index"), index);

  const shard = { key: "chu", game: "CHU", cards: [card] };
  assert.equal(parseOnlineManifestShard(shard, "shard"), shard);

  const legacy = {
    packageRoot: "package",
    streamingAssets: "StreamingAssets",
    stats,
    warnings: [],
    cards: [card],
  };
  assert.equal(parseScanResult(legacy, "legacy"), legacy);
});

test("rejects malformed manifest envelopes before callers trust them", () => {
  assert.throws(
    () =>
      parseOnlineManifestIndex(
        {
          packageRoot: "package",
          streamingAssets: "StreamingAssets",
          stats,
          warnings: [],
          totalCards: 1,
          shards: {},
        },
        "bad index",
      ),
    /Invalid bad index at \$\.shards: expected an array/,
  );

  assert.throws(
    () => parseOnlineManifestShard({ key: "chu", game: "CHU", cards: [{ ...card, game: "?" }] }),
    /Invalid manifest shard at \$\.cards\[0\]\.game/,
  );

  assert.throws(
    () =>
      parseScanResult({
        packageRoot: "package",
        streamingAssets: "StreamingAssets",
        stats: { ...stats, pngAssets: -1 },
        warnings: [],
        cards: [],
      }),
    /Invalid legacy manifest at \$\.stats\.pngAssets/,
  );
});

test("SongDB accepts only a top-level array of flat string rows", () => {
  const rows = [{ id: "1", title: "Song", bpm: "120" }, { title: "Another" }];
  const chuniRows = rows.map((row, index) => ({ ...row, image: `jacket-${index}.png` }));
  assert.equal(parseSongDbEntries(chuniRows, "chunithm", "songdb test"), chuniRows);

  assert.throws(
    () => parseSongDbEntries({ rows }, "chunithm", "songdb test"),
    /Invalid songdb test at \$: expected an array/,
  );
  assert.throws(
    () => parseSongDbEntries([{ id: 1 }], "chunithm", "songdb test"),
    /Invalid songdb test at \$\[0\]\["id"\]: expected a string/,
  );
  assert.throws(
    () => parseSongDbEntries(["not a row"], "chunithm", "songdb test"),
    /Invalid songdb test at \$\[0\]: expected an object/,
  );
  assert.throws(
    () => parseSongDbEntries([], "maimai", "songdb test"),
    /Invalid songdb test at \$: expected a non-empty song array/,
  );
  assert.throws(
    () => parseSongDbEntries([{ title: "UTAGE" }], "maimai", "songdb test"),
    /at least one row with non-empty title, image_url, sort/,
  );
});
