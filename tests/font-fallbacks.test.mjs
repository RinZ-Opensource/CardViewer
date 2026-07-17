import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/styles/base.css", import.meta.url), "utf8");

function fontFace(family) {
  const escaped = family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(
    new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*"${escaped}";[^}]*\\}`, "s"),
  );
  assert.ok(match, `missing @font-face alias: ${family}`);
  return match[0];
}

function rootVariable(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}:\\s*([^;]+);`));
  assert.ok(match, `missing root font variable: ${name}`);
  return match[1];
}

const aliases = [
  ["CardViewer Fallback Kaku DB", "ZenKakuGothicNew-Bold.ttf"],
  ["CardViewer Fallback Maru DB", "ZenMaruGothic-Bold.ttf"],
  ["CardViewer Fallback NewRodin", "ZenKakuGothicNew-Bold.ttf"],
  ["CardViewer Fallback NewRodin EB", "ZenKakuGothicNew-Black.ttf"],
];

test("score-card role aliases pin the intended physical Zen face", () => {
  for (const [family, file] of aliases) {
    const face = fontFace(family);
    assert.match(face, new RegExp(`/${file.replaceAll(".", "\\.")}\\"\\) format\\("truetype"\\)`));
    assert.match(face, /font-weight:\s*400;/);
    assert.match(face, /font-style:\s*normal;/);
  }
});

test("score-card variables use role aliases instead of the Regular-capable families", () => {
  const variables = [
    ["--font-mai-kaku", "CardViewer Fallback Kaku DB"],
    ["--font-mai-maru", "CardViewer Fallback Maru DB"],
    ["--font-mai-rodin", "CardViewer Fallback NewRodin"],
    ["--font-mai-rodin-eb", "CardViewer Fallback NewRodin EB"],
  ];

  for (const [variable, family] of variables) {
    const value = rootVariable(variable);
    assert.match(value, new RegExp(`^"${family}"`));
    assert.doesNotMatch(value, /"CardViewer Zen (?:Kaku|Maru)"/);
  }
});

test("ordinary Maru remains a true Regular-capable family", () => {
  assert.match(rootVariable("--font-sega-maru"), /^"CardViewer Zen Maru"/);
  assert.match(rootVariable("--font-sega-maru-db"), /^"CardViewer Zen Maru"/);
  const regular = fontFace("CardViewer Zen Maru");
  assert.match(regular, /\/ZenMaruGothic-Regular\.ttf"\) format\("truetype"\)/);
  assert.match(regular, /font-weight:\s*400;/);
  assert.match(
    css,
    /font-family:\s*"CardViewer Zen Maru";[\s\S]*?ZenMaruGothic-Bold\.ttf[\s\S]*?font-weight:\s*700;/,
  );
});
