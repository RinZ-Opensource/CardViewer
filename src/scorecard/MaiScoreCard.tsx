import React from "react";
import {
  MAI_COMBO_SPRITE,
  MAI_DIFF_SUFFIX,
  MAI_LEVEL_DIGITS,
  MAI_LEVEL_SHEET,
  MAI_RANK_SPRITE,
  MAI_STAR_SPRITE,
  MAI_SYNC_SPRITE,
  maiSprite,
} from "./maiAssets";
import { formatAchievement, maiDxStars, maiRankForAchievement } from "./maiScore";
import { MaiChart, MaiScoreState, MaiSong } from "./types";

/**
 * Native design size of the music-select detail card (MusicChainCard.prefab
 * UI_Main), so every overlay is authored in the prefab's own pixels.
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

  // Bookmark tabs: DX bump left (Tab_01), Standard bump right (Tab_02); the
  // active chart type's tab and pill render in front, the other is dimmed.
  const frontTab = song.isDx ? "Tab_01" : "Tab_02";
  const backTab = song.isDx ? "Tab_02" : "Tab_01";

  return (
    <div className="mai-scorecard" ref={captureRef}>
      <img className="msc-base" src={maiSprite(`UI_MSS_MBase_${suffix}`)} alt="" />

      {/* White-section backplates + labels (prefab MusicData_NEW / DXScore) */}
      <span className="msc-box msc-box-achievement" />
      <span className="msc-box msc-box-rank" />
      <span className="msc-box msc-box-dxscore" />
      <span className="msc-box msc-box-dxscore-max" />
      <img
        className="msc-designer-label"
        src={maiSprite("UI_MSS_MBase_Text_NotesDesigner")}
        alt="NOTES DESIGNER"
      />
      <img
        className="msc-dxscore-label"
        src={maiSprite("UI_MSS_MBase_Text_DXscore")}
        alt="DX SCORE"
      />

      {/* Bookmark tabs (card top) */}
      <img className="msc-tab msc-tab-back" src={maiSprite(`UI_MSS_MBase_${suffix}_${backTab}`)} alt="" />
      <img
        className={`msc-pill msc-pill-back ${song.isDx ? "at-right" : "at-left"}`}
        src={maiSprite(song.isDx ? "UI_MSS_Infoicon_StandardMode" : "UI_MSS_Infoicon_DeluxeMode")}
        alt=""
      />
      <img className="msc-tab msc-tab-front" src={maiSprite(`UI_MSS_MBase_${suffix}_${frontTab}`)} alt="" />
      <img
        className={`msc-pill msc-pill-front ${song.isDx ? "at-left" : "at-right"}`}
        src={maiSprite(song.isDx ? "UI_MSS_Infoicon_DeluxeMode" : "UI_MSS_Infoicon_StandardMode")}
        alt={song.isDx ? "でらっくす" : "スタンダード"}
      />

      <img className="msc-jacket" src={song.jacketUrl} alt="" decoding="async" />

      {/* Difficulty banner + level */}
      <img className="msc-diff-banner" src={maiSprite(`UI_MSS_MBase_${suffix}_Text`)} alt={chart.difficulty} />
      <img className="msc-lv-base" src={maiSprite(`UI_MSS_MBase_LvBase_${suffix}`)} alt="" />
      <SpriteDigits
        className="msc-lv-glyph"
        sheet={MAI_LEVEL_DIGITS}
        src={levelSheet}
        text="L"
        height={48}
      />
      <SpriteDigits
        className="msc-lv-value"
        sheet={MAI_LEVEL_DIGITS}
        src={levelSheet}
        text={chart.level}
        height={51}
        tracking={0.32}
      />

      <div className="msc-title">
        <FitText maxWidth={240}>{song.title}</FitText>
      </div>
      <div className="msc-artist">
        <FitText maxWidth={240}>{song.artist}</FitText>
      </div>

      {/* Achievement row (NewRodin EB gold on the navy box) */}
      <span className="msc-ach msc-ach-int">{achievementInt}</span>
      <span className="msc-ach msc-ach-dec">.{achievementFrac}</span>
      <span className="msc-ach msc-ach-pct">%</span>
      <img className="msc-rank" src={maiSprite(MAI_RANK_SPRITE[rank])} alt={rank} />

      {/* Badge medals */}
      {state.comboBadge !== "none" ? (
        <img className="msc-medal msc-medal-combo" src={maiSprite(MAI_COMBO_SPRITE[state.comboBadge])} alt={state.comboBadge} />
      ) : (
        <img className="msc-medal-blank msc-medal-combo-blank" src={maiSprite("UI_MSS_MBase_Icon_Blank")} alt="" />
      )}
      {state.syncBadge !== "none" ? (
        <img className="msc-medal msc-medal-sync" src={maiSprite(MAI_SYNC_SPRITE[state.syncBadge])} alt={state.syncBadge} />
      ) : (
        <img className="msc-medal-blank msc-medal-sync-blank" src={maiSprite("UI_MSS_MBase_Icon_Blank")} alt="" />
      )}

      {/* DX score row (MaruGothic DB white on the navy boxes) */}
      <span className="msc-dx-value">{dxScore.toLocaleString()}</span>
      <span className="msc-dx-slash">/</span>
      <span className="msc-dx-max">{maxDxScore > 0 ? maxDxScore.toLocaleString() : "----"}</span>

      {/* DX star pips: 5 always, earned orange / unearned blue-gray */}
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

      <FitText maxWidth={162} className="msc-designer-name">
        {chart.notesDesigner || "-"}
      </FitText>
      <span className="msc-bpm">BPM:{song.bpm}</span>
    </div>
  );
}
