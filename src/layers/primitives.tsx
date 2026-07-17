import React from "react";
import { unityRect } from "../geometry";

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
      decoding="async"
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
