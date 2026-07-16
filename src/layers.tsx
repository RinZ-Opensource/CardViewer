import React from "react";
import QRCode from "qrcode";
import { OFFICIAL_ASSET_ROOT, OfficialFontContext, TmpFontContext, officialAsset } from "./constants";
import { unityRect } from "./geometry";
import { TMP_TEXT_PADDING, TmpHorizontalAlign, TmpTextVariant, TmpVerticalAlign, clearCanvas, layoutUnityText, loadTmpAtlas, reactText, renderCanvasText, renderTmpText, waitForCanvasFont } from "./textRendering";
import { OfficialFontKey } from "./types";
import type { QrSource } from "./types";

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
  const [loadState, setLoadState] = React.useState<"pending" | "ready" | "error">("pending");
  React.useEffect(() => {
    setCurrentSrc(src);
    setLoadState("pending");
  }, [src]);
  const onError = React.useCallback(() => {
    if (fallbackSrc && currentSrc !== fallbackSrc) {
      setCurrentSrc(fallbackSrc);
      setLoadState("pending");
    } else {
      setLoadState("error");
    }
  }, [currentSrc, fallbackSrc]);

  return (
    <img
      className={["official-layer-img", className].filter(Boolean).join(" ")}
      src={currentSrc}
      alt=""
      decoding="async"
      data-export-state={loadState}
      data-export-error={loadState === "error" ? "A card image failed to load." : undefined}
      onLoad={() => setLoadState("ready")}
      onError={onError}
      style={unityRect(x, y, w, h, { rotation, scale })}
    />
  );
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
  const renderKey = JSON.stringify([
    text,
    fontFamily,
    fontSize,
    fontWeight,
    alignment,
    color,
    lineSpacing,
    fitHorizontal,
    characterSpacing,
    w,
    h,
  ]);
  const [readyKey, setReadyKey] = React.useState("");
  const [failedKey, setFailedKey] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    setReadyKey("");
    setFailedKey("");
    const draw = async () => {
      try {
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
        setReadyKey(renderKey);
      } catch {
        if (!cancelled) setFailedKey(renderKey);
      }
    };
    draw();
    return () => {
      cancelled = true;
    };
  }, [alignment, characterSpacing, color, fitHorizontal, fontFamily, fontSize, fontWeight, h, lineSpacing, renderKey, text, w]);

  return (
    <div
      className={`official-canvas-text ${className}`}
      data-export-state={readyKey === renderKey ? "ready" : failedKey === renderKey ? "error" : "pending"}
      data-export-error={failedKey === renderKey ? "A canvas text layer failed to render." : undefined}
      style={unityRect(x, y, w, h, { rotation, scale })}
    >
      <canvas className="official-text-canvas" ref={canvasRef} aria-hidden="true" />
    </div>
  );
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
    <div
      className={`official-tmp-text ${className}`}
      data-export-state={!text || canvasReady || fallbackReady ? "ready" : "pending"}
      style={unityRect(x, y, w, h, { rotation, scale })}
    >
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
  return figure === 10 || figure === 11 || figure === 12 ? signWidth : digitWidth;
}

export function counterFigureHeight(figure: number, digitHeight: number, signHeight: number) {
  return figure === 10 || figure === 11 || figure === 12 ? signHeight : digitHeight;
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
    default:
      col = figure & 3;
      row = figure >> 2;
      break;
  }
  return `${(col / 3) * 100}% ${(row / 3) * 100}%`;
}

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
  const [generationError, setGenerationError] = React.useState(false);
  const sourceKey =
    typeof source === "string" ? source : Array.from(source[0]?.data ?? []).join(",");

  React.useEffect(() => {
    let cancelled = false;
    setDataUrl("");
    setGenerationError(false);
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
        if (!cancelled) {
          setDataUrl("");
          setGenerationError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sourceKey]);

  return (
    <div
      className="official-qr"
      data-export-state={dataUrl ? "ready" : generationError ? "error" : "pending"}
      data-export-error={generationError ? "The QR code failed to render." : undefined}
      style={unityRect(x, y, w, h)}
    >
      {dataUrl ? <img src={dataUrl} alt="" /> : null}
    </div>
  );
}
