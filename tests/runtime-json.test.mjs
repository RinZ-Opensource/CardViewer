import assert from "node:assert/strict";
import test from "node:test";
import { importTypeScriptModuleGraph } from "./helpers/import-typescript.mjs";

const {
  parseOnlineManifestIndex,
  parseOnlineManifestShard,
  parseScanResult,
  parseSongDbEntries,
  parseTmpFontMetrics,
  parseUnityFontMetrics,
} = await importTypeScriptModuleGraph("src/runtimeJson.ts");

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

  assert.throws(
    () =>
      parseOnlineManifestShard(
        {
          key: "chu",
          game: "CHU",
          cards: [
            {
              ...card,
              printFields: [
                {
                  key: "frame",
                  label: "Frame",
                  fieldType: "select",
                  value: "gold",
                  options: [{ value: "gold", label: 42 }],
                },
              ],
            },
          ],
        },
        "deep shard",
      ),
    /Invalid deep shard at \$\.cards\[0\]\.printFields\[0\]\.options\[0\]\.label: expected a string/,
  );
});

test("rejects invalid parser roots with source-specific errors", () => {
  const objectParsers = [
    [parseUnityFontMetrics, null, "root Unity"],
    [parseTmpFontMetrics, [], "root TMP"],
    [parseOnlineManifestIndex, "index", "root index"],
    [parseOnlineManifestShard, 1, "root shard"],
    [parseScanResult, false, "root legacy"],
  ];

  for (const [parse, value, source] of objectParsers) {
    assert.throws(() => parse(value, source), {
      message: `Invalid ${source} at $: expected an object`,
    });
  }

  assert.throws(() => parseSongDbEntries({}, "maimai", "root songdb"), {
    message: "Invalid root songdb at $: expected an array",
  });
});

test("preserves each parser's default source label", () => {
  const cases = [
    [() => parseUnityFontMetrics(null), "Invalid Unity font metrics at $: expected an object"],
    [() => parseTmpFontMetrics(null), "Invalid TMP font metrics at $: expected an object"],
    [() => parseOnlineManifestIndex(null), "Invalid manifest index at $: expected an object"],
    [() => parseOnlineManifestShard(null), "Invalid manifest shard at $: expected an object"],
    [() => parseScanResult(null), "Invalid legacy manifest at $: expected an object"],
    [
      () => parseSongDbEntries({}, "ongeki"),
      "Invalid songdb ongeki at $: expected an array",
    ],
  ];

  for (const [parse, message] of cases) {
    assert.throws(parse, { message });
  }
});

test("SongDB accepts only a top-level array of flat string rows", () => {
  const validGames = [
    ["maimai", { title: "Song", image_url: "maimai.png", sort: "1" }],
    ["chunithm", { title: "Song", image: "chunithm.png", id: "1" }],
    ["ongeki", { title: "Song", image_url: "ongeki.png", id: "1" }],
  ];
  for (const [game, row] of validGames) {
    const rows = [row, { title: "Partial row" }];
    assert.equal(parseSongDbEntries(rows, game, `songdb ${game} test`), rows);
  }

  assert.throws(
    () => parseSongDbEntries({ rows: [] }, "chunithm", "songdb test"),
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
  const requiredFields = [
    ["maimai", "title, image_url, sort"],
    ["chunithm", "title, image, id"],
    ["ongeki", "title, image_url, id"],
  ];
  for (const [game, fields] of requiredFields) {
    assert.throws(
      () => parseSongDbEntries([{ title: "Incomplete" }], game, `bad ${game}`),
      { message: `Invalid bad ${game} at $: expected at least one row with non-empty ${fields}` },
    );
  }
});
