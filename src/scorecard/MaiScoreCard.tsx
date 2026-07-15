import React from "react";
import { FitText } from "./FitText";
import {
  MAI_COMBO_SPRITE,
  MAI_DIFF_SUFFIX,
  MAI_LEVEL_SHEET,
  MAI_RANK_SPRITE,
  MAI_STAR_BASE,
  MAI_SYNC_SPRITE,
  maiSprite,
} from "./maiAssets";
import { formatAchievement, maiDxStars, maiRankForAchievement } from "./maiScore";
import { jacketImgProps } from "./songdb";
import { MaiChart, MaiScoreState, MaiSong } from "./types";

/**
 * Design space: TrackStartProcess.prefab MusicBase (420x636) — the "entering
 * game" score card (UI_TST_* sprites), NOT the song-select MusicChainCard.
 * The frame sits at y54 inside a 420x690 canvas so the bookmark tab/plate can
 * rise 54px above the frame top. Coordinates inside .msc-body are frame-relative
 * (frame at 0,0); the tab/plate use negative tops.
 * Runtime behavior (text formats, star layout, visibility gates) mirrors
 * TimelineRoot.Initialise / TrackStartMonitor.SetTrackStart / SpriteCounter.
 */
export const MAI_SCORECARD_WIDTH = 420;
export const MAI_SCORECARD_HEIGHT = 690;
/** Export at 3x so text and sprites survive typical chat-app downscaling. */
export const MAI_SCORECARD_EXPORT_WIDTH = MAI_SCORECARD_WIDTH * 3;

/** Top-left of each glyph's 48x60 cell in the UI_NUM_MLevel_xx atlas (192x240). */
const LEVEL_CELLS: Record<string, [number, number]> = {
  "0": [0, 0], "1": [48, 0], "2": [96, 0], "3": [144, 0],
  "4": [0, 60], "5": [48, 60], "6": [96, 60], "7": [144, 60],
  "8": [0, 120], "9": [48, 120], "+": [96, 120], "-": [144, 120],
  ",": [0, 180], ".": [48, 180],
};

/**
 * SpriteCounter cell centers in frame coordinates. Levels >9 use the 3-cell
 * LvNum00 counter (pivot x354, pitch 48, per-cell RelativePosition +21/0/-19.5,
 * "+" raised 5px); levels <=9 use the 2-cell LvNum0 (pivot x364, pitch 47,
 * RelativePosition 0/-18). Glyphs always render at the native 48x60 cell size;
 * the string is space-padded to the cell count, so "13" never re-centers.
 */
const LEVEL_LAYOUT_DOUBLE: Array<[number, number]> = [
  [327, 386],
  [354, 386],
  [382.5, 381],
];
const LEVEL_LAYOUT_SINGLE: Array<[number, number]> = [
  [340.5, 386],
  [369.5, 381],
];

interface LevelCounterProps {
  /** Display level, e.g. "7", "7+", "13", "13+". */
  level: string;
  /** UI_NUM_MLevel_xx sheet url for the chart's difficulty. */
  src: string;
}

function LevelCounter({ level, src }: LevelCounterProps) {
  const levelNum = Number.parseInt(level, 10);
  const cells = Number.isFinite(levelNum) && levelNum > 9 ? LEVEL_LAYOUT_DOUBLE : LEVEL_LAYOUT_SINGLE;
  return (
    <>
      {cells.map(([cx, cy], index) => {
        const glyph = level[index];
        const cell = glyph ? LEVEL_CELLS[glyph] : undefined;
        if (!cell) return null;
        return (
          <span
            key={index}
            className="msc-lv-cell"
            style={{
              left: cx - 24,
              top: cy - 30,
              backgroundImage: `url("${src}")`,
              backgroundPosition: `${-cell[0]}px ${-cell[1]}px`,
            }}
          />
        );
      })}
    </>
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
  // The game hides the whole DXSCORE row when there is no score OR dxScore==0.
  const showDx = played && dxScore > 0;
  // DX-score stars are sprite-swapped by tier: 1-2 green, 3-4 orange, 5 gold.
  const starTier = stars >= 5 ? "03" : stars >= 3 ? "02" : "01";
  // Notes designer: "-" only stands in for an empty name on BASIC/ADVANCED.
  const designer =
    chart.notesDesigner ||
    (chart.difficulty === "basic" || chart.difficulty === "advanced" ? "-" : "");
  // BPM is rendered zero-padded to 3 digits ("BPM 075"), "???" when unknown.
  const bpmText = song.bpm >= 0 ? String(Math.trunc(song.bpm)).padStart(3, "0") : "???";

  return (
    <div className="mai-scorecard" ref={captureRef}>
      <div className="msc-body">
        {/* Frame: baked jacket window, EXPERT wordmark, navy title band, white
            info panel and the pale clear-circles. */}
        <img className="msc-base" src={maiSprite(`UI_TST_MBase_${suffix}`)} alt="" />

        {/* Bookmark tab + mode plate, first children like the prefab (only the
            LONG badge may overlap them): でらっくす (DX) sits left, スタンダード
            (Standard) mirrors the tab bump and sits right, same height. */}
        <img className={`msc-tab ${song.isDx ? "" : "mirrored"}`} src={maiSprite(`UI_TST_MBase_${suffix}_Tab`)} alt="" />
        <img
          className={`msc-pill ${song.isDx ? "at-left" : "at-right"}`}
          src={maiSprite(song.isDx ? "UI_TST_Infoicon_DeluxeMode" : "UI_TST_Infoicon_StandardMode")}
          alt={song.isDx ? "でらっくす" : "スタンダード"}
        />

        <img
          className="msc-jacket"
          {...jacketImgProps(song.jacketUrl, song.jacketFallbacks)}
          alt=""
          decoding="async"
        />

        {/* Level plate + "Lv" mark (atlas cell 14) + SpriteCounter cells */}
        <img className="msc-lv-base" src={maiSprite(`UI_TST_MBase_LV_${suffix}`)} alt="" />
        <span className="msc-lv-mark" style={{ backgroundImage: `url("${levelSheet}")` }} />
        <LevelCounter level={chart.level} src={levelSheet} />

        <div className="msc-title">
          <FitText maxWidth={386}>{song.title}</FitText>
        </div>
        <div className="msc-artist">
          <FitText maxWidth={386}>{song.artist}</FitText>
        </div>

        {/* Achievement + rank backing always show (navy Box_01 played, gray Box_03
            empty). The DXSCORE row only exists when there's a nonzero DX score. */}
        <span className={`msc-box msc-box-achievement ${played ? "" : "blank"}`} />
        <span className={`msc-box msc-box-rank ${played ? "" : "blank"}`} />

        {played ? (
          <>
            <span className="msc-ach msc-ach-int">{achievementInt}</span>
            <span className="msc-ach msc-ach-dec">.{achievementFrac}</span>
            <span className="msc-ach msc-ach-pct">%</span>
            <img className="msc-rank" src={maiSprite(MAI_RANK_SPRITE[rank])} alt={rank} />
          </>
        ) : null}

        {showDx ? (
          <>
            <span className="msc-box msc-box-dxscore" />
            {stars > 0 ? (
              <span
                className="msc-box-star"
                style={{
                  width: MAI_STAR_BASE[stars].width,
                  backgroundImage: `url("${maiSprite(MAI_STAR_BASE[stars].sprite)}")`,
                }}
              />
            ) : null}
            <span className="msc-dxscore-label">DXSCORE</span>
            <span className="msc-dx-value">{dxScore}</span>
            <span className="msc-dx-slash">/</span>
            <span className="msc-dx-max">{maxDxScore > 0 ? maxDxScore : "----"}</span>
            {stars > 0 ? (
              <span className="msc-stars">
                {Array.from({ length: stars }, (_, index) => (
                  <img key={index} className="msc-star" src={maiSprite(`UI_MSS_DXScore_Star_${starTier}`)} alt="" />
                ))}
              </span>
            ) : null}
          </>
        ) : null}

        {/* Notes designer + BPM (labels are TMP text on this card, not sprites) */}
        <span className="msc-designer-label">NOTES DESIGNER</span>
        <FitText maxWidth={243} origin="left" className="msc-designer-name">
          {designer}
        </FitText>
        <span className="msc-bpm">BPM {bpmText}</span>

        {/* Combo / sync medals: real when a badge is set, gray placeholder circle
            otherwise (the game swaps in Icon_Blank, never hides the nodes). */}
        <img
          className="msc-medal msc-medal-combo"
          src={maiSprite(played && state.comboBadge !== "none" ? MAI_COMBO_SPRITE[state.comboBadge] : "UI_MSS_MBase_Icon_Blank")}
          alt=""
        />
        <img
          className="msc-medal msc-medal-sync"
          src={maiSprite(played && state.syncBadge !== "none" ? MAI_SYNC_SPRITE[state.syncBadge] : "UI_MSS_MBase_Icon_Blank")}
          alt=""
        />

        {/* LONG-version badge, last sibling in the prefab so it tops the tab. */}
        {song.isLong ? (
          <span className="msc-long">
            <img className="msc-long-base" src={maiSprite("UI_CMN_Long_base_big")} alt="" />
            <img className="msc-long-text" src={maiSprite("UI_CMN_Long_text_big")} alt="LONG" />
          </span>
        ) : null}
      </div>
    </div>
  );
}
