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
export const MISSING_GLYPH_CODEPOINT = "9633";
export const QUESTION_MARK_CODEPOINT = "63";

// Unity TextAnchor grid: alignment 0-8 = vertical*3 + horizontal, each axis
// 0=start, 1=center, 2=end.
export function decodeUnityAnchor(alignment: number) {
  return { horizontal: alignment % 3, vertical: Math.floor(alignment / 3) };
}

// Offset of `content` within `container` for anchor pos 0=start/1=center/2=end.
export function alignOffset(pos: number, container: number, content: number) {
  if (pos === 1) return (container - content) / 2;
  if (pos === 2) return container - content;
  return 0;
}

export function clearCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  context?.clearRect(0, 0, canvas.width, canvas.height);
}
