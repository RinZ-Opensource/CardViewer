import type { HoloRootMaskMode } from "./holoMaskTypes";

// Alpha below this (0-255) is treated as fully transparent when deriving masks.
const MASK_ALPHA_EPSILON = 8;
// Grow the front-element mask outward by this many 1px passes so the foil is
// reliably cleared around printed art/text edges.
export const FRONT_MASK_DILATION = 7;

// Tuning for the luminance-keyed mask modes ("light-or-alpha"/"dark-or-alpha").
// Per-image coverage gates decide whether to key off luminance at all; the
// chosen ramp then maps luminance (0-255) to mask alpha via clamp((edge±lum)/span).
const MASK_LUMINANCE = {
  lightPivot: 128, // luminance at/above which a pixel counts as "light"
  darkPivot: 144, // luminance at/below which a pixel counts as "dark"
  coverageGate: 0.72, // min alpha coverage before luminance keying applies
  darkModeCoverageGate: 0.42, // looser gate for the explicit dark-or-alpha mode
  lightBand: { min: 0.01, max: 0.96 }, // light-coverage band selecting the light ramp
  darkBand: { min: 0.005, max: 0.98 }, // dark-coverage band selecting the dark ramp
  darkRamp: { edge: 212, span: 168 },
  lightRamp: { edge: 24, span: 200 },
  brightRamp: { edge: 232, span: 200 },
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function binarizeRenderedPixels(imageData: ImageData) {
  const mask = new Uint8ClampedArray(imageData.width * imageData.height);
  for (let src = 0, dst = 0; src < imageData.data.length; src += 4, dst += 1) {
    mask[dst] =
      imageData.data[src] > 0 ||
      imageData.data[src + 1] > 0 ||
      imageData.data[src + 2] > 0 ||
      imageData.data[src + 3] > 0
        ? 255
        : 0;
  }
  return mask;
}

export function paintBinaryMask(
  imageData: ImageData,
  mask: Uint8ClampedArray<ArrayBufferLike>,
) {
  for (let pixel = 0, index = 0; pixel < mask.length; pixel += 1, index += 4) {
    const alpha = mask[pixel] > 0 ? 255 : 0;
    imageData.data[index] = 255;
    imageData.data[index + 1] = 255;
    imageData.data[index + 2] = 255;
    imageData.data[index + 3] = alpha;
  }
}

export function dilateBinaryMask(
  src: Uint8ClampedArray<ArrayBufferLike>,
  width: number,
  height: number,
  iterations: number,
) {
  let current: Uint8ClampedArray<ArrayBufferLike> = src;
  let next: Uint8ClampedArray<ArrayBufferLike> = new Uint8ClampedArray(src.length);
  for (let pass = 0; pass < iterations; pass += 1) {
    for (let y = 0; y < height; y += 1) {
      const y0 = Math.max(y - 1, 0) * width;
      const y1 = y * width;
      const y2 = Math.min(y + 1, height - 1) * width;
      for (let x = 0; x < width; x += 1) {
        const x0 = Math.max(x - 1, 0);
        const x1 = x;
        const x2 = Math.min(x + 1, width - 1);
        next[y1 + x1] =
          current[y0 + x0] > 0 ||
          current[y0 + x1] > 0 ||
          current[y0 + x2] > 0 ||
          current[y1 + x0] > 0 ||
          current[y1 + x2] > 0 ||
          current[y2 + x0] > 0 ||
          current[y2 + x1] > 0 ||
          current[y2 + x2] > 0
            ? 255
            : 0;
      }
    }
    const tmp = current;
    current = next;
    next = tmp;
  }
  return current;
}

export function normalizeMaskData(data: Uint8ClampedArray, mode: HoloRootMaskMode) {
  if (mode === "raw") {
    return;
  }

  if (mode === "red") {
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      const red = data[index];
      const maskAlpha = alpha > MASK_ALPHA_EPSILON && red > 127 ? 255 : 0;
      data[index] = maskAlpha;
      data[index + 1] = maskAlpha;
      data[index + 2] = maskAlpha;
      data[index + 3] = maskAlpha;
    }
    return;
  }

  if (mode === "alpha") {
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      data[index] = alpha;
      data[index + 1] = alpha;
      data[index + 2] = alpha;
      data[index + 3] = alpha;
    }
    return;
  }

  // "light-or-alpha" / "dark-or-alpha": key off luminance (bright- or dark-only)
  // when coverage warrants, else fall back to plain alpha. See MASK_LUMINANCE.
  let alphaPixels = 0;
  let lightPixels = 0;
  let darkPixels = 0;
  const totalPixels = data.length / 4;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha <= MASK_ALPHA_EPSILON) continue;
    alphaPixels += 1;
    const luminance =
      0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
    if (luminance >= MASK_LUMINANCE.lightPivot) lightPixels += 1;
    if (luminance <= MASK_LUMINANCE.darkPivot) darkPixels += 1;
  }

  const alphaCoverage = alphaPixels / totalPixels;
  const lightCoverage = alphaPixels > 0 ? lightPixels / alphaPixels : 0;
  const darkCoverage = alphaPixels > 0 ? darkPixels / alphaPixels : 0;
  const useLightLuminance =
    alphaCoverage > MASK_LUMINANCE.coverageGate &&
    lightCoverage > MASK_LUMINANCE.lightBand.min &&
    lightCoverage < MASK_LUMINANCE.lightBand.max;
  const useDarkLuminance =
    alphaCoverage > MASK_LUMINANCE.coverageGate &&
    lightCoverage >= MASK_LUMINANCE.lightBand.max;
  const preferDarkLuminance =
    mode === "dark-or-alpha" &&
    alphaCoverage > MASK_LUMINANCE.darkModeCoverageGate &&
    darkCoverage > MASK_LUMINANCE.darkBand.min &&
    darkCoverage < MASK_LUMINANCE.darkBand.max;

  const { darkRamp, lightRamp, brightRamp } = MASK_LUMINANCE;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    const luminance =
      0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
    let maskAlpha = alpha;
    if (preferDarkLuminance) {
      maskAlpha = alpha * clamp01((darkRamp.edge - luminance) / darkRamp.span);
    } else if (useLightLuminance) {
      maskAlpha = alpha * clamp01((luminance - lightRamp.edge) / lightRamp.span);
    } else if (useDarkLuminance) {
      maskAlpha = alpha * clamp01((brightRamp.edge - luminance) / brightRamp.span);
    }
    data[index] = maskAlpha;
    data[index + 1] = maskAlpha;
    data[index + 2] = maskAlpha;
    data[index + 3] = maskAlpha;
  }
}
