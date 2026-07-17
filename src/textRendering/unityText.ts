import type React from "react";
import { clampNumber } from "../numeric";
import type { UnityFontMetrics } from "../types";
import {
  alignOffset,
  decodeUnityAnchor,
  MISSING_GLYPH_CODEPOINT,
  QUESTION_MARK_CODEPOINT,
} from "./shared";

export type UnityTextGlyphLayout = {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  sourceX: number;
  sourceY: number;
  sourceW: number;
  sourceH: number;
  color: string;
};

/**
 * Lay out a legacy Unity bitmap-font run in logical pixels.
 *
 * CharacterInfo.vert uses Unity's y-up convention: the shipped atlases have
 * a negative `vert.y` (top bearing) and a negative `vert.height`. Converting
 * that rectangle to the canvas' y-down convention therefore uses `-vertY`
 * for the top and `abs(vertH)` for the height. Keeping this conversion here,
 * before any backing-store rounding, gives every glyph in a line one shared
 * baseline and avoids the per-element percentage rounding used by the DOM
 * renderer.
 */
export function layoutUnityTextPixels(
  font: UnityFontMetrics,
  text: string,
  fontSize: number,
  rectWidth: number,
  rectHeight: number,
  alignment: number,
  lineSpacing: number,
  color: string,
  fitHorizontal: boolean,
  extraCharacterSpacing: number,
  horizontalScale: number,
  glyphOffsetY: number,
  fixedGlyphTop: boolean,
): UnityTextGlyphLayout[] {
  const scale = fontSize / font.lineSpacing;
  const scaleX = clampNumber(horizontalScale, 0.1, 2);
  const lines = text.split(/\r?\n/);
  const laidOutLines = lines.map((line) => {
    const chars = Array.from(line);
    const width = chars.reduce((sum, char, index) => {
      const glyph = unityGlyph(font, char);
      const spacing = index < chars.length - 1 ? font.characterSpacing + extraCharacterSpacing : 0;
      return sum + ((glyph?.advance ?? font.lineSpacing * 0.5) + spacing) * scale * scaleX;
    }, 0);
    return { chars, width };
  });
  const maxWidth = Math.max(1, ...laidOutLines.map((line) => line.width));
  const fitScaleX = fitHorizontal ? Math.min(1, rectWidth / maxWidth) : 1;
  const lineHeight = font.lineSpacing * scale * lineSpacing;
  const totalHeight = lineHeight * Math.max(1, lines.length);
  const { horizontal, vertical } = decodeUnityAnchor(alignment);
  const topBase = alignOffset(vertical, rectHeight, totalHeight);
  const output: UnityTextGlyphLayout[] = [];

  laidOutLines.forEach((line, lineIndex) => {
    const lineWidth = line.width * fitScaleX;
    const lineLeft = alignOffset(horizontal, rectWidth, lineWidth);
    let cursor = 0;

    line.chars.forEach((char, charIndex) => {
      const glyph = unityGlyph(font, char);
      const spacing = charIndex < line.chars.length - 1 ? font.characterSpacing + extraCharacterSpacing : 0;
      const advance = ((glyph?.advance ?? font.lineSpacing * 0.5) + spacing) * scale * scaleX;
      if (glyph) {
        const [uvX, uvY, uvW, uvH] = glyph.uv;
        const [vertX, vertY, vertW, vertH] = glyph.vert;
        const sourceW = Math.abs(uvW) * font.width;
        const sourceH = Math.abs(uvH) * font.height;
        const displayW = Math.abs(vertW) * scale * scaleX * fitScaleX;
        const displayH = Math.abs(vertH) * scale;
        if (sourceW > 0 && sourceH > 0 && displayW > 0 && displayH > 0) {
          const sourceX = uvX * font.width;
          const sourceY = (1 - uvY - uvH) * font.height;
          const glyphLeft = lineLeft + (cursor + vertX * scale * scaleX) * fitScaleX;
          const glyphTop =
            topBase +
            lineIndex * lineHeight +
            (fixedGlyphTop ? 0 : (vertH < 0 ? -vertY : vertY) * scale) +
            glyphOffsetY;
          output.push({
            key: `${lineIndex}-${charIndex}-${char.codePointAt(0) ?? 0}`,
            x: glyphLeft,
            y: glyphTop,
            width: displayW,
            height: displayH,
            sourceX,
            sourceY,
            sourceW,
            sourceH,
            color,
          });
        }
      }
      cursor += advance;
    });
  });

  return output;
}

/** Compatibility adapter for the Card Viewer layer renderer. */
export function layoutUnityText(
  font: UnityFontMetrics,
  text: string,
  fontSize: number,
  rectWidth: number,
  rectHeight: number,
  alignment: number,
  lineSpacing: number,
  color: string,
  fitHorizontal: boolean,
  extraCharacterSpacing: number,
  horizontalScale: number,
  glyphOffsetY: number,
  fixedGlyphTop: boolean,
) {
  return layoutUnityTextPixels(
    font,
    text,
    fontSize,
    rectWidth,
    rectHeight,
    alignment,
    lineSpacing,
    color,
    fitHorizontal,
    extraCharacterSpacing,
    horizontalScale,
    glyphOffsetY,
    fixedGlyphTop,
  ).map((glyph) => ({
    key: glyph.key,
    style: {
      left: `${(glyph.x / rectWidth) * 100}%`,
      top: `${(glyph.y / rectHeight) * 100}%`,
      width: `${(glyph.width / rectWidth) * 100}%`,
      height: `${(glyph.height / rectHeight) * 100}%`,
    } satisfies React.CSSProperties,
    sourceX: glyph.sourceX,
    sourceY: glyph.sourceY,
    sourceW: glyph.sourceW,
    sourceH: glyph.sourceH,
    color: glyph.color,
  }));
}

export function unityGlyph(font: UnityFontMetrics, char: string) {
  const code = char.codePointAt(0) ?? 0;
  return font.chars[String(code)] ?? font.chars[MISSING_GLYPH_CODEPOINT] ?? font.chars[QUESTION_MARK_CODEPOINT];
}
