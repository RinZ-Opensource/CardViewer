import React from "react";
import { OFFICIAL_ASSET_ROOT, OfficialFontContext } from "../constants";
import { loadOfficialFont } from "../fonts";
import { layoutUnityText } from "../textRendering";
import type { OfficialFontKey, UnityFontMetrics } from "../types";
import { FitText } from "./FitText";

const atlasPromises = new Map<string, Promise<void>>();

function preloadAtlas(font: UnityFontMetrics) {
  const src = `${OFFICIAL_ASSET_ROOT}${font.texture}`;
  const cached = atlasPromises.get(src);
  if (cached) return cached;

  const promise = new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`R2 Unity font atlas unavailable: ${font.texture}`));
    image.src = src;
  });
  atlasPromises.set(src, promise);
  void promise.catch(() => {
    if (atlasPromises.get(src) === promise) atlasPromises.delete(src);
  });
  return promise;
}

function fontCoversText(font: UnityFontMetrics, text: string) {
  return Array.from(text).every((character) => {
    if (character === "\r" || character === "\n") return true;
    return Boolean(font.chars[String(character.codePointAt(0) ?? 0)]);
  });
}

interface ScorecardBitmapTextProps {
  className: string;
  text: string;
  fontKey: OfficialFontKey;
  fontSize: number;
  width: number;
  height: number;
  alignment: number;
  color: string;
  lineSpacing?: number;
  fitHorizontal?: boolean;
  characterSpacing?: number;
  horizontalScale?: number;
  glyphOffsetY?: number;
  fixedGlyphTop?: boolean;
}

/**
 * Renders score-card copy from the same Unity bitmap atlases as Card Viewer.
 *
 * The atlas glyphs are visual-only. A clipped DOM span preserves the complete
 * text for assistive technology, selection-independent indexing, and tests.
 * Until the R2 catalog is ready, the existing CSS face remains as a visual
 * fallback instead of leaving an empty title box.
 */
export function ScorecardBitmapText({
  className,
  text,
  fontKey,
  fontSize,
  width,
  height,
  alignment,
  color,
  lineSpacing = 1,
  fitHorizontal = true,
  characterSpacing = 0,
  horizontalScale = 1,
  glyphOffsetY = 0,
  fixedGlyphTop = false,
}: ScorecardBitmapTextProps) {
  const contextFont = React.useContext(OfficialFontContext)[fontKey];
  const [font, setFont] = React.useState<UnityFontMetrics | null>(null);
  const maskIdPrefix = React.useId().replace(/:/g, "");

  // Clear an old ready atlas before paint when the selected song/font changes,
  // so a newly missing glyph never flashes as TMP's square fallback.
  React.useLayoutEffect(() => {
    let cancelled = false;
    setFont(null);
    const fontPromise = contextFont ? Promise.resolve(contextFont) : loadOfficialFont(fontKey);
    void fontPromise
      .then(async (candidate) => {
        if (!fontCoversText(candidate, text)) return null;
        await preloadAtlas(candidate);
        return candidate;
      })
      .then((candidate) => {
        if (!cancelled) setFont(candidate);
      })
      .catch(() => {
        if (!cancelled) setFont(null);
      });
    return () => {
      cancelled = true;
    };
  }, [contextFont, fontKey, text]);

  const glyphs = font
    ? layoutUnityText(
        font,
        text,
        fontSize,
        width,
        height,
        alignment,
        lineSpacing,
        color,
        fitHorizontal,
        characterSpacing,
        horizontalScale,
        glyphOffsetY,
        fixedGlyphTop,
      )
    : [];

  return (
    <div
      className={`${className} scorecard-bitmap-text`}
      style={{ overflow: "hidden", pointerEvents: "none" }}
    >
      <span className="visually-hidden">{text}</span>
      {!font ? (
        <span className="scorecard-bitmap-fallback" aria-hidden="true">
          {fitHorizontal ? (
            <FitText
              maxWidth={width}
              origin={alignment % 3 === 0 ? "left" : alignment % 3 === 2 ? "right" : "center"}
            >
              {text}
            </FitText>
          ) : (
            text
          )}
        </span>
      ) : (
        glyphs.map((glyph) => {
          const maskId = `${maskIdPrefix}-${glyph.key}`;
          return (
            <span
              aria-hidden="true"
              className="scorecard-bitmap-glyph"
              key={glyph.key}
              style={{ ...glyph.style, position: "absolute", display: "block" }}
            >
              <svg
                aria-hidden="true"
                focusable="false"
                viewBox={`0 0 ${glyph.sourceW} ${glyph.sourceH}`}
                preserveAspectRatio="none"
                style={{ display: "block", width: "100%", height: "100%", overflow: "visible" }}
              >
                <defs>
                  <mask
                    id={maskId}
                    maskUnits="userSpaceOnUse"
                    x="0"
                    y="0"
                    width={glyph.sourceW}
                    height={glyph.sourceH}
                  >
                    <image
                      href={`${OFFICIAL_ASSET_ROOT}${font.texture}`}
                      x={-glyph.sourceX}
                      y={-glyph.sourceY}
                      width={font.width}
                      height={font.height}
                    />
                  </mask>
                </defs>
                <rect
                  width={glyph.sourceW}
                  height={glyph.sourceH}
                  fill={glyph.color}
                  mask={`url(#${maskId})`}
                />
              </svg>
            </span>
          );
        })
      )}
    </div>
  );
}
