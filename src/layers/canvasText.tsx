import React from "react";
import { unityRect } from "../geometry";
import {
  clearCanvas,
  reactText,
  renderCanvasText,
  waitForCanvasFont,
} from "../textRendering";

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
    if (canvasRef.current) clearCanvas(canvasRef.current);
    const draw = async () => {
      try {
        await waitForCanvasFont(fontFamily, fontSize, fontWeight);
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
      } catch {
        if (!cancelled && canvasRef.current) clearCanvas(canvasRef.current);
      }
    };
    draw();
    return () => {
      cancelled = true;
    };
  }, [alignment, characterSpacing, color, fitHorizontal, fontFamily, fontSize, fontWeight, h, lineSpacing, text, w]);

  return (
    <div
      className={`official-canvas-text ${className}`}
      style={unityRect(x, y, w, h, { rotation, scale })}
    >
      <canvas className="official-text-canvas" ref={canvasRef} aria-hidden="true" />
    </div>
  );
}
