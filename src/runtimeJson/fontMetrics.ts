import type { TmpFontMetrics, UnityFontMetrics } from "../types";
import {
  array,
  finiteNumber,
  invalid,
  nonNegativeInteger,
  record,
  string,
} from "./validation";

function positiveInteger(value: unknown, source: string, path: string): number {
  const parsed = finiteNumber(value, source, path);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return invalid(source, path, "a positive integer");
  }
  return parsed;
}

function numberTuple4(
  value: unknown,
  source: string,
  path: string,
): [number, number, number, number] {
  const values = array(value, source, path);
  if (values.length !== 4) invalid(source, path, "an array of four finite numbers");
  return values.map((entry, index) => finiteNumber(entry, source, `${path}[${index}]`)) as [
    number,
    number,
    number,
    number,
  ];
}

function safeAtlasFile(value: unknown, source: string, path: string): string {
  const file = string(value, source, path, false);
  if (!/^[A-Za-z0-9_.-]+\.(?:png|webp)$/i.test(file)) {
    invalid(source, path, "a local PNG or WebP filename");
  }
  return file;
}

/** Validate a Unity bitmap-font catalog before render code trusts its metrics. */
export function parseUnityFontMetrics(
  value: unknown,
  source = "Unity font metrics",
): UnityFontMetrics {
  const metrics = record(value, source, "$");
  string(metrics.name, source, "$.name", false);
  const lineSpacing = finiteNumber(metrics.lineSpacing, source, "$.lineSpacing");
  if (lineSpacing <= 0) invalid(source, "$.lineSpacing", "a positive finite number");
  finiteNumber(metrics.characterSpacing, source, "$.characterSpacing");
  safeAtlasFile(metrics.texture, source, "$.texture");
  positiveInteger(metrics.width, source, "$.width");
  positiveInteger(metrics.height, source, "$.height");

  const chars = record(metrics.chars, source, "$.chars");
  const glyphs = Object.entries(chars);
  if (glyphs.length === 0) invalid(source, "$.chars", "at least one glyph");
  for (const [codepoint, rawGlyph] of glyphs) {
    const path = `$.chars[${JSON.stringify(codepoint)}]`;
    if (!/^\d+$/.test(codepoint)) invalid(source, path, "a numeric codepoint key");
    const glyph = record(rawGlyph, source, path);
    const index = nonNegativeInteger(glyph.index, source, `${path}.index`);
    if (index !== Number(codepoint)) invalid(source, `${path}.index`, `codepoint ${codepoint}`);
    const uv = numberTuple4(glyph.uv, source, `${path}.uv`);
    if (uv.some((coordinate) => coordinate < 0 || coordinate > 1)) {
      invalid(source, `${path}.uv`, "normalized coordinates between 0 and 1");
    }
    numberTuple4(glyph.vert, source, `${path}.vert`);
    finiteNumber(glyph.advance, source, `${path}.advance`);
  }

  return metrics as UnityFontMetrics;
}

/** Validate a TextMeshPro bitmap-font catalog before canvas rendering. */
export function parseTmpFontMetrics(
  value: unknown,
  source = "TMP font metrics",
): TmpFontMetrics {
  const metrics = record(value, source, "$");
  string(metrics.name, source, "$.name", false);
  safeAtlasFile(metrics.texture, source, "$.texture");
  positiveInteger(metrics.width, source, "$.width");
  positiveInteger(metrics.height, source, "$.height");

  const fontInfo = record(metrics.fontInfo, source, "$.fontInfo");
  for (const key of ["PointSize", "LineHeight"] as const) {
    const number = finiteNumber(fontInfo[key], source, `$.fontInfo.${key}`);
    if (number <= 0) invalid(source, `$.fontInfo.${key}`, "a positive finite number");
  }
  finiteNumber(fontInfo.Ascender, source, "$.fontInfo.Ascender");
  finiteNumber(fontInfo.Descender, source, "$.fontInfo.Descender");
  const padding = finiteNumber(fontInfo.Padding, source, "$.fontInfo.Padding");
  if (padding < 0) invalid(source, "$.fontInfo.Padding", "a non-negative finite number");

  const glyphs = record(metrics.glyphs, source, "$.glyphs");
  const entries = Object.entries(glyphs);
  if (entries.length === 0) invalid(source, "$.glyphs", "at least one glyph");
  for (const [codepoint, rawGlyph] of entries) {
    const path = `$.glyphs[${JSON.stringify(codepoint)}]`;
    if (!/^\d+$/.test(codepoint)) invalid(source, path, "a numeric codepoint key");
    const glyph = record(rawGlyph, source, path);
    const id = nonNegativeInteger(glyph.id, source, `${path}.id`);
    if (id !== Number(codepoint)) invalid(source, `${path}.id`, `codepoint ${codepoint}`);
    for (const key of [
      "x",
      "y",
      "width",
      "height",
      "xOffset",
      "yOffset",
      "xAdvance",
      "scale",
    ] as const) {
      finiteNumber(glyph[key], source, `${path}.${key}`);
    }
    if (Number(glyph.width) < 0 || Number(glyph.height) < 0) {
      invalid(source, path, "non-negative glyph dimensions");
    }
    if (Number(glyph.scale) <= 0) invalid(source, `${path}.scale`, "a positive finite number");
  }

  return metrics as TmpFontMetrics;
}
