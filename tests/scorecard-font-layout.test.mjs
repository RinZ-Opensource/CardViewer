import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importTypeScriptModule } from "./helpers/import-typescript.mjs";

const { scorecardTextBackingScale } = await importTypeScriptModule(
  "src/scorecard/scorecardRenderScale.ts",
);

test("score-card text backing scale follows final zoom and DPR", () => {
  assert.equal(scorecardTextBackingScale(0.5, 1, 2), 2);
  assert.equal(scorecardTextBackingScale(0.888406, 1, 1), 1.776812);
  assert.equal(scorecardTextBackingScale(1, 1, 1), 2);
  assert.equal(scorecardTextBackingScale(1.23589, 1, 2), 2.47178);
  assert.equal(scorecardTextBackingScale(1, 2, 1), 4);
  assert.equal(scorecardTextBackingScale(2.4, 2, 1), 4);
});

test("score-card text backing scale handles invalid runtime values", () => {
  assert.equal(scorecardTextBackingScale(Number.NaN, Number.NaN), 2);
  assert.equal(scorecardTextBackingScale(0, 0, 2), 2);
  assert.equal(scorecardTextBackingScale(1, 1, 99), 4);
});

const chuniSource = await readFile(
  new URL("../src/scorecard/ChuniMusicBoxCard.tsx", import.meta.url),
  "utf8",
);
const ongekiSource = await readFile(
  new URL("../src/scorecard/OngekiMusicBtCard.tsx", import.meta.url),
  "utf8",
);
const bitmapTextSource = await readFile(
  new URL("../src/scorecard/ScorecardBitmapText.tsx", import.meta.url),
  "utf8",
);
const fontsSource = await readFile(
  new URL("../src/fonts.ts", import.meta.url),
  "utf8",
);
const chuniCss = await readFile(
  new URL("../src/styles/scorecard-chuni-box.css", import.meta.url),
  "utf8",
);
const scorecardCss = await readFile(
  new URL("../src/styles/scorecard.css", import.meta.url),
  "utf8",
);

function componentBlock(source, className) {
  const start = source.indexOf(`className="${className}"`);
  assert.notEqual(start, -1, `missing ${className}`);
  const end = source.indexOf("/>", start);
  assert.notEqual(end, -1, `unterminated ${className}`);
  return source.slice(start, end + 2);
}

function cssRule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule ${selector}`);
  return match[1];
}

function cssRules(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...source.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))].map(
    (match) => match[1],
  );
}

test("CHUNITHM applies prefab cast scale uniformly", () => {
  const title = componentBlock(chuniSource, "cmb-title");
  const artist = componentBlock(chuniSource, "cmb-artist");
  const weKanji = componentBlock(chuniSource, "cmb-we-kanji");
  const notes = componentBlock(chuniSource, "cmb-notes-name");

  assert.match(title, /fontSize=\{28\.8\}/);
  assert.match(artist, /fontSize=\{14\.4\}/);
  assert.match(weKanji, /fontSize=\{48\}/);
  assert.match(notes, /lineSpacing=\{16 \/ 14\}/);
  for (const block of [title, artist, weKanji]) {
    assert.doesNotMatch(block, /horizontalScale=/);
  }
});

test("CHUNITHM text boxes retain the calibrated optical baseline", () => {
  const positions = new Map([
    [".cmb-title", 421],
    [".cmb-artist", 469],
    [".cmb-notes-name", 564],
  ]);

  for (const [selector, top] of positions) {
    assert.match(cssRule(chuniCss, selector), new RegExp(`top:\\s*${top}px`));
    assert.doesNotMatch(cssRule(chuniCss, selector), /transform\s*:/);
    assert.match(cssRule(chuniCss, `${selector} > .scorecard-bitmap-fallback`), /translateY/);
  }
});

test("score-card bitmap text uses one scaled canvas and retains the game face", () => {
  assert.match(bitmapTextSource, /scorecardTextBackingScale/);
  assert.match(bitmapTextSource, /"⤴": "↑"/);
  assert.match(bitmapTextSource, /scorecard-bitmap-character-fallback/);
  assert.match(bitmapTextSource, /substitutedGlyphKeys\.has\(glyph\.key\)/);
  assert.match(bitmapTextSource, /style=\{\{ overflow: "hidden"/);
  assert.doesNotMatch(bitmapTextSource, /<svg/);
});

test("maimai TMP boxes retain authored alignment geometry", () => {
  assert.match(cssRule(scorecardCss, ".msc-ach"), /top:\s*518\.5px/);
  assert.match(cssRule(scorecardCss, ".msc-dx-value"), /top:\s*551\.5px/);
  assert.ok(
    cssRules(scorecardCss, ".msc-dx-max").some((rule) => /top:\s*551\.5px/.test(rule)),
  );
  assert.match(cssRule(scorecardCss, ".msc-designer-name"), /height:\s*16\.27px/);
});

test("ONGEKI notes use the authored 16px Maru atlas", () => {
  assert.match(componentBlock(ongekiSource, "omb-notes"), /fontKey="maru16"/);
  assert.match(fontsSource, /maru16:\s*"FONT_SegaMaruGothic_16px\.json"/);
});
