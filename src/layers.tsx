import React from "react";
import QRCode from "qrcode";
import { OFFICIAL_ASSET_ROOT, OfficialFontContext, SpriteCrop, TmpFontContext, officialAsset } from "./constants";
import { unityRect } from "./holo";
import { Bounds, OfficialFontKey, TmpFontMetrics, TmpGlyph, UnityFontMetrics } from "./types";

export function LayerImage({
  src,
  fallbackSrc,
  className,
  x,
  y,
  w,
  h,
  rotation,
  scale,
}: {
  src: string;
  fallbackSrc?: string;
  className?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  scale?: number;
}) {
  const [currentSrc, setCurrentSrc] = React.useState(src);
  React.useEffect(() => {
    setCurrentSrc(src);
  }, [src]);
  const onError = React.useCallback(() => {
    if (fallbackSrc && currentSrc !== fallbackSrc) {
      setCurrentSrc(fallbackSrc);
    }
  }, [currentSrc, fallbackSrc]);

  return (
    <img
      className={["official-layer-img", className].filter(Boolean).join(" ")}
      src={currentSrc}
      alt=""
      onError={onError}
      style={unityRect(x, y, w, h, { rotation, scale })}
    />
  );
}

export function LayerSpriteCrop({
  src,
  className,
  crop,
  x,
  y,
  w,
  h,
  rotation,
  scale,
}: {
  src: string;
  className?: string;
  crop: SpriteCrop;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  scale?: number;
}) {
  const imageStyle: React.CSSProperties = {
    left: `${(-crop.x / crop.w) * 100}%`,
    top: `${(-crop.y / crop.h) * 100}%`,
    width: `${(crop.sourceW / crop.w) * 100}%`,
    height: `${(crop.sourceH / crop.h) * 100}%`,
    objectFit: "fill",
  };
  return (
    <div className="official-layer-crop" style={unityRect(x, y, w, h, { rotation, scale })}>
      <img
        className={["official-layer-img", className].filter(Boolean).join(" ")}
        src={src}
        alt=""
        style={imageStyle}
      />
    </div>
  );
}

export function spriteCropDisplayRect(
  rect: { x: number; y: number; w: number; h: number },
  crop: SpriteCrop,
) {
  return {
    x: rect.x - rect.w / 2 + crop.x + crop.w / 2,
    y: rect.y + rect.h / 2 - crop.y - crop.h / 2,
    w: crop.w,
    h: crop.h,
  };
}

export function LayerText({
  children,
  className,
  x,
  y,
  w,
  h,
  rotation,
  scale,
}: {
  children: React.ReactNode;
  className: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  scale?: number;
}) {
  return (
    <div className={`official-layer-text ${className}`} style={unityRect(x, y, w, h, { rotation, scale })}>
      {children}
    </div>
  );
}

export function LayerCanvasText({
  children,
  className,
  fontFamily,
  fontSize,
  fontWeight = 700,
  alignment,
  color,
  lineSpacing = 1,
  fitHorizontal = false,
  characterSpacing = 0,
  x,
  y,
  w,
  h,
  rotation,
  scale,
}: {
  children: React.ReactNode;
  className: string;
  fontFamily: string;
  fontSize: number;
  fontWeight?: number;
  alignment: number;
  color: string;
  lineSpacing?: number;
  fitHorizontal?: boolean;
  characterSpacing?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  scale?: number;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const text = reactText(children);

  React.useEffect(() => {
    let cancelled = false;
    const draw = async () => {
      await waitForCanvasFont(fontFamily, fontSize);
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      renderCanvasText(canvas, text, {
        w,
        h,
        fontFamily,
        fontSize,
        fontWeight,
        alignment,
        color,
        lineSpacing,
        fitHorizontal,
        characterSpacing,
      });
    };
    draw();
    return () => {
      cancelled = true;
    };
  }, [alignment, characterSpacing, color, fitHorizontal, fontFamily, fontSize, fontWeight, h, lineSpacing, text, w]);

  return (
    <div className={`official-canvas-text ${className}`} style={unityRect(x, y, w, h, { rotation, scale })}>
      <canvas className="official-text-canvas" ref={canvasRef} aria-hidden="true" />
    </div>
  );
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
  const pixelRatio =
    typeof window === "undefined" ? 2 : Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
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
  const vertical = Math.floor(options.alignment / 3);
  const horizontal = options.alignment % 3;
  const top = vertical === 0 ? 0 : vertical === 1 ? (options.h - totalHeight) / 2 : options.h - totalHeight;

  lines.forEach((line, lineIndex) => {
    const lineWidth = Math.max(1, measureCanvasLine(context, line, options.characterSpacing));
    const fitScale = options.fitHorizontal ? Math.min(1, options.w / lineWidth) : 1;
    const drawWidth = lineWidth * fitScale;
    const left =
      horizontal === 0 ? 0 : horizontal === 1 ? (options.w - drawWidth) / 2 : options.w - drawWidth;
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

export function LayerUnityText({
  children,
  className,
  fontKey,
  fontSize,
  alignment,
  color = "#ffffff",
  lineSpacing = 1,
  fitHorizontal = false,
  characterSpacing = 0,
  horizontalScale = 1,
  glyphOffsetY = 0,
  fixedGlyphTop = false,
  x,
  y,
  w,
  h,
  rotation,
  scale,
}: {
  children: React.ReactNode;
  className: string;
  fontKey: OfficialFontKey;
  fontSize: number;
  alignment: number;
  color?: string;
  lineSpacing?: number;
  fitHorizontal?: boolean;
  characterSpacing?: number;
  horizontalScale?: number;
  glyphOffsetY?: number;
  fixedGlyphTop?: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  scale?: number;
}) {
  const fonts = React.useContext(OfficialFontContext);
  const font = fonts[fontKey];
  const text = reactText(children);
  const maskIdPrefix = React.useId().replace(/:/g, "");

  if (!font) {
    return (
      <LayerText className={className} x={x} y={y} w={w} h={h} rotation={rotation} scale={scale}>
        {children}
      </LayerText>
    );
  }

  const glyphs = layoutUnityText(font, text, fontSize, w, h, alignment, lineSpacing, color, fitHorizontal, characterSpacing, horizontalScale, glyphOffsetY, fixedGlyphTop);
  return (
    <div className={`official-bitmap-text ${className}`} style={unityRect(x, y, w, h, { rotation, scale })}>
      {glyphs.map((glyph) => {
        const maskId = `${maskIdPrefix}-${glyph.key}`;
        return (
          <span className="official-bitmap-glyph" style={glyph.style} key={glyph.key}>
            <svg className="official-bitmap-svg" viewBox={`0 0 ${glyph.sourceW} ${glyph.sourceH}`} preserveAspectRatio="none">
              <defs>
                <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={glyph.sourceW} height={glyph.sourceH}>
                  <image href={`${OFFICIAL_ASSET_ROOT}${font.texture}`} x={-glyph.sourceX} y={-glyph.sourceY} width={font.width} height={font.height} />
                </mask>
              </defs>
              <rect width={glyph.sourceW} height={glyph.sourceH} fill={glyph.color} mask={`url(#${maskId})`} />
            </svg>
          </span>
        );
      })}
    </div>
  );
}

export type TmpTextVariant = "main" | "shadow";
export type TmpHorizontalAlign = "left" | "center" | "right";
export type TmpVerticalAlign = "top" | "middle" | "bottom";
export const TMP_TEXT_PADDING = 36;

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

export function LayerTmpText({
  children,
  className,
  fontSize,
  variant,
  characterSpacing = 0,
  autoSize = false,
  minFontSize,
  horizontalAlign = "right",
  verticalAlign = "top",
  x,
  y,
  w,
  h,
  rotation,
  scale,
}: {
  children: React.ReactNode;
  className: string;
  fontSize: number;
  variant: TmpTextVariant;
  characterSpacing?: number;
  autoSize?: boolean;
  minFontSize?: number;
  horizontalAlign?: TmpHorizontalAlign;
  verticalAlign?: TmpVerticalAlign;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  scale?: number;
}) {
  const font = React.useContext(TmpFontContext);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [readyKey, setReadyKey] = React.useState("");
  const [failedKey, setFailedKey] = React.useState("");
  const text = reactText(children);
  const resolvedMinFontSize = minFontSize ?? fontSize;
  const renderKey = React.useMemo(
    () =>
      JSON.stringify([
        font?.texture ?? "",
        font?.fontInfo.PointSize ?? 0,
        font?.fontInfo.LineHeight ?? 0,
        text,
        fontSize,
        variant,
        characterSpacing,
        autoSize,
        resolvedMinFontSize,
        horizontalAlign,
        verticalAlign,
        w,
        h,
      ]),
    [
      autoSize,
      characterSpacing,
      font?.fontInfo.LineHeight,
      font?.fontInfo.PointSize,
      font?.texture,
      fontSize,
      h,
      horizontalAlign,
      resolvedMinFontSize,
      text,
      variant,
      verticalAlign,
      w,
    ],
  );
  const canvasReady = readyKey === renderKey;
  const fallbackReady = failedKey === renderKey;

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    clearCanvas(canvas);
    setReadyKey("");
    setFailedKey("");

    if (!font || !text) {
      return;
    }

    let cancelled = false;
    loadTmpAtlas(font)
      .then((atlas) => {
        if (cancelled) return;
        const didRender = renderTmpText(canvas, atlas, font, text, {
          w,
          h,
          padding: TMP_TEXT_PADDING,
          fontSize,
          variant,
          characterSpacing,
          autoSize,
          minFontSize: resolvedMinFontSize,
          horizontalAlign,
          verticalAlign,
        });
        if (didRender) {
          setReadyKey(renderKey);
        } else {
          setFailedKey(renderKey);
        }
      })
      .catch(() => {
        if (cancelled) return;
        clearCanvas(canvas);
        setReadyKey("");
        setFailedKey(renderKey);
      });

    return () => {
      cancelled = true;
    };
  }, [autoSize, characterSpacing, font, fontSize, h, horizontalAlign, renderKey, resolvedMinFontSize, text, variant, verticalAlign, w]);

  if (!font) {
    return (
      <LayerText className={className} x={x} y={y} w={w} h={h} rotation={rotation} scale={scale}>
        {children}
      </LayerText>
    );
  }

  return (
    <div className={`official-tmp-text ${className}`} style={unityRect(x, y, w, h, { rotation, scale })}>
      <span
        className="official-tmp-fallback"
        style={{
          opacity: fallbackReady ? 1 : 0,
          fontSize,
          justifyContent:
            horizontalAlign === "left" ? "flex-start" : horizontalAlign === "center" ? "center" : "flex-end",
          alignItems:
            verticalAlign === "top" ? "flex-start" : verticalAlign === "middle" ? "center" : "flex-end",
          letterSpacing: characterSpacing,
          textAlign: horizontalAlign,
        }}
      >
        {text}
      </span>
      <canvas
        key={renderKey}
        className="official-tmp-canvas"
        ref={canvasRef}
        aria-hidden="true"
        style={{
          left: `${(-TMP_TEXT_PADDING / w) * 100}%`,
          top: `${(-TMP_TEXT_PADDING / h) * 100}%`,
          width: `${((w + TMP_TEXT_PADDING * 2) / w) * 100}%`,
          height: `${((h + TMP_TEXT_PADDING * 2) / h) * 100}%`,
          opacity: canvasReady ? 1 : 0,
        }}
      />
    </div>
  );
}

export function clearCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  context?.clearRect(0, 0, canvas.width, canvas.height);
}

export const tmpAtlasCache = new Map<string, Promise<HTMLImageElement>>();
export const tmpGlyphCanvasCache = new Map<string, HTMLCanvasElement>();

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
  const pixelRatio =
    typeof window === "undefined" ? 2 : Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
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
  const top =
    options.verticalAlign === "top"
      ? options.padding
      : options.verticalAlign === "middle"
        ? options.padding + (options.h - totalHeight) / 2
        : options.padding + options.h - totalHeight;
  const mainColor = options.variant === "main" ? [255, 255, 255] : [38, 146, 192];
  const outlineColor = options.variant === "main" ? [37, 146, 193] : [30, 128, 178];
  lines.forEach((line, lineIndex) => {
    const lineWidth = measureTmpLine(font, line, effectiveSize, options.characterSpacing);
    const originX =
      options.horizontalAlign === "left"
        ? options.padding
        : options.horizontalAlign === "center"
          ? options.padding + (options.w - lineWidth) / 2
          : options.padding + options.w - lineWidth;
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

export function tmpSdfAlpha(value: number, kind: "face" | "outline" | "underlay") {
  if (kind === "face") return smoothAlpha(value, 152, 22);
  if (kind === "outline") return smoothAlpha(value, 88, 34);
  return smoothAlpha(value, 74, 42);
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
  return font.glyphs[String(code)] ?? font.glyphs["9633"] ?? font.glyphs["63"];
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
  const vertical = Math.floor(alignment / 3);
  const horizontal = alignment % 3;
  const topBase =
    vertical === 0 ? 0 : vertical === 1 ? (rectHeight - totalHeight) / 2 : rectHeight - totalHeight;
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
    const lineLeft =
      horizontal === 0 ? 0 : horizontal === 1 ? (rectWidth - lineWidth) / 2 : rectWidth - lineWidth;
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
  return font.chars[String(code)] ?? font.chars["9633"] ?? font.chars["63"];
}

export type CounterAlign = "center" | "left" | "right";

export function LayerChuCounter({
  value,
  x,
  y,
  rotation,
}: {
  value: string;
  x: number;
  y: number;
  rotation?: number;
}) {
  return (
    <LayerDigitCounter
      className="official-counter chu-counter"
      value={value || "0"}
      sprite={officialAsset("NUM_CHU_Parameter_sheet")}
      x={x}
      y={y}
      w={150}
      h={54}
      rotation={rotation}
      align="center"
      digitWidth={41}
      digitHeight={41}
      signWidth={50}
      signHeight={50}
      charSpacing={-12}
      flags={128}
    />
  );
}

export function LayerDigitCounter({
  value,
  sprite,
  className,
  x,
  y,
  w,
  h,
  rotation,
  scale,
  align,
  digitWidth,
  digitHeight,
  signWidth = digitWidth,
  signHeight = digitHeight,
  charSpacing,
  flags,
}: {
  value: string;
  sprite: string;
  className: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  scale?: number;
  align: CounterAlign;
  digitWidth: number;
  digitHeight: number;
  signWidth?: number;
  signHeight?: number;
  charSpacing: number;
  flags: number;
}) {
  const figures = calcCounterFigures(value, flags);
  const widths = figures.map((figure) => counterFigureWidth(figure, digitWidth, signWidth));
  const totalWidth =
    widths.reduce((sum, width) => sum + width, 0) +
    Math.max(0, widths.length - 1) * charSpacing;
  const anchorPivot = align === "left" ? 0 : align === "right" ? 1 : 0.5;
  const startX = w / 2 - anchorPivot * totalWidth;
  const groupHeight = Math.max(digitHeight, signHeight);
  const groupTop = (h - groupHeight) / 2;
  let cursor = startX;

  return (
    <div className={`official-digit-counter ${className}`} style={unityRect(x, y, w, h, { rotation, scale })}>
      {figures.map((figure, index) => {
        const figureWidth = widths[index];
        const figureHeight = counterFigureHeight(figure, digitHeight, signHeight);
        const localTop = groupTop + (groupHeight - figureHeight) / 2;
        const style: React.CSSProperties = {
          left: `${(cursor / w) * 100}%`,
          top: `${(localTop / h) * 100}%`,
          width: `${(figureWidth / w) * 100}%`,
          height: `${(figureHeight / h) * 100}%`,
          backgroundImage: `url("${sprite}")`,
          backgroundPosition: counterFigureBackgroundPosition(figure),
        };
        cursor += figureWidth + charSpacing;
        return <span className="official-digit" style={style} key={`${figure}-${index}`} />;
      })}
    </div>
  );
}

export function calcCounterFigures(rawValue: string, flags: number) {
  const parsed = Number(rawValue);
  const value = Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  const figures: number[] = [];
  let digitCount = 0;
  const comma = (flags & 2) !== 0;

  if (value === 0) {
    figures.push(0);
    digitCount = 1;
  } else {
    let remaining = Math.abs(value);
    while (remaining > 0) {
      const next = Math.trunc(remaining / 10);
      figures.push(remaining - next * 10);
      remaining = next;
      digitCount += 1;
      if (comma && digitCount % 3 === 0 && remaining > 0) {
        figures.push(11);
      }
    }
  }

  if (value < 0) {
    figures.push(12);
  } else if ((flags & 1) !== 0 && (value !== 0 || (flags & 128) === 0)) {
    figures.push(10);
  }

  return figures.reverse();
}

export function counterFigureWidth(figure: number, digitWidth: number, signWidth: number) {
  return figure === 10 || figure === 11 || figure === 12 || figure === 13 ? signWidth : digitWidth;
}

export function counterFigureHeight(figure: number, digitHeight: number, signHeight: number) {
  return figure === 10 || figure === 11 || figure === 12 || figure === 13 ? signHeight : digitHeight;
}

export function counterFigureBackgroundPosition(figure: number) {
  let col = 0;
  let row = 0;
  switch (figure) {
    case 10:
      col = 2;
      row = 2;
      break;
    case 11:
      col = 1;
      row = 3;
      break;
    case 12:
      col = 3;
      row = 2;
      break;
    case 13:
      col = 0;
      row = 3;
      break;
    default:
      col = figure & 3;
      row = figure >> 2;
      break;
  }
  return `${(col / 3) * 100}% ${(row / 3) * 100}%`;
}

export type QrSource = string | { data: Uint8ClampedArray; mode: "byte" }[];

export function LayerQr({
  source,
  x,
  y,
  w,
  h,
}: {
  source: QrSource;
  x: number;
  y: number;
  w: number;
  h: number;
}) {
  const [dataUrl, setDataUrl] = React.useState("");
  const sourceKey =
    typeof source === "string" ? source : Array.from(source[0]?.data ?? []).join(",");

  React.useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(source || "CARDVIEWER", {
      errorCorrectionLevel: "M",
      version: typeof source === "string" ? undefined : 1,
      margin: 0,
      scale: 5,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [sourceKey]);

  return (
    <div className="official-qr" style={unityRect(x, y, w, h)}>
      {dataUrl ? <img src={dataUrl} alt="" /> : null}
    </div>
  );
}

