import React from "react";
import { OFFICIAL_ASSET_ROOT } from "../constants";
import { parseTmpFontMetrics } from "../runtimeJson";
import { loadTmpAtlas, measureTmpLine } from "../textRendering";
import type { TmpFontMetrics, TmpGlyph } from "../types";
import { FitText } from "./FitText";
import { useScorecardRenderScale } from "./ScorecardRenderContext";
import { scorecardTextBackingScale } from "./scorecardRenderScale";

export type MaiTmpFontKey = "rodin" | "maru";
export type MaiTmpHorizontalAlign = "left" | "center" | "right";
export type MaiTmpVerticalAlign = "top" | "middle" | "bottom";

const FONT_CATALOGS: Record<MaiTmpFontKey, string> = {
  rodin: "FONT_TMP_MAI_NEW_RODIN_EB_SDF_SUBSET_V1.json",
  maru: "FONT_TMP_MAI_MARU_GOTHIC_DB_SDF_SUBSET_V1.json",
};

const fontPromises = new Map<MaiTmpFontKey, Promise<TmpFontMetrics>>();
const glyphCanvasCache = new Map<string, HTMLCanvasElement>();
const GLYPH_CACHE_LIMIT = 2048;
const PADDING = 8;

export function loadMaiTmpFont(key: MaiTmpFontKey) {
  const cached = fontPromises.get(key);
  if (cached) return cached;
  const file = FONT_CATALOGS[key];
  const promise = fetch(`${OFFICIAL_ASSET_ROOT}${file}`, {
    credentials: "same-origin",
  }).then(async (response) => {
    if (!response.ok) throw new Error(`R2 maimai TMP catalog unavailable: ${response.status}`);
    return parseTmpFontMetrics(await response.json(), file);
  });
  fontPromises.set(key, promise);
  void promise.catch(() => {
    if (fontPromises.get(key) === promise) fontPromises.delete(key);
  });
  return promise;
}

function glyphFor(font: TmpFontMetrics, character: string) {
  const codepoint = character.codePointAt(0) ?? 0;
  return font.glyphs[String(codepoint)] ?? font.glyphs["9633"] ?? font.glyphs["63"];
}

function smoothAlpha(value: number) {
  const t = Math.max(0, Math.min(1, (value - 110) / 36));
  return t * t * (3 - 2 * t);
}

function rasterizeGlyph(
  atlas: HTMLImageElement,
  glyph: TmpGlyph,
  width: number,
  height: number,
  color: readonly [number, number, number],
) {
  const cacheKey = [atlas.currentSrc || atlas.src, glyph.id, width, height, ...color].join("|");
  const cached = glyphCanvasCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return canvas;
  context.drawImage(atlas, glyph.x, glyph.y, glyph.width, glyph.height, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    pixels.data[index] = color[0];
    pixels.data[index + 1] = color[1];
    pixels.data[index + 2] = color[2];
    pixels.data[index + 3] = Math.round(smoothAlpha(pixels.data[index + 3]) * 255);
  }
  context.putImageData(pixels, 0, 0);
  if (glyphCanvasCache.size >= GLYPH_CACHE_LIMIT) glyphCanvasCache.clear();
  glyphCanvasCache.set(cacheKey, canvas);
  return canvas;
}

function renderMaiTmpText(
  canvas: HTMLCanvasElement,
  atlas: HTMLImageElement,
  font: TmpFontMetrics,
  text: string,
  options: {
    width: number;
    height: number;
    fontSize: number;
    color: readonly [number, number, number];
    align: MaiTmpHorizontalAlign;
    verticalAlign: MaiTmpVerticalAlign;
    fitHorizontal: boolean;
    marginTop: number;
    marginBottom: number;
    renderScale: number;
  },
) {
  // CSS `zoom` does not re-rasterize a canvas. Allocate for its final display
  // size and retain an extra 2x sample so small SDF strokes survive the final
  // browser resample. The cap prevents a large HiDPI window from producing
  // disproportionately expensive per-field backing stores.
  const backingRatio = scorecardTextBackingScale(
    options.renderScale,
    window.devicePixelRatio || 1,
  );
  canvas.width = Math.ceil((options.width + PADDING * 2) * backingRatio);
  canvas.height = Math.ceil((options.height + PADDING * 2) * backingRatio);
  const context = canvas.getContext("2d");
  if (!context) return false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  // The exported game atlases omit a small number of song-database symbols.
  // Keep the complete DOM fallback for those strings instead of substituting
  // TMP's tofu glyph and silently losing the original character.
  if (Array.from(text).some((character) => !font.glyphs[String(character.codePointAt(0) ?? 0)])) {
    return false;
  }

  const maximumWidth = Math.max(0, options.width);
  const maximumSizeWidth = measureTmpLine(font, text, options.fontSize, 0);
  // TMP auto-size preserves glyph proportions. Scaling only X made fitted
  // titles visibly narrower and changed their stroke weight.
  const effectiveFontSize = options.fitHorizontal && maximumSizeWidth > maximumWidth
    ? options.fontSize * (maximumWidth / maximumSizeWidth)
    : options.fontSize;
  const fontScale = effectiveFontSize / font.fontInfo.PointSize;
  const fittedWidth = measureTmpLine(font, text, effectiveFontSize, 0);
  const offsetX = options.align === "center"
    ? (options.width - fittedWidth) / 2
    : options.align === "right"
      ? options.width - fittedWidth
      : 0;
  const lineHeight = font.fontInfo.LineHeight * fontScale;
  const marginTop = Math.max(0, options.marginTop);
  const marginBottom = Math.max(0, options.marginBottom);
  const contentHeight = Math.max(0, options.height - marginTop - marginBottom);
  const lineTop = options.verticalAlign === "top"
    ? marginTop
    : options.verticalAlign === "bottom"
      ? options.height - marginBottom - lineHeight
      : marginTop + (contentHeight - lineHeight) / 2;
  const baseline = PADDING + lineTop + font.fontInfo.Ascender * fontScale;

  let cursor = 0;
  let drawn = 0;
  for (const character of Array.from(text)) {
    const glyph = glyphFor(font, character);
    const advance = (glyph?.xAdvance ?? font.fontInfo.PointSize * 0.5) * fontScale;
    if (glyph && glyph.width > 0 && glyph.height > 0) {
      const width = Math.max(1, Math.ceil(glyph.width * fontScale * backingRatio));
      const height = Math.max(1, Math.ceil(glyph.height * fontScale * backingRatio));
      const glyphCanvas = rasterizeGlyph(atlas, glyph, width, height, options.color);
      const x = (PADDING + offsetX + cursor + glyph.xOffset * fontScale) * backingRatio;
      const y = (baseline - glyph.yOffset * fontScale) * backingRatio;
      // Keep the shared TMP baseline at sub-pixel precision. Independent
      // integer rounding here was enough to move adjacent glyphs by a full
      // displayed pixel after the parent card zoom.
      context.drawImage(glyphCanvas, x, y);
      drawn += 1;
    }
    cursor += advance;
  }
  return drawn > 0;
}

interface MaiTmpTextProps {
  className: string;
  text: string;
  font: MaiTmpFontKey;
  fontSize: number;
  width: number;
  height: number;
  color: readonly [number, number, number];
  align?: MaiTmpHorizontalAlign;
  verticalAlign?: MaiTmpVerticalAlign;
  fitHorizontal?: boolean;
  marginTop?: number;
  marginBottom?: number;
}

/** Renders the original maimai TMP SDF atlas while retaining a DOM fallback. */
export function MaiTmpText({
  className,
  text,
  font,
  fontSize,
  width,
  height,
  color,
  align = "left",
  verticalAlign = "middle",
  fitHorizontal = false,
  marginTop = 0,
  marginBottom = 0,
}: MaiTmpTextProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = React.useState(false);
  const renderScale = useScorecardRenderScale();

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !text) {
      setRendered(false);
      return;
    }
    let cancelled = false;
    setRendered(false);
    void loadMaiTmpFont(font)
      .then(async (metrics) => ({ metrics, atlas: await loadTmpAtlas(metrics) }))
      .then(({ metrics, atlas }) => {
        if (cancelled) return;
        setRendered(renderMaiTmpText(canvas, atlas, metrics, text, {
          width,
          height,
          fontSize,
          color,
          align,
          verticalAlign,
          fitHorizontal,
          marginTop,
          marginBottom,
          renderScale,
        }));
      })
      .catch(() => {
        if (!cancelled) setRendered(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    align,
    color,
    fitHorizontal,
    font,
    fontSize,
    height,
    marginBottom,
    marginTop,
    renderScale,
    text,
    verticalAlign,
    width,
  ]);

  const fallbackAlignItems = verticalAlign === "top"
    ? "flex-start"
    : verticalAlign === "bottom"
      ? "flex-end"
      : "center";

  return (
    <div className={`${className} mai-tmp-text`}>
      <span className="visually-hidden">{text}</span>
      <span
        aria-hidden="true"
        className={`mai-tmp-fallback align-${align}`}
        style={{
          alignItems: fallbackAlignItems,
          boxSizing: "border-box",
          opacity: rendered ? 0 : 1,
          paddingBottom: marginBottom,
          paddingTop: marginTop,
        }}
      >
        {fitHorizontal ? (
          <FitText maxWidth={width} origin={align}>
            {text}
          </FitText>
        ) : (
          text
        )}
      </span>
      <canvas
        aria-hidden="true"
        className="mai-tmp-canvas"
        ref={canvasRef}
        style={{
          left: -PADDING,
          top: -PADDING,
          width: width + PADDING * 2,
          height: height + PADDING * 2,
          opacity: rendered ? 1 : 0,
        }}
      />
    </div>
  );
}
