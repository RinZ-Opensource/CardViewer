import React from "react";
import { OFFICIAL_ASSET_ROOT } from "../constants";
import { loadTmpAtlas, measureTmpLine } from "../textRendering";
import type { TmpFontMetrics, TmpGlyph } from "../types";
import { FitText } from "./FitText";

export type MaiTmpFontKey = "rodin" | "maru";
export type MaiTmpHorizontalAlign = "left" | "center" | "right";

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
  const promise = fetch(`${OFFICIAL_ASSET_ROOT}${FONT_CATALOGS[key]}`, {
    credentials: "same-origin",
  }).then(async (response) => {
    if (!response.ok) throw new Error(`R2 maimai TMP catalog unavailable: ${response.status}`);
    return (await response.json()) as TmpFontMetrics;
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
    fitHorizontal: boolean;
  },
) {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  canvas.width = Math.ceil((options.width + PADDING * 2) * dpr);
  canvas.height = Math.ceil((options.height + PADDING * 2) * dpr);
  const context = canvas.getContext("2d");
  if (!context) return false;
  context.clearRect(0, 0, canvas.width, canvas.height);

  // The exported game atlases omit a small number of song-database symbols.
  // Keep the complete DOM fallback for those strings instead of substituting
  // TMP's tofu glyph and silently losing the original character.
  if (Array.from(text).some((character) => !font.glyphs[String(character.codePointAt(0) ?? 0)])) {
    return false;
  }

  const fontScale = options.fontSize / font.fontInfo.PointSize;
  const naturalWidth = measureTmpLine(font, text, options.fontSize, 0);
  const scaleX = options.fitHorizontal && naturalWidth > options.width
    ? options.width / naturalWidth
    : 1;
  const fittedWidth = naturalWidth * scaleX;
  const offsetX = options.align === "center"
    ? (options.width - fittedWidth) / 2
    : options.align === "right"
      ? options.width - fittedWidth
      : 0;
  const lineHeight = font.fontInfo.LineHeight * fontScale;
  const baseline = PADDING + (options.height - lineHeight) / 2 + font.fontInfo.Ascender * fontScale;

  context.save();
  context.translate((PADDING + offsetX) * dpr, 0);
  context.scale(scaleX, 1);
  let cursor = 0;
  let drawn = 0;
  for (const character of Array.from(text)) {
    const glyph = glyphFor(font, character);
    const advance = (glyph?.xAdvance ?? font.fontInfo.PointSize * 0.5) * fontScale;
    if (glyph && glyph.width > 0 && glyph.height > 0) {
      const width = Math.max(1, Math.ceil(glyph.width * fontScale * dpr));
      const height = Math.max(1, Math.ceil(glyph.height * fontScale * dpr));
      const glyphCanvas = rasterizeGlyph(atlas, glyph, width, height, options.color);
      const x = (cursor + glyph.xOffset * fontScale) * dpr;
      const y = (baseline - glyph.yOffset * fontScale) * dpr;
      context.drawImage(glyphCanvas, Math.round(x), Math.round(y));
      drawn += 1;
    }
    cursor += advance;
  }
  context.restore();
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
  fitHorizontal?: boolean;
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
  fitHorizontal = false,
}: MaiTmpTextProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = React.useState(false);

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
          fitHorizontal,
        }));
      })
      .catch(() => {
        if (!cancelled) setRendered(false);
      });
    return () => {
      cancelled = true;
    };
  }, [align, color, fitHorizontal, font, fontSize, height, text, width]);

  return (
    <div className={`${className} mai-tmp-text`}>
      <span className="visually-hidden">{text}</span>
      <span
        aria-hidden="true"
        className={`mai-tmp-fallback align-${align}`}
        style={{ opacity: rendered ? 0 : 1 }}
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
