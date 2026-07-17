import React from "react";
import { OFFICIAL_ASSET_ROOT, OfficialFontContext } from "../constants";
import { unityRect } from "../geometry";
import { layoutUnityText, reactText } from "../textRendering";
import type { OfficialFontKey } from "../types";
import { LayerText } from "./primitives";

export function LayerUnityText({
  children,
  className,
  fontKey,
  fontSize,
  alignment,
  color = "#ffffff",
  lineSpacing = 1,
  fitHorizontal = false,
  characterSpacing = 0,
  horizontalScale = 1,
  glyphOffsetY = 0,
  fixedGlyphTop = false,
  x,
  y,
  w,
  h,
  rotation,
  scale,
}: {
  children: React.ReactNode;
  className: string;
  fontKey: OfficialFontKey;
  fontSize: number;
  alignment: number;
  color?: string;
  lineSpacing?: number;
  fitHorizontal?: boolean;
  characterSpacing?: number;
  horizontalScale?: number;
  glyphOffsetY?: number;
  fixedGlyphTop?: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  scale?: number;
}) {
  const fonts = React.useContext(OfficialFontContext);
  const font = fonts[fontKey];
  const text = reactText(children);
  const maskIdPrefix = React.useId().replace(/:/g, "");

  if (!font) {
    return (
      <LayerText className={className} x={x} y={y} w={w} h={h} rotation={rotation} scale={scale}>
        {children}
      </LayerText>
    );
  }

  const glyphs = layoutUnityText(font, text, fontSize, w, h, alignment, lineSpacing, color, fitHorizontal, characterSpacing, horizontalScale, glyphOffsetY, fixedGlyphTop);
  return (
    <div className={`official-bitmap-text ${className}`} style={unityRect(x, y, w, h, { rotation, scale })}>
      {glyphs.map((glyph) => {
        const maskId = `${maskIdPrefix}-${glyph.key}`;
        return (
          <span className="official-bitmap-glyph" style={glyph.style} key={glyph.key}>
            <svg className="official-bitmap-svg" viewBox={`0 0 ${glyph.sourceW} ${glyph.sourceH}`} preserveAspectRatio="none">
              <defs>
                <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={glyph.sourceW} height={glyph.sourceH}>
                  <image href={`${OFFICIAL_ASSET_ROOT}${font.texture}`} x={-glyph.sourceX} y={-glyph.sourceY} width={font.width} height={font.height} />
                </mask>
              </defs>
              <rect width={glyph.sourceW} height={glyph.sourceH} fill={glyph.color} mask={`url(#${maskId})`} />
            </svg>
          </span>
        );
      })}
    </div>
  );
}
