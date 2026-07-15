import React from "react";

const FIT_GUTTER_PX = 2;

interface FitTextProps {
  maxWidth: number;
  /** Where the game anchors this text: center (title/artist) or left (designer). */
  origin?: "center" | "left";
  className?: string;
  children: React.ReactNode;
}

/** Squeezes overflowing text horizontally (the game marquees; we compress). */
export function FitText({ maxWidth, origin = "center", className, children }: FitTextProps) {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const [scale, setScale] = React.useState(1);

  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    let disposed = false;
    let animationFrame = 0;

    const measure = () => {
      if (disposed) return;

      // CSS transforms do not affect scrollWidth, so the intrinsic width can be
      // measured without temporarily removing the transform. Mutating it here
      // used to leave the DOM at transform:none whenever React bailed out of an
      // unchanged state update.
      if (element.getClientRects().length === 0) return;

      const computedWidth = Number.parseFloat(getComputedStyle(element).width);
      const width = Math.max(
        element.scrollWidth,
        Number.isFinite(computedWidth) ? computedWidth : 0,
      );
      if (width <= 0) return;

      // Leave a small design-pixel gutter for fractional glyph metrics and the
      // card's fractional CSS zoom.
      const fittedWidth = Math.max(0, maxWidth - FIT_GUTTER_PX);
      const nextScale = Math.min(1, fittedWidth / width);
      setScale((currentScale) =>
        Math.abs(currentScale - nextScale) < 0.0001 ? currentScale : nextScale,
      );
    };

    const scheduleMeasure = () => {
      if (disposed) return;
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(measure);
    };

    measure();

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(element);
    if (element.parentElement) resizeObserver?.observe(element.parentElement);

    const fontSet = document.fonts;
    fontSet?.addEventListener("loadingdone", scheduleMeasure);
    void fontSet?.ready?.then(scheduleMeasure);
    window.addEventListener("resize", scheduleMeasure);

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      fontSet?.removeEventListener("loadingdone", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [children, maxWidth]);

  return (
    <span
      ref={ref}
      className={className}
      style={{
        display: "inline-block",
        flex: "0 0 auto",
        transform: `scaleX(${scale})`,
        transformOrigin: origin,
      }}
    >
      {children}
    </span>
  );
}
