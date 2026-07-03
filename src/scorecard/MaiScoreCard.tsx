import React from "react";
import {
  MAI_COMBO_SPRITE,
  MAI_DIFF_SUFFIX,
  MAI_LEVEL_DIGITS,
  MAI_LEVEL_SHEET,
  MAI_RANK_SPRITE,
  MAI_SCORE_DIGITS,
  MAI_SYNC_SPRITE,
  maiSprite,
  maiStarSprite,
} from "./maiAssets";
import { formatAchievement, maiDxStars, maiRankForAchievement } from "./maiScore";
import { MaiChart, MaiScoreState, MaiSong } from "./types";

/**
 * Native design size of the music-select detail card. Matches the
 * UI_MSS_MBase_* sprite so every overlay is authored in sprite pixels.
 */
export const MAI_SCORECARD_WIDTH = 284;
export const MAI_SCORECARD_HEIGHT = 464;
/** Export at 3x so the 284px-wide base sprite still reads crisply. */
export const MAI_SCORECARD_EXPORT_WIDTH = MAI_SCORECARD_WIDTH * 3;

interface DigitSheetSpec {
  cellWidth: number;
  cellHeight: number;
  columns: number;
  rows: number;
  glyphs: Record<string, [number, number]>;
}

interface SpriteDigitsProps {
  sheet: DigitSheetSpec;
  src: string;
  text: string;
  /** Rendered glyph height in design px. */
  height: number;
  /** Fraction of a cell width to overlap consecutive glyphs (sheet cells have padding). */
  tracking?: number;
  className?: string;
}

function SpriteDigits({ sheet, src, text, height, tracking = 0, className }: SpriteDigitsProps) {
  const scale = height / sheet.cellHeight;
  const cellWidth = sheet.cellWidth * scale;
  return (
    <span className={`sprite-digits ${className ?? ""}`}>
      {Array.from(text).map((glyph, index) => {
        const cell = sheet.glyphs[glyph];
        if (!cell) return null;
        return (
          <span
            key={index}
            style={{
              width: cellWidth,
              height,
              marginLeft: index > 0 ? -cellWidth * tracking : 0,
              backgroundImage: `url("${src}")`,
              backgroundPosition: `${-cell[0] * cellWidth}px ${-cell[1] * height}px`,
              backgroundSize: `${sheet.columns * cellWidth}px ${sheet.rows * height}px`,
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

/** Squeezes overflowing text horizontally, like the in-game fitHorizontal. */
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

  return (
    <div className="mai-scorecard" ref={captureRef}>
      <img className="msc-base" src={maiSprite(`UI_MSS_MBase_${suffix}`)} alt="" />

      <img
        className="msc-type-plate"
        src={maiSprite(
          song.isDx ? "UI_MSS_Infoicon_DeluxeMode" : "UI_MSS_Infoicon_StandardMode",
        )}
        alt={song.isDx ? "でらっくす" : "スタンダード"}
      />

      <img className="msc-jacket" src={song.jacketUrl} alt="" decoding="async" />

      <img
        className="msc-diff-banner"
        src={maiSprite(`UI_MSS_MBase_${suffix}_Text`)}
        alt={chart.difficulty}
      />
      <div className="msc-lv-row">
        <img className="msc-lv-label" src={maiSprite("UI_MSS_MBase_Lv")} alt="Lv" />
        <SpriteDigits
          sheet={MAI_LEVEL_DIGITS}
          src={levelSheet}
          text={chart.level}
          height={34}
          tracking={0.34}
        />
      </div>

      <div className="msc-title">
        <FitText maxWidth={228}>{song.title}</FitText>
      </div>
      <div className="msc-artist">
        <FitText maxWidth={228}>{song.artist}</FitText>
      </div>

      <div className="msc-achievement">
        <SpriteDigits
          sheet={MAI_SCORE_DIGITS}
          src={maiSprite("UI_NUM_Score_0001111_Gold")}
          text={achievementInt}
          height={26}
          tracking={0.3}
        />
        <SpriteDigits
          sheet={MAI_SCORE_DIGITS}
          src={maiSprite("UI_NUM_Score_0001111_Gold")}
          text={`.${achievementFrac}`}
          height={21}
          tracking={0.3}
        />
        <span className="msc-achievement-unit">%</span>
      </div>
      <img className="msc-rank" src={maiSprite(MAI_RANK_SPRITE[rank])} alt={rank} />

      <div className="msc-badges">
        <img
          src={maiSprite(
            state.comboBadge !== "none"
              ? MAI_COMBO_SPRITE[state.comboBadge]
              : "UI_MSS_MBase_Icon_Blank",
          )}
          alt={state.comboBadge}
        />
        <img
          src={maiSprite(
            state.syncBadge !== "none"
              ? MAI_SYNC_SPRITE[state.syncBadge]
              : "UI_MSS_MBase_Icon_Blank",
          )}
          alt={state.syncBadge}
        />
      </div>

      <div className="msc-dxscore">
        <img className="msc-dxscore-label" src={maiSprite("UI_MSS_MBase_Text_DXscore")} alt="DXSCORE" />
        <span className="msc-dxscore-value">
          {dxScore}
          <span className="msc-dxscore-max">/ {maxDxScore > 0 ? String(maxDxScore) : "----"}</span>
        </span>
      </div>

      <div className="msc-designer-row">
        <img
          className="msc-designer-label"
          src={maiSprite("UI_MSS_MBase_Text_NotesDesigner")}
          alt="NOTES DESIGNER"
        />
        <span className="msc-stars">
          {Array.from({ length: stars }, (_, index) => (
            <img key={index} src={maiSprite(maiStarSprite(stars))} alt="" />
          ))}
        </span>
      </div>

      <div className="msc-footer">
        <FitText maxWidth={150} className="msc-designer-name">
          {chart.notesDesigner || "-"}
        </FitText>
        <span className="msc-bpm">BPM {song.bpm}</span>
      </div>
    </div>
  );
}
