import React from "react";

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
  const [fontsReady, setFontsReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    document.fonts?.ready?.then(() => {
      if (!cancelled) setFontsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.transform = "none";
    const width = element.scrollWidth;
    setScale(width > maxWidth ? maxWidth / width : 1);
  }, [children, maxWidth, fontsReady]);

  return (
    <span
      ref={ref}
      className={className}
      style={{ transform: `scaleX(${scale})`, transformOrigin: origin }}
    >
      {children}
    </span>
  );
}
