import type { CSSProperties } from "react";

import { CARD_TILT_X_MAX, CARD_TILT_Y_MAX } from "../constants";
import { clampNumber } from "../numeric";
import type { ViewMode } from "../types";

export type CardTilt = { x: number; y: number };

export function cardLightStyle(tilt: CardTilt, mode: ViewMode): CSSProperties {
  if (mode !== "3d") {
    return {
      "--holo-light-x": "32%",
      "--holo-light-y": "22%",
      "--holo-pointer-x": "32%",
      "--holo-pointer-y": "22%",
      "--holo-pointer-from-center": "0.35",
      "--holo-pointer-from-left": "0.32",
      "--holo-pointer-from-top": "0.22",
      "--holo-bg-x": "47%",
      "--holo-bg-y": "40%",
      "--holo-bg-x-inv": "53%",
      "--holo-bg-y-inv": "60%",
      "--holo-fine-x": "56%",
      "--holo-fine-y": "43%",
      "--holo-shift-x": "-3px",
      "--holo-shift-y": "-4px",
      "--holo-shift-x-inv": "3px",
      "--holo-shift-y-inv": "4px",
      "--holo-opacity": "0.88",
      "--holo-sparkle-opacity": "0.96",
      "--holo-glare-opacity": "0.5",
      "--holo-hue": "0deg",
      "--holo-spectrum-angle": "108deg",
      "--edge-light-left": "0.22",
      "--edge-light-right": "0.18",
    } as CSSProperties;
  }

  const pointerX = clampNumber(50 + (tilt.y / CARD_TILT_Y_MAX) * 50, 0, 100);
  const pointerY = clampNumber(50 - (tilt.x / CARD_TILT_X_MAX) * 50, 0, 100);
  const bgX = clampNumber(37 + pointerX * 0.26, 37, 63);
  const bgY = clampNumber(33 + pointerY * 0.34, 33, 67);
  const bgXInv = 100 - bgX;
  const bgYInv = 100 - bgY;
  const distanceFromCenter = clampNumber(Math.hypot(pointerX - 50, pointerY - 50) / 50, 0, 1);
  const lightX = clampNumber(32 - tilt.y * 1.28, 6, 94);
  const lightY = clampNumber(22 + tilt.x * 1.18, 6, 86);
  const leftEdge = clampNumber(0.22 + tilt.y / 85, 0.04, 0.48);
  const rightEdge = clampNumber(0.18 - tilt.y / 85, 0.04, 0.48);
  const shiftX = clampNumber((bgX - 50) * 0.78, -14, 14);
  const shiftY = clampNumber((bgY - 50) * 0.58, -12, 12);
  const holoHue = clampNumber((pointerX - 50) * 3.4 + (pointerY - 50) * 1.5, -210, 210);
  const spectrumAngle = clampNumber(108 + (pointerX - 50) * 0.7 - (pointerY - 50) * 0.5, 70, 150);

  return {
    "--holo-light-x": `${lightX}%`,
    "--holo-light-y": `${lightY}%`,
    "--holo-pointer-x": `${pointerX}%`,
    "--holo-pointer-y": `${pointerY}%`,
    "--holo-pointer-from-center": `${distanceFromCenter}`,
    "--holo-pointer-from-left": `${pointerX / 100}`,
    "--holo-pointer-from-top": `${pointerY / 100}`,
    "--holo-bg-x": `${bgX}%`,
    "--holo-bg-y": `${bgY}%`,
    "--holo-bg-x-inv": `${bgXInv}%`,
    "--holo-bg-y-inv": `${bgYInv}%`,
    "--holo-fine-x": `${clampNumber(50 + (50 - bgX) * 1.35, 14, 86)}%`,
    "--holo-fine-y": `${clampNumber(50 + (bgY - 50) * 1.2, 12, 88)}%`,
    "--holo-shift-x": `${shiftX}px`,
    "--holo-shift-y": `${shiftY}px`,
    "--holo-shift-x-inv": `${-shiftX}px`,
    "--holo-shift-y-inv": `${-shiftY}px`,
    "--holo-opacity": `${0.84 + distanceFromCenter * 0.14}`,
    "--holo-sparkle-opacity": `${0.86 + distanceFromCenter * 0.12}`,
    "--holo-glare-opacity": `${0.28 + distanceFromCenter * 0.42}`,
    "--holo-hue": `${holoHue}deg`,
    "--holo-spectrum-angle": `${spectrumAngle}deg`,
    "--edge-light-left": String(leftEdge),
    "--edge-light-right": String(rightEdge),
  } as CSSProperties;
}
