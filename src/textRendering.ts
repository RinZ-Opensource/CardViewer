import React from "react";
import { OFFICIAL_ASSET_ROOT } from "./constants";
import { LruMap } from "./lru";
import { Bounds, TmpFontMetrics, TmpGlyph, UnityFontMetrics } from "./types";

// Cap the canvas backing-store scale: 1x floor for crispness, 2.5x ceiling to
// bound memory/CPU on hi-DPI displays; assume 2x during SSR (no window).
const CANVAS_MIN_DPR = 1;
const CANVAS_MAX_DPR = 2.5;
const SSR_DPR = 2;

export function getPixelRatio() {
  return typeof window === "undefined"
    ? SSR_DPR
    : Math.max(CANVAS_MIN_DPR, Math.min(CANVAS_MAX_DPR, window.devicePixelRatio || 1));
}

// Fallback glyph codepoints when a character is missing from the atlas:
// U+25A1 white square, then '?'.
const MISSING_GLYPH_CODEPOINT = "9633";
const QUESTION_MARK_CODEPOINT = "63";

// Unity TextAnchor grid: alignment 0-8 = vertical*3 + horizontal, each axis
// 0=start, 1=center, 2=end.
function decodeUnityAnchor(alignment: number) {
  return { horizontal: alignment % 3, vertical: Math.floor(alignment / 3) };
}

// Offset of `content` within `container` for anchor pos 0=start/1=center/2=end.
function alignOffset(pos: number, container: number, content: number) {
  if (pos === 1) return (container - content) / 2;
  if (pos === 2) return container - content;
  return 0;
}

export function renderCanvasText(
  canvas: HTMLCanvasElement,
  text: string,
  options: {
    w: number;
    h: number;
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    alignment: number;
    color: string;
    lineSpacing: number;
    fitHorizontal: boolean;
    characterSpacing: number;
  },
) {
  const pixelRatio = getPixelRatio();
  const canvasWidth = Math.max(1, Math.ceil(options.w * pixelRatio));
  const canvasHeight = Math.max(1, Math.ceil(options.h * pixelRatio));
  if (canvas.width !== canvasWidth) canvas.width = canvasWidth;
  if (canvas.height !== canvasHeight) canvas.height = canvasHeight;

  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  context.save();
  context.scale(pixelRatio, pixelRatio);
  context.fillStyle = options.color;
  context.font = `${options.fontWeight} ${options.fontSize}px ${options.fontFamily}`;
  context.textBaseline = "top";

  const lines = text.split(/\r?\n/);
  const lineHeight = options.fontSize * options.lineSpacing;
  const totalHeight = lineHeight * Math.max(1, lines.length);
  const { horizontal, vertical } = decodeUnityAnchor(options.alignment);
  const top = alignOffset(vertical, options.h, totalHeight);

  lines.forEach((line, lineIndex) => {
    const lineWidth = Math.max(1, measureCanvasLine(context, line, options.characterSpacing));
    const fitScale = options.fitHorizontal ? Math.min(1, options.w / lineWidth) : 1;
    const drawWidth = lineWidth * fitScale;
    const left = alignOffset(horizontal, options.w, drawWidth);
    context.save();
    context.translate(left, top + lineIndex * lineHeight);
    context.scale(fitScale, 1);
    drawCanvasLine(context, line, options.characterSpacing);
    context.restore();
  });
  context.restore();
}

export function measureCanvasLine(context: CanvasRenderingContext2D, line: string, characterSpacing: number) {
  if (!line) return 0;
  if (!characterSpacing) return context.measureText(line).width;
  let width = 0;
  for (const char of Array.from(line)) {
    width += context.measureText(char).width;
  }
  return width + Math.max(0, Array.from(line).length - 1) * characterSpacing;
}

export function drawCanvasLine(context: CanvasRenderingContext2D, line: string, characterSpacing: number) {
  if (!characterSpacing) {
    context.fillText(line, 0, 0);
    return;
  }
  let x = 0;
  for (const char of Array.from(line)) {
    context.fillText(char, x, 0);
    x += context.measureText(char).width + characterSpacing;
  }
}

export function waitForCanvasFont(fontFamily: string, fontSize: number) {
  if (typeof document === "undefined" || !("fonts" in document)) {
    return Promise.resolve();
  }

  const families = fontFamily
    .split(",")
    .map((family) => family.trim())
    .filter(Boolean)
    .slice(0, 3);

  return Promise.allSettled([
    ...families.map((family) => document.fonts.load(`700 ${fontSize}px ${family}`)),
    document.fonts.ready,
  ]).then(() => undefined);
}

export type TmpTextVariant = "main" | "shadow";
export type TmpHorizontalAlign = "left" | "center" | "right";
export type TmpVerticalAlign = "top" | "middle" | "bottom";
export const TMP_TEXT_PADDING = 36;

// Map TMP's string aligns onto the same 0=start / 1=center / 2=end index the
// Unity anchor helpers use, so all three text pipelines share alignOffset.
const TMP_H_INDEX: Record<TmpHorizontalAlign, number> = { left: 0, center: 1, right: 2 };
const TMP_V_INDEX: Record<TmpVerticalAlign, number> = { top: 0, middle: 1, bottom: 2 };

// Face / outline tints (RGB) per variant, mirroring the in-game TMP material.
const TMP_FACE_COLOR: Record<TmpTextVariant, number[]> = {
  main: [255, 255, 255],
  shadow: [38, 146, 192],
};
const TMP_OUTLINE_COLOR: Record<TmpTextVariant, number[]> = {
  main: [37, 146, 193],
  shadow: [30, 128, 178],
};

export type TmpTextRenderOptions = {
  w: number;
  h: number;
  padding: number;
  fontSize: number;
  variant: TmpTextVariant;
  characterSpacing: number;
  autoSize: boolean;
  minFontSize: number;
  horizontalAlign: TmpHorizontalAlign;
  verticalAlign: TmpVerticalAlign;
  maskIncludeUnderlay?: boolean;
};

export type RasterizedTextLayer = {
  colorCanvas: HTMLCanvasElement;
  maskCanvas: HTMLCanvasElement;
  bounds: Bounds;
};

export function clearCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  context?.clearRect(0, 0, canvas.width, canvas.height);
}

// The atlas cache holds one image per font texture (a handful), so it needs no
// bound. The per-glyph canvas cache is keyed by glyph × size × kind × color and
// can grow with the variety of rendered text, so cap it with an LRU.
export const tmpAtlasCache = new Map<string, Promise<HTMLImageElement>>();
export const TMP_GLYPH_CANVAS_CACHE_MAX = 4096;
export const tmpGlyphCanvasCache = new LruMap<string, HTMLCanvasElement>({
  maxEntries: TMP_GLYPH_CANVAS_CACHE_MAX,
});

export function loadTmpAtlas(font: TmpFontMetrics) {
  const src = `${OFFICIAL_ASSET_ROOT}${font.texture}`;
  const cached = tmpAtlasCache.get(src);
  if (cached) return cached;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load ${font.texture}`));
    image.src = src;
  });
  tmpAtlasCache.set(src, promise);
  return promise;
}

export function renderTmpText(
  canvas: HTMLCanvasElement,
  atlas: HTMLImageElement,
  font: TmpFontMetrics,
  text: string,
  options: TmpTextRenderOptions,
): boolean {
  const rasterized = rasterizeTmpText(atlas, font, text, options);
  if (!rasterized) {
    clearCanvas(canvas);
    return false;
  }

  if (canvas.width !== rasterized.colorCanvas.width) canvas.width = rasterized.colorCanvas.width;
  if (canvas.height !== rasterized.colorCanvas.height) canvas.height = rasterized.colorCanvas.height;
  const context = canvas.getContext("2d");
  if (!context) return false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(rasterized.colorCanvas, 0, 0);
  return rasterized.bounds.w > 0 && rasterized.bounds.h > 0;
}

export function rasterizeTmpText(
  atlas: HTMLImageElement,
  font: TmpFontMetrics,
  text: string,
  options: TmpTextRenderOptions,
): RasterizedTextLayer | null {
  const pixelRatio = getPixelRatio();
  const logicalWidth = options.w + options.padding * 2;
  const logicalHeight = options.h + options.padding * 2;
  const canvasWidth = Math.max(1, Math.ceil(logicalWidth * pixelRatio));
  const canvasHeight = Math.max(1, Math.ceil(logicalHeight * pixelRatio));

  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = canvasWidth;
  colorCanvas.height = canvasHeight;
  const colorContext = colorCanvas.getContext("2d", { willReadFrequently: true });
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = canvasWidth;
  maskCanvas.height = canvasHeight;
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!colorContext || !maskContext) return null;

  const lines = text.split(/\r?\n/);
  let effectiveSize = options.fontSize;
  if (options.autoSize) {
    const widest = Math.max(
      1,
      ...lines.map((line) => measureTmpLine(font, line, effectiveSize, options.characterSpacing)),
    );
    if (widest > options.w) {
      effectiveSize = Math.max(options.minFontSize, effectiveSize * (options.w / widest));
    }
  }

  const fontScale = effectiveSize / font.fontInfo.PointSize;
  const lineHeight = font.fontInfo.LineHeight * fontScale;
  const totalHeight = lineHeight * Math.max(1, lines.length);
  const top = options.padding + alignOffset(TMP_V_INDEX[options.verticalAlign], options.h, totalHeight);
  const mainColor = TMP_FACE_COLOR[options.variant];
  const outlineColor = TMP_OUTLINE_COLOR[options.variant];
  lines.forEach((line, lineIndex) => {
    const lineWidth = measureTmpLine(font, line, effectiveSize, options.characterSpacing);
    const originX = options.padding + alignOffset(TMP_H_INDEX[options.horizontalAlign], options.w, lineWidth);
    const baseline = top + lineIndex * lineHeight + font.fontInfo.Ascender * fontScale;
    const sharedRun = {
      dpr: pixelRatio,
      fontScale,
      baseline,
      originX,
      characterSpacing: options.characterSpacing,
      offsetX: 0,
      offsetY: 0,
    };
    const underlayRun = {
      ...sharedRun,
      offsetX: options.variant === "main" ? 1.1 : 0.8,
      offsetY: options.variant === "main" ? 1.1 : 0.8,
    };
    drawTmpRun(colorContext, atlas, font, line, {
      ...underlayRun,
      color: [0, 0, 0],
      kind: "underlay",
      alphaScale: options.variant === "main" ? 0.46 : 0.36,
    });
    drawTmpRun(colorContext, atlas, font, line, {
      ...sharedRun,
      color: outlineColor,
      kind: "outline",
      alphaScale: 1,
    });
    drawTmpRun(colorContext, atlas, font, line, {
      ...sharedRun,
      color: mainColor,
      kind: "face",
      alphaScale: 1,
    });
    if (options.maskIncludeUnderlay) {
      drawTmpRun(maskContext, atlas, font, line, {
        ...underlayRun,
        color: [255, 255, 255],
        kind: "underlay",
        alphaScale: 1,
      });
    }
    drawTmpRun(maskContext, atlas, font, line, {
      ...sharedRun,
      color: [255, 255, 255],
      kind: "outline",
      alphaScale: 1,
    });
    drawTmpRun(maskContext, atlas, font, line, {
      ...sharedRun,
      color: [255, 255, 255],
      kind: "face",
      alphaScale: 1,
    });
  });

  const bounds = canvasAlphaBounds(maskContext, canvasWidth, canvasHeight, pixelRatio);
  if (bounds.w <= 0 || bounds.h <= 0) return null;
  return {
    colorCanvas,
    maskCanvas,
    bounds,
  };
}

export function drawTmpRun(
  context: CanvasRenderingContext2D,
  atlas: HTMLImageElement,
  font: TmpFontMetrics,
  line: string,
  options: {
    dpr: number;
    fontScale: number;
    baseline: number;
    originX: number;
    characterSpacing: number;
    color: number[];
    kind: "face" | "outline" | "underlay";
    alphaScale: number;
    offsetX: number;
    offsetY: number;
  },
): number {
  let cursor = options.originX;
  let drawnGlyphCount = 0;
  Array.from(line).forEach((char) => {
    const glyph = tmpGlyph(font, char);
    const advance = ((glyph?.xAdvance ?? font.fontInfo.PointSize * 0.5) + options.characterSpacing) * options.fontScale;
    if (
      !glyph ||
      glyph.width <= 0 ||
      glyph.height <= 0 ||
      glyph.x < 0 ||
      glyph.y < 0 ||
      glyph.x + glyph.width > font.width ||
      glyph.y + glyph.height > font.height
    ) {
      cursor += advance;
      return;
    }

    const destX = (cursor + glyph.xOffset * options.fontScale + options.offsetX) * options.dpr;
    const destY =
      (options.baseline - glyph.yOffset * options.fontScale + options.offsetY) * options.dpr;
    const destW = Math.max(1, Math.ceil(glyph.width * options.fontScale * options.dpr));
    const destH = Math.max(1, Math.ceil(glyph.height * options.fontScale * options.dpr));
    const glyphCanvas = renderTmpGlyphCanvas(atlas, glyph, destW, destH, options);
    context.drawImage(glyphCanvas, Math.round(destX), Math.round(destY));
    drawnGlyphCount += 1;
    cursor += advance;
  });
  return drawnGlyphCount;
}

export function renderTmpGlyphCanvas(
  atlas: HTMLImageElement,
  glyph: TmpGlyph,
  width: number,
  height: number,
  options: {
    color: number[];
    kind: "face" | "outline" | "underlay";
    alphaScale: number;
  },
) {
  const cacheKey = [
    glyph.id,
    width,
    height,
    options.kind,
    options.alphaScale,
    options.color.join("."),
  ].join("|");
  const cached = tmpGlyphCanvasCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return canvas;

  context.drawImage(atlas, glyph.x, glyph.y, glyph.width, glyph.height, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const sdf = data[index + 3];
    const alpha = tmpSdfAlpha(sdf, options.kind) * options.alphaScale;
    data[index] = options.color[0];
    data[index + 1] = options.color[1];
    data[index + 2] = options.color[2];
    data[index + 3] = Math.round(alpha * 255);
  }
  context.putImageData(imageData, 0, 0);
  tmpGlyphCanvasCache.set(cacheKey, canvas);
  return canvas;
}

export function canvasAlphaBounds(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  pixelRatio: number,
): Bounds {
  const pixels = context.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (alpha <= 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  return {
    x: minX / pixelRatio,
    y: minY / pixelRatio,
    w: (maxX - minX + 1) / pixelRatio,
    h: (maxY - minY + 1) / pixelRatio,
  };
}

// Per-layer SDF coverage: `edge` is the ~50% coverage distance sample (0-255),
// `softness` the antialiasing half-width around it.
const SDF_THRESHOLDS: Record<"face" | "outline" | "underlay", { edge: number; softness: number }> = {
  face: { edge: 152, softness: 22 },
  outline: { edge: 88, softness: 34 },
  underlay: { edge: 74, softness: 42 },
};

export function tmpSdfAlpha(value: number, kind: "face" | "outline" | "underlay") {
  const { edge, softness } = SDF_THRESHOLDS[kind];
  return smoothAlpha(value, edge, softness);
}

export function smoothAlpha(value: number, edge: number, softness: number) {
  const min = edge - softness;
  const max = edge + softness;
  const t = clampNumber((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function measureTmpLine(
  font: TmpFontMetrics,
  line: string,
  fontSize: number,
  characterSpacing: number,
) {
  const fontScale = fontSize / font.fontInfo.PointSize;
  return Array.from(line).reduce((sum, char, index, chars) => {
    const glyph = tmpGlyph(font, char);
    const advance = glyph?.xAdvance ?? font.fontInfo.PointSize * 0.5;
    return sum + (advance + (index < chars.length - 1 ? characterSpacing : 0)) * fontScale;
  }, 0);
}

export function tmpGlyph(font: TmpFontMetrics, char: string) {
  const code = char.codePointAt(0) ?? 0;
  return font.glyphs[String(code)] ?? font.glyphs[MISSING_GLYPH_CODEPOINT] ?? font.glyphs[QUESTION_MARK_CODEPOINT];
}

export function reactText(children: React.ReactNode) {
  return React.Children.toArray(children)
    .map((child) => (typeof child === "string" || typeof child === "number" ? String(child) : ""))
    .join("");
}

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
  const output: Array<{
    key: string;
    style: React.CSSProperties;
    sourceX: number;
    sourceY: number;
    sourceW: number;
    sourceH: number;
    color: string;
  }> = [];

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
            style: {
              left: `${(glyphLeft / rectWidth) * 100}%`,
              top: `${(glyphTop / rectHeight) * 100}%`,
              width: `${(displayW / rectWidth) * 100}%`,
              height: `${(displayH / rectHeight) * 100}%`,
            },
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

export function unityGlyph(font: UnityFontMetrics, char: string) {
  const code = char.codePointAt(0) ?? 0;
  return font.chars[String(code)] ?? font.chars[MISSING_GLYPH_CODEPOINT] ?? font.chars[QUESTION_MARK_CODEPOINT];
}

