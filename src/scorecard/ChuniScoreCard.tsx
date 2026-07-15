import React from "react";
import { FitText } from "./FitText";
import {
  CHUNI_BASE_CROP,
  CHUNI_LEVEL_DIGIT_CROP_BASE,
  CHUNI_MIRROR_CROP,
  CHUNI_OPTION_BAR_CROP,
  CHUNI_PLUS_CROP,
  CHUNI_SONIC_CROP,
  CHUNI_SPEED_DIGIT_CROP_BASE,
  CHUNI_SPEED_DOT_CROP,
  CHUNI_TRACK_DIGIT_CROP_BASE,
  CHUNI_WE_STAR,
  chuniCrop,
} from "./chuniAssets";
import { ChuniScoreState, ChuniSong } from "./chuniTypes";

/**
 * Design space: CHU_UI_Playing_00_v10.srd music-info panel — PAT_base_left's
 * 586x182 box at frame (1334,0). All coordinates are panel-relative CSS px
 * from scripts/scorecard-extract/chuni_musicinfo_tree.json; the static TRS2
 * pose IS the on-screen rest pose (only the Lumina-VERSE root slide/fade and
 * the WE star reveal animate).
 */
export const CHUNI_SCORECARD_WIDTH = 586;
export const CHUNI_SCORECARD_HEIGHT = 182;
/** Export at 3x so text and sprites survive typical chat-app downscaling. */
export const CHUNI_SCORECARD_EXPORT_WIDTH = CHUNI_SCORECARD_WIDTH * 3;

/*
 * CNUM digit-run layout, read from the cast dumps: anchor4b tracks the pivot
 * corner on every cast in the scene (0=top-left at pivot (0,0), 3=mid-left at
 * (0,h/2), 6=bottom-left at (0,h)), so anchor4b=4 with a dead-centre pivot
 * means the digit run centres on the pivot point.
 * - C_music_level_normal_num: box 58x42 at (435,72), pivot (29,21), anchor4b=4
 *   -> run centred on x=464. Digits advance at the native 28px cell width; the
 *   2-digit "13" preview run (56px) sits 1px inside the authored 58px box, so
 *   "13" -> left 436 and a 1-digit "7" -> left 450.
 * - C_track_num: pivot (0,9), anchor4b=3 -> left-anchored at x=238, 14px cells.
 * - NUM_speed: pivot (24,7), anchor4b=4 -> centred on x=198; 12x14 digit cells
 *   plus a 6x8 decimal dot, bottom-aligned with the digit row (atlas rows
 *   41..55 vs 47..55 -> +6px top offset, see .csc-speed-dot).
 */
const LEVEL_CENTER_X = 464;
const LEVEL_CELL_W = 28;
const TRACK_LEFT = 238;
const TRACK_CELL_W = 14;
const SPEED_CENTER_X = 198;
const SPEED_DIGIT_W = 12;
const SPEED_DOT_W = 6;

interface SpeedGlyph {
  src: string;
  width: number;
  className: string;
  left: number;
}

/** "2.0" -> positioned 12x14 digit / 6x8 dot glyphs, run centred on x=198. */
function speedGlyphs(value: string): SpeedGlyph[] {
  const glyphs: Array<Omit<SpeedGlyph, "left">> = [];
  for (const char of value) {
    if (char >= "0" && char <= "9") {
      glyphs.push({
        src: chuniCrop(CHUNI_SPEED_DIGIT_CROP_BASE + Number(char)),
        width: SPEED_DIGIT_W,
        className: "csc-speed-digit",
      });
    } else if (char === ".") {
      glyphs.push({
        src: chuniCrop(CHUNI_SPEED_DOT_CROP),
        width: SPEED_DOT_W,
        className: "csc-speed-dot",
      });
    }
  }
  const runWidth = glyphs.reduce((sum, glyph) => sum + glyph.width, 0);
  let cursor = SPEED_CENTER_X - runWidth / 2;
  return glyphs.map((glyph) => {
    const left = cursor;
    cursor += glyph.width;
    return { ...glyph, left };
  });
}

interface ChuniScoreCardProps {
  song: ChuniSong;
  state: ChuniScoreState;
  /** Overrides the sample song's jacket when set. */
  jacketUrl?: string;
  captureRef?: React.Ref<HTMLDivElement>;
}

export function ChuniScoreCard({ song, state, jacketUrl, captureRef }: ChuniScoreCardProps) {
  // C_level_nomal vs C_level_we are mutually exclusive branches.
  const isWorldsEnd = state.difficulty === "worldsend";
  const levelDigits = state.level.replace(/\D/g, "");
  const levelLeft = LEVEL_CENTER_X - (levelDigits.length * LEVEL_CELL_W) / 2;
  const showPlus = state.level.includes("+");
  const trackDigits = state.track.replace(/\D/g, "");
  const speed = speedGlyphs(state.speed);
  // Gold star patterns 10..19 map 0.5..5 stars in half-star steps.
  const starIndex = Math.min(9, Math.max(0, Math.round(state.weStars * 2) - 1));
  const star = CHUNI_WE_STAR[starIndex];

  return (
    <div className="chuni-scorecard" ref={captureRef}>
      {/* Difficulty-coloured base; "TRACK" + difficulty name baked in. */}
      <img className="csc-base" src={chuniCrop(CHUNI_BASE_CROP[state.difficulty])} alt="" />

      {/* Black option bar (baked スピード設定：｜ミラー設定： labels). */}
      <img className="csc-option-bar" src={chuniCrop(CHUNI_OPTION_BAR_CROP)} alt="" />

      {/* DIS_sonic and NUM_speed share the slot: SONIC when speed is maxed. */}
      {state.sonic ? (
        <img className="csc-sonic csc-option-dim" src={chuniCrop(CHUNI_SONIC_CROP)} alt="SONIC" />
      ) : (
        speed.map((glyph, index) => (
          <img
            key={index}
            className={`${glyph.className} csc-option-dim`}
            style={{ left: glyph.left }}
            src={glyph.src}
            alt=""
          />
        ))
      )}

      <img
        className="csc-mirror csc-option-dim"
        src={chuniCrop(state.mirror ? CHUNI_MIRROR_CROP.on : CHUNI_MIRROR_CROP.off)}
        alt={state.mirror ? "MIRROR ON" : "MIRROR OFF"}
      />

      {/* CIMG stretches the source onto the 116x116 quad (no aspect fit). */}
      <img className="csc-jacket" src={jacketUrl || song.jacketUrl} alt="" decoding="async" />

      <div className="csc-title">
        <FitText maxWidth={340} origin="left">
          {song.title}
        </FitText>
      </div>
      <div className="csc-artist">
        <FitText maxWidth={340} origin="left">
          {song.artist}
        </FitText>
      </div>

      {/* Track number, left-anchored right after the baked "TRACK". */}
      {trackDigits.split("").map((digit, index) => (
        <img
          key={index}
          className="csc-track-digit"
          style={{ left: TRACK_LEFT + index * TRACK_CELL_W }}
          src={chuniCrop(CHUNI_TRACK_DIGIT_CROP_BASE + Number(digit))}
          alt=""
        />
      ))}

      {isWorldsEnd ? (
        <>
          <img
            className="csc-we-star"
            style={{ width: star.width }}
            src={chuniCrop(star.crop)}
            alt=""
          />
          <span className="csc-we-kanji">{state.weKanji.slice(0, 1)}</span>
        </>
      ) : (
        <>
          {levelDigits.split("").map((digit, index) => (
            <img
              key={index}
              className="csc-lv-digit"
              style={{ left: levelLeft + index * LEVEL_CELL_W }}
              src={chuniCrop(CHUNI_LEVEL_DIGIT_CROP_BASE + Number(digit))}
              alt=""
            />
          ))}
          {showPlus ? <img className="csc-plus" src={chuniCrop(CHUNI_PLUS_CROP)} alt="+" /> : null}
        </>
      )}
    </div>
  );
}
