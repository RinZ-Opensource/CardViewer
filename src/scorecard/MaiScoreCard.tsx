import React from "react";
import {
  GlyphSheet,
  MAI_COMBO_SPRITE,
  MAI_DIFF_SUFFIX,
  MAI_LEVEL_GLYPHS,
  MAI_LEVEL_SHEET,
  MAI_RANK_SPRITE,
  MAI_STAR_SPRITE,
  MAI_SYNC_SPRITE,
  maiSprite,
} from "./maiAssets";
import { formatAchievement, maiDxStars, maiRankForAchievement } from "./maiScore";
import { MaiChart, MaiScoreState, MaiSong } from "./types";

/**
 * Design space: MusicChainCard.prefab UI_Main (284x464) plus 6px headroom so
 * the bookmark tab can sit raised above the frame like the in-game active
 * card. The body wrapper offsets all base-relative coordinates by +6.
 */
export const MAI_SCORECARD_WIDTH = 284;
export const MAI_SCORECARD_HEIGHT = 470;
/** Export at 3x so the 284px-wide base sprite still reads crisply. */
export const MAI_SCORECARD_EXPORT_WIDTH = MAI_SCORECARD_WIDTH * 3;

interface RectDigitsProps {
  sheet: GlyphSheet;
  src: string;
  text: string;
  /** Unity render scale: design px per texture px (e.g. SpriteCounter 0.85). */
  scale: number;
  /** Extra horizontal gap between glyphs in design px. */
  gap?: number;
  className?: string;
}

/**
 * Renders text from a sprite sheet using tight glyph rects, preserving each
 * glyph's vertical offset within its sheet cell (so "+" stays superscript).
 */
function RectDigits({ sheet, src, text, scale, gap = 2, className }: RectDigitsProps) {
  return (
    <span className={`rect-digits ${className ?? ""}`} style={{ height: sheet.cellHeight * scale }}>
      {Array.from(text).map((glyph, index) => {
        const rect = sheet.glyphs[glyph];
        if (!rect) return null;
        const [x, y, w, h] = rect;
        const offsetInCell = y % sheet.cellHeight;
        return (
          <span
            key={index}
            style={{
              width: w * scale,
              height: h * scale,
              marginLeft: index > 0 ? gap : 0,
              marginTop: offsetInCell * scale,
              backgroundImage: `url("${src}")`,
              backgroundPosition: `${-x * scale}px ${-y * scale}px`,
              backgroundSize: `${sheet.textureWidth * scale}px ${sheet.textureHeight * scale}px`,
            }}
          />
        );
      })}
    </span>
  );
}

interface FitTextProps {
  maxWidth: number;
  className?: string;
  children: React.ReactNode;
}

/** Squeezes overflowing text horizontally (the game scrolls; we compress). */
function FitText({ maxWidth, className, children }: FitTextProps) {
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
      style={{ transform: `scaleX(${scale})`, transformOrigin: "center" }}
    >
      {children}
    </span>
  );
}

interface MaiScoreCardProps {
  song: MaiSong;
  chart: MaiChart;
  state: MaiScoreState;
  maxDxScore: number;
  captureRef?: React.Ref<HTMLDivElement>;
}

export function MaiScoreCard({ song, chart, state, maxDxScore, captureRef }: MaiScoreCardProps) {
  const suffix = MAI_DIFF_SUFFIX[chart.difficulty];
  const achievement = formatAchievement(state.achievement);
  const rank = maiRankForAchievement(Number.parseFloat(achievement));
  const dxScore = Number.parseInt(state.dxScore, 10) || 0;
  const stars = maiDxStars(dxScore, maxDxScore);
  const levelSheet = maiSprite(`UI_NUM_MLevel_${MAI_LEVEL_SHEET[chart.difficulty]}`);
  const [achievementInt, achievementFrac = "0000"] = achievement.split(".");
  // Empty achievement input = unplayed: blank plates, no score rows.
  const played = state.achievement.trim().length > 0;

  return (
    <div className="mai-scorecard" ref={captureRef}>
      {/* Bookmark tab, raised 6px above the base like the active in-game card:
          DX bump left (Tab_01), Standard bump right (Tab_02). */}
      <img
        className="msc-tab"
        src={maiSprite(`UI_MSS_MBase_${suffix}_${song.isDx ? "Tab_01" : "Tab_02"}`)}
        alt=""
      />
      <img
        className={`msc-pill ${song.isDx ? "at-left" : "at-right"}`}
        src={maiSprite(song.isDx ? "UI_MSS_Infoicon_DeluxeMode" : "UI_MSS_Infoicon_StandardMode")}
        alt={song.isDx ? "でらっくす" : "スタンダード"}
      />

      <div className="msc-body">
        <img className="msc-base" src={maiSprite(`UI_MSS_MBase_${suffix}`)} alt="" />

        {/* White-section backplates: navy when played, light blanks otherwise */}
        {played ? (
          <>
            <span className="msc-box msc-box-achievement navy" />
            <span className="msc-box msc-box-rank navy" />
            <span className="msc-box msc-box-dxscore navy" />
            <span className="msc-box msc-box-dxscore-max" />
          </>
        ) : (
          <>
            <span className="msc-box msc-box-achievement-blank" />
            <span className="msc-box msc-box-rank-blank" />
          </>
        )}
        <img
          className="msc-designer-label"
          src={maiSprite("UI_MSS_MBase_Text_NotesDesigner")}
          alt="NOTES DESIGNER"
        />
        {played ? (
          <img
            className="msc-dxscore-label"
            src={maiSprite("UI_MSS_MBase_Text_DXscore")}
            alt="DX SCORE"
          />
        ) : null}

        <img className="msc-jacket" src={song.jacketUrl} alt="" decoding="async" />

        {/* Difficulty banner + level */}
        <img className="msc-diff-banner" src={maiSprite(`UI_MSS_MBase_${suffix}_Text`)} alt={chart.difficulty} />
        <img className="msc-lv-base" src={maiSprite(`UI_MSS_MBase_LvBase_${suffix}`)} alt="" />
        <RectDigits
          className="msc-lv-glyph"
          sheet={MAI_LEVEL_GLYPHS}
          src={levelSheet}
          text="L"
          scale={0.8}
        />
        <RectDigits
          className="msc-lv-value"
          sheet={MAI_LEVEL_GLYPHS}
          src={levelSheet}
          text={chart.level}
          scale={0.85}
        />

        <div className="msc-title">
          <FitText maxWidth={240}>{song.title}</FitText>
        </div>
        <div className="msc-artist">
          <FitText maxWidth={240}>{song.artist}</FitText>
        </div>

        {/* Achievement + rank row */}
        {played ? (
          <>
            <span className="msc-ach msc-ach-int">{achievementInt}</span>
            <span className="msc-ach msc-ach-dec">.{achievementFrac}</span>
            <span className="msc-ach msc-ach-pct">%</span>
            <img className="msc-rank" src={maiSprite(MAI_RANK_SPRITE[rank])} alt={rank} />
          </>
        ) : null}

        {/* Badge medals */}
        {played && state.comboBadge !== "none" ? (
          <img className="msc-medal msc-medal-combo" src={maiSprite(MAI_COMBO_SPRITE[state.comboBadge])} alt={state.comboBadge} />
        ) : (
          <img className="msc-medal-blank msc-medal-combo-blank" src={maiSprite("UI_MSS_MBase_Icon_Blank")} alt="" />
        )}
        {played && state.syncBadge !== "none" ? (
          <img className="msc-medal msc-medal-sync" src={maiSprite(MAI_SYNC_SPRITE[state.syncBadge])} alt={state.syncBadge} />
        ) : (
          <img className="msc-medal-blank msc-medal-sync-blank" src={maiSprite("UI_MSS_MBase_Icon_Blank")} alt="" />
        )}

        {/* DX score row + star pips (hidden when unplayed) */}
        {played ? (
          <>
            <span className="msc-dx-value">{dxScore.toLocaleString()}</span>
            <span className="msc-dx-slash">/</span>
            <span className="msc-dx-max">{maxDxScore > 0 ? maxDxScore.toLocaleString() : "----"}</span>
            <span className="msc-stars">
              {Array.from({ length: 5 }, (_, index) => (
                <span
                  key={index}
                  className={`msc-star-pip ${index < stars ? "earned" : ""}`}
                  style={{
                    WebkitMaskImage: `url("${maiSprite(MAI_STAR_SPRITE)}")`,
                    maskImage: `url("${maiSprite(MAI_STAR_SPRITE)}")`,
                  }}
                />
              ))}
            </span>
          </>
        ) : null}

        <FitText maxWidth={162} className="msc-designer-name">
          {chart.notesDesigner || "-"}
        </FitText>
        <span className="msc-bpm">BPM {song.bpm}</span>
      </div>
    </div>
  );
}
