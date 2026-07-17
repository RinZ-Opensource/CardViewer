import React from "react";
import { OFFICIAL_ASSET_ROOT, OfficialFontContext } from "../constants";
import { loadOfficialFont } from "../fonts";
import { layoutUnityTextPixels, type UnityTextGlyphLayout } from "../textRendering";
import type { OfficialFontKey, UnityFontMetrics } from "../types";
import { FitText } from "./FitText";
import { useScorecardRenderScale } from "./ScorecardRenderContext";
import { scorecardTextBackingScale } from "./scorecardRenderScale";

const atlasPromises = new Map<string, Promise<HTMLImageElement>>();

function loadAtlas(font: UnityFontMetrics) {
  const src = `${OFFICIAL_ASSET_ROOT}${font.texture}`;
  const cached = atlasPromises.get(src);
  if (cached) return cached;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`R2 Unity font atlas unavailable: ${font.texture}`));
    image.src = src;
  });
  atlasPromises.set(src, promise);
  void promise.catch(() => {
    if (atlasPromises.get(src) === promise) atlasPromises.delete(src);
  });
  return promise;
}

const SCORECARD_GLYPH_ALIASES: Readonly<Record<string, string>> = {
  // The exported static SegaKaku atlases omit the curved-up music-title mark.
  // Its up-arrow supplies only the advance and cast-box metrics; the authored
  // character itself is painted by a one-character DOM fallback below.
  "⤴": "↑",
};

type AtlasTextSubstitution = {
  character: string;
  glyphKey: string;
};

function resolveAtlasText(font: UnityFontMetrics, text: string) {
  const outputLines: string[] = [];
  const substitutions: AtlasTextSubstitution[] = [];
  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    let outputLine = "";
    for (const [characterIndex, character] of Array.from(line).entries()) {
      if (font.chars[String(character.codePointAt(0) ?? 0)]) {
        outputLine += character;
        continue;
      }
      const alias = SCORECARD_GLYPH_ALIASES[character];
      if (!alias || !font.chars[String(alias.codePointAt(0) ?? 0)]) return null;
      outputLine += alias;
      substitutions.push({
        character,
        glyphKey: `${lineIndex}-${characterIndex}-${alias.codePointAt(0) ?? 0}`,
      });
    }
    outputLines.push(outputLine);
  }
  return { renderText: outputLines.join("\n"), substitutions };
}

function renderBitmapText(
  canvas: HTMLCanvasElement,
  atlas: HTMLImageElement,
  font: UnityFontMetrics,
  glyphs: readonly UnityTextGlyphLayout[],
  substitutedGlyphKeys: ReadonlySet<string>,
  options: {
    width: number;
    height: number;
    color: string;
    bleed: number;
    stageScale: number;
  },
) {
  const devicePixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const backingScale = scorecardTextBackingScale(options.stageScale, devicePixelRatio, 2);
  const logicalWidth = options.width + options.bleed * 2;
  const logicalHeight = options.height + options.bleed * 2;
  const pixelWidth = Math.max(1, Math.ceil(logicalWidth * backingScale));
  const pixelHeight = Math.max(1, Math.ceil(logicalHeight * backingScale));

  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

  const context = canvas.getContext("2d");
  if (!context) return;
  context.resetTransform();
  context.clearRect(0, 0, pixelWidth, pixelHeight);
  context.setTransform(backingScale, 0, 0, backingScale, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  // Paint all alpha masks into one surface before tinting. This preserves the
  // atlas' antialiasing while avoiding one SVG filter/resample per character.
  glyphs.forEach((glyph) => {
    if (substitutedGlyphKeys.has(glyph.key)) return;
    const sourceX = Math.round(glyph.sourceX);
    const sourceY = Math.round(glyph.sourceY);
    const sourceW = Math.round(glyph.sourceW);
    const sourceH = Math.round(glyph.sourceH);
    if (
      sourceW <= 0 ||
      sourceH <= 0 ||
      sourceX < 0 ||
      sourceY < 0 ||
      sourceX + sourceW > font.width ||
      sourceY + sourceH > font.height
    ) {
      return;
    }
    context.drawImage(
      atlas,
      sourceX,
      sourceY,
      sourceW,
      sourceH,
      options.bleed + glyph.x,
      options.bleed + glyph.y,
      glyph.width,
      glyph.height,
    );
  });

  context.globalCompositeOperation = "source-in";
  context.fillStyle = options.color;
  context.fillRect(0, 0, logicalWidth, logicalHeight);
  context.globalCompositeOperation = "source-over";
  context.resetTransform();
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
 * The atlas is drawn once into a DPR/stage-scale-aware canvas. A visually
 * hidden DOM span preserves the complete text for assistive technology.
 * Until the R2 catalog and atlas are ready, the CSS face remains visible.
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
  const stageScale = useScorecardRenderScale();
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = React.useState<{
    font: UnityFontMetrics;
    atlas: HTMLImageElement;
    renderText: string;
    substitutions: AtlasTextSubstitution[];
  } | null>(null);
  const bleed = Math.max(2, Math.ceil(fontSize * 0.125));

  // Clear an old ready atlas before paint when the selected song/font changes,
  // so a newly missing glyph never flashes as the square fallback.
  React.useLayoutEffect(() => {
    let cancelled = false;
    setReady(null);
    const fontPromise = contextFont ? Promise.resolve(contextFont) : loadOfficialFont(fontKey);
    void fontPromise
      .then(async (candidate) => {
        const resolved = resolveAtlasText(candidate, text);
        if (resolved == null) return null;
        const atlas = await loadAtlas(candidate);
        return { font: candidate, atlas, ...resolved };
      })
      .then((candidate) => {
        if (!cancelled) setReady(candidate);
      })
      .catch(() => {
        if (!cancelled) setReady(null);
      });
    return () => {
      cancelled = true;
    };
  }, [contextFont, fontKey, text]);

  const glyphs = React.useMemo(
    () => ready
      ? layoutUnityTextPixels(
          ready.font,
          ready.renderText,
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
      : [],
    [
      alignment,
      characterSpacing,
      color,
      fitHorizontal,
      fixedGlyphTop,
      fontSize,
      glyphOffsetY,
      height,
      horizontalScale,
      lineSpacing,
      ready,
      width,
    ],
  );

  const substitutedGlyphs = React.useMemo(() => {
    if (!ready || ready.substitutions.length === 0) return [];
    const byKey = new Map(glyphs.map((glyph) => [glyph.key, glyph]));
    return ready.substitutions.flatMap((substitution) => {
      const glyph = byKey.get(substitution.glyphKey);
      return glyph ? [{ ...substitution, glyph }] : [];
    });
  }, [glyphs, ready]);

  const substitutedGlyphKeys = React.useMemo(
    () => new Set(ready?.substitutions.map(({ glyphKey }) => glyphKey) ?? []),
    [ready],
  );
  const bitmapReady = ready && substitutedGlyphs.length === ready.substitutions.length
    ? ready
    : null;

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmapReady) return;
    renderBitmapText(canvas, bitmapReady.atlas, bitmapReady.font, glyphs, substitutedGlyphKeys, {
      width,
      height,
      color,
      bleed,
      stageScale,
    });
  }, [
    bleed,
    bitmapReady,
    color,
    glyphs,
    height,
    stageScale,
    substitutedGlyphKeys,
    width,
  ]);

  return (
    <div
      className={`${className} scorecard-bitmap-text`}
      style={{ overflow: "hidden", pointerEvents: "none" }}
    >
      <span className="visually-hidden">{text}</span>
      {!bitmapReady ? (
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
        <>
          <canvas
            ref={canvasRef}
            className="scorecard-bitmap-canvas"
            aria-hidden="true"
            style={{
              position: "absolute",
              display: "block",
              left: -bleed,
              top: -bleed,
              width: width + bleed * 2,
              height: height + bleed * 2,
              maxWidth: "none",
            }}
          />
          {substitutedGlyphs.map(({ character, glyphKey, glyph }) => (
            <span
              aria-hidden="true"
              className="scorecard-bitmap-character-fallback"
              key={glyphKey}
              style={{
                alignItems: "center",
                color,
                display: "flex",
                fontFamily: "inherit",
                fontSize,
                height: glyph.height,
                justifyContent: "center",
                left: glyph.x,
                lineHeight: 1,
                position: "absolute",
                top: glyph.y,
                width: glyph.width,
              }}
            >
              {character}
            </span>
          ))}
        </>
      )}
    </div>
  );
}
