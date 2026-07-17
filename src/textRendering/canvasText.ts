import { canvasFontLoadDescriptors } from "../fontLoading";
import {
  alignOffset,
  decodeUnityAnchor,
  getPixelRatio,
} from "./shared";

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
  const pixelRatio = getPixelRatio();
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
  const { horizontal, vertical } = decodeUnityAnchor(options.alignment);
  const top = alignOffset(vertical, options.h, totalHeight);

  lines.forEach((line, lineIndex) => {
    const lineWidth = Math.max(1, measureCanvasLine(context, line, options.characterSpacing));
    const fitScale = options.fitHorizontal ? Math.min(1, options.w / lineWidth) : 1;
    const drawWidth = lineWidth * fitScale;
    const left = alignOffset(horizontal, options.w, drawWidth);
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

export function waitForCanvasFont(fontFamily: string, fontSize: number, fontWeight: number) {
  if (typeof document === "undefined" || !("fonts" in document)) {
    return Promise.resolve();
  }

  return Promise.allSettled([
    ...canvasFontLoadDescriptors(fontFamily, fontSize, fontWeight).map((description) =>
      document.fonts.load(description),
    ),
    document.fonts.ready,
  ]).then(() => undefined);
}
