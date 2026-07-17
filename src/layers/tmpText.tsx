import React from "react";
import { TmpFontContext } from "../constants";
import { unityRect } from "../geometry";
import {
  TMP_TEXT_PADDING,
  type TmpHorizontalAlign,
  type TmpTextVariant,
  type TmpVerticalAlign,
  clearCanvas,
  loadTmpAtlas,
  reactText,
  renderTmpText,
} from "../textRendering";
import { LayerText } from "./primitives";

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
