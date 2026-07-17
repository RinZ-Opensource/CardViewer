import React from "react";
import { CARD_HEIGHT, CARD_WIDTH, SpriteCrop } from "./constants";

export type RectLike = { x: number; y: number; w: number; h: number; rotation?: number };

// Unity card coordinates put (0,0) at the card center with +y pointing up.
// Convert that into the top-left origin a canvas/DOM uses, returning the
// rect's top-left corner in card-pixel space.
export function unityRectTopLeft(x: number, y: number, w: number, h: number) {
  return {
    left: CARD_WIDTH / 2 + x - w / 2,
    top: CARD_HEIGHT / 2 - y - h / 2,
  };
}

export function unityRect(
  x: number,
  y: number,
  w: number,
  h: number,
  transform: { rotation?: number; scale?: number } = {},
): React.CSSProperties {
  const { left, top } = unityRectTopLeft(x, y, w, h);
  const transforms = [
    transform.rotation ? `rotate(${-transform.rotation}deg)` : "",
    transform.scale && transform.scale !== 1 ? `scale(${transform.scale})` : "",
  ].filter(Boolean);
  return {
    left: `${(left / CARD_WIDTH) * 100}%`,
    top: `${(top / CARD_HEIGHT) * 100}%`,
    width: `${(w / CARD_WIDTH) * 100}%`,
    height: `${(h / CARD_HEIGHT) * 100}%`,
    transform: transforms.length ? transforms.join(" ") : undefined,
    transformOrigin: "50% 50%",
  };
}

export function withUnityCanvasRect(
  ctx: CanvasRenderingContext2D,
  rect: RectLike,
  draw: (left: number, top: number, width: number, height: number) => void,
) {
  const { left, top } = unityRectTopLeft(rect.x, rect.y, rect.w, rect.h);
  const centerX = left + rect.w / 2;
  const centerY = top + rect.h / 2;
  ctx.save();
  if (rect.rotation) {
    ctx.translate(centerX, centerY);
    ctx.rotate((-rect.rotation * Math.PI) / 180);
    ctx.translate(-centerX, -centerY);
  }
  draw(left, top, rect.w, rect.h);
  ctx.restore();
}

export function spriteCropDisplayRect(
  rect: { x: number; y: number; w: number; h: number },
  crop: SpriteCrop,
) {
  return {
    x: rect.x - rect.w / 2 + crop.x + crop.w / 2,
    y: rect.y + rect.h / 2 - crop.y - crop.h / 2,
    w: crop.w,
    h: crop.h,
  };
}
