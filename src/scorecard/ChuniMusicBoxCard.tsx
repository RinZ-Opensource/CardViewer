import { ScorecardBitmapText } from "./ScorecardBitmapText";
import {
  CHUNI_BOX_BPM_DIGIT_WIDTH,
  CHUNI_BOX_COMBO_CROP,
  CHUNI_BOX_DECIDE_FRAME,
  CHUNI_BOX_FCHAIN_CROP,
  CHUNI_BOX_LEVEL_BASE_CROP,
  CHUNI_BOX_LEVEL_DIGIT_CROP_BASE,
  CHUNI_BOX_LEVEL_PLUS_CROP,
  CHUNI_BOX_NOTES_LABEL_CROP,
  CHUNI_BOX_RANK_CROP,
  CHUNI_BOX_SCORE_COMMA_CROP,
  CHUNI_BOX_SCORE_DIGIT_CROP,
  CHUNI_BOX_START_BANNER,
  CHUNI_BOX_SUCCESS_CROP,
  CHUNI_BOX_WE_STAR,
  chuniBakedSprite,
  chuniBatchCrop,
  chuniBoxBase,
  chuniBoxBpmDigit,
  chuniBoxCrop,
  chuniRankPattern,
} from "./chuniAssets";
import { ChuniScoreState, ChuniSong } from "./chuniTypes";
import { jacketImgProps } from "./songdb";

/**
 * Design space: CHU_UI_Select_00_v10.srd :: CHU_UI_Select_musicbox_00, the
 * 454x610 decide frame (C_start_head/C_base); the neutral 438x584 card base
 * sits at (8,13). All coordinates are frame-relative CSS px from the external
 * CHUNITHM MusicBox reference dump.
 */
export const CHUNI_MUSICBOX_WIDTH = 454;
export const CHUNI_MUSICBOX_HEIGHT = 610;

/*
 * C_score_num (CNUM): digit cell 16x20 with kerning -2 -> 14px advance; comma
 * cell 8x20 -> 6px advance; thousands grouping, max 7 digits. "1,010,000"
 * spans 7*14+2*6 = 110px = exactly the cast box (322,534)-(432,554). Sub-7-
 * digit alignment is not literal in the SRD; the report recommends right-
 * aligning to x=432 (identical for the designed 7-digit case).
 */
const SCORE_RIGHT_X = 432;
const SCORE_TOP = 534;
const SCORE_DIGIT_W = 16;
const SCORE_DIGIT_ADVANCE = 14;
const SCORE_COMMA_W = 8;
const SCORE_COMMA_ADVANCE = 6;

/*
 * C_level_num (CNUM): 40x52 cells centred at (68,400), max 2 digits. Digit ink
 * is ~26px inside the 40px cell, so a literal 40px pitch overflows the 58px
 * box; the dump carries no runtime kerning, so we centre the sprites at the
 * report-recommended ~29px pitch (fallback, not literal data).
 */
const LEVEL_CENTER_X = 68;
const LEVEL_DIGIT_W = 40;
const LEVEL_PITCH = 29;

/** C_bpm_num: 12x14 cells on a 12px pitch, centred on (410,573); top in CSS. */
const BPM_CENTER_X = 410;
const BPM_PITCH = 12;

interface ScoreGlyph {
  src: string;
  left: number;
  width: number;
}

/** Format digits with thousands separators and lay them out right-anchored. */
function scoreGlyphs(score: number): ScoreGlyph[] {
  const text = Math.min(9999999, Math.max(0, score)).toLocaleString("en-US");
  const glyphs: Array<{ src: string; width: number; advance: number }> = [];
  for (const char of text) {
    if (char === ",") {
      glyphs.push({
        src: chuniBoxCrop(CHUNI_BOX_SCORE_COMMA_CROP),
        width: SCORE_COMMA_W,
        advance: SCORE_COMMA_ADVANCE,
      });
    } else {
      glyphs.push({
        src: chuniBoxCrop(CHUNI_BOX_SCORE_DIGIT_CROP[Number(char)]),
        width: SCORE_DIGIT_W,
        advance: SCORE_DIGIT_ADVANCE,
      });
    }
  }
  const total = glyphs.reduce((sum, glyph) => sum + glyph.advance, 0);
  let cursor = SCORE_RIGHT_X - total;
  return glyphs.map((glyph) => {
    const left = cursor;
    cursor += glyph.advance;
    return { src: glyph.src, left, width: glyph.width };
  });
}

interface ChuniMusicBoxCardProps {
  song: ChuniSong;
  state: ChuniScoreState;
  /** Overrides the sample song's jacket when set. */
  jacketUrl?: string;
}

export function ChuniMusicBoxCard({ song, state, jacketUrl }: ChuniMusicBoxCardProps) {
  const isWorldsEnd = state.difficulty === "worldsend";

  const levelDigits = state.level.replace(/\D/g, "").slice(0, 2) || "0";
  const showPlus = state.level.includes("+");
  const levelRun = LEVEL_DIGIT_W + (levelDigits.length - 1) * LEVEL_PITCH;
  const levelLeft = LEVEL_CENTER_X - levelRun / 2;

  // Gold star patterns (10..19 in the cast) = 0.5..5 stars in half-star steps.
  const starIndex = Math.min(9, Math.max(0, Math.round(state.weStars * 2) - 1));
  const star = CHUNI_BOX_WE_STAR[starIndex];

  // "" = unplayed: rank + lamps drop to their blank patterns, score shows 0.
  const played = state.bestScore.trim() !== "";
  const score = played ? Number.parseInt(state.bestScore.replace(/\D/g, ""), 10) || 0 : 0;
  const glyphs = scoreGlyphs(score);
  const rankCrop = CHUNI_BOX_RANK_CROP[played ? chuniRankPattern(score) : 0];
  const successCrop = CHUNI_BOX_SUCCESS_CROP[played ? state.successLamp : "none"];
  const comboCrop = CHUNI_BOX_COMBO_CROP[played ? state.comboLamp : "none"];
  const fchainLamp = played ? state.fullChainLamp : "none";

  const bpmDigits = state.bpm.replace(/\D/g, "").slice(0, 4);
  const bpmLeft = BPM_CENTER_X - (bpmDigits.length * BPM_PITCH) / 2;

  return (
    <div className="chuni-musicbox-card">
      {/* Difficulty-coloured card base; SCORE:/BPM: labels baked in. */}
      <img className="cmb-base" src={chuniBoxBase(state.difficulty)} alt="" />

      {/* CIMG stretches the source onto the 300x300 quad (no aspect fit). */}
      <img
        className="cmb-jacket"
        {...jacketImgProps(jacketUrl || song.jacketUrl, song.jacketFallbacks)}
        alt=""
        decoding="async"
      />

      <ScorecardBitmapText
        className="cmb-title"
        text={song.title}
        fontKey="kaku40"
        fontSize={28.8}
        width={400}
        height={48}
        alignment={4}
        color="#323228"
      />
      <ScorecardBitmapText
        className="cmb-artist"
        text={song.artist}
        fontKey="kaku16"
        fontSize={14.4}
        width={400}
        height={16}
        alignment={1}
        color="#5a5a50"
      />

      {/* C_level_default and C_level_WE both exist in data; code shows one. */}
      {isWorldsEnd ? (
        <>
          <img
            className="cmb-level-base"
            src={chuniBoxCrop(CHUNI_BOX_LEVEL_BASE_CROP.we)}
            alt=""
          />
          <img
            className="cmb-we-star"
            style={{ width: star.width }}
            src={chuniBoxCrop(star.crop)}
            alt=""
          />
          <ScorecardBitmapText
            className="cmb-we-kanji"
            text={state.weKanji.slice(0, 1)}
            fontKey="kaku40"
            fontSize={48}
            width={54.4}
            height={54.4}
            alignment={4}
            color="#ffffff"
          />
        </>
      ) : (
        <>
          <img
            className="cmb-level-base"
            src={chuniBoxCrop(CHUNI_BOX_LEVEL_BASE_CROP.normal)}
            alt=""
          />
          {levelDigits.split("").map((digit, index) => (
            <img
              key={index}
              className="cmb-level-digit"
              style={{ left: levelLeft + index * LEVEL_PITCH }}
              src={chuniBoxCrop(CHUNI_BOX_LEVEL_DIGIT_CROP_BASE + Number(digit))}
              alt=""
            />
          ))}
          {showPlus ? (
            <img
              className="cmb-level-plus"
              src={chuniBoxCrop(CHUNI_BOX_LEVEL_PLUS_CROP)}
              alt="+"
            />
          ) : null}
        </>
      )}

      {/* Badge rows (134x26). Blank = faint empty plate crop28; the fchain
          blank pattern is fully transparent, so it renders nothing. */}
      <img className="cmb-badge cmb-badge-success" src={chuniBatchCrop(successCrop)} alt="" />
      <img className="cmb-badge cmb-badge-rank" src={chuniBatchCrop(rankCrop)} alt="" />
      <img className="cmb-badge cmb-badge-combo" src={chuniBatchCrop(comboCrop)} alt="" />
      {fchainLamp !== "none" ? (
        <img
          className="cmb-badge cmb-badge-fchain"
          src={chuniBatchCrop(CHUNI_BOX_FCHAIN_CROP[fchainLamp])}
          alt=""
        />
      ) : null}

      {/* BEST SCORE digits, right-anchored to the cast box's right edge. */}
      {glyphs.map((glyph, index) => (
        <img
          key={index}
          className="cmb-score-glyph"
          style={{ left: glyph.left, width: glyph.width, top: SCORE_TOP }}
          src={glyph.src}
          alt=""
        />
      ))}

      {/* BPM digits (pre-baked #313C4E tint), centred on x=410. */}
      {bpmDigits.split("").map((digit, index) => (
        <img
          key={index}
          className="cmb-bpm-digit"
          style={{
            left: bpmLeft + index * BPM_PITCH,
            width: CHUNI_BOX_BPM_DIGIT_WIDTH[Number(digit)],
          }}
          src={chuniBoxBpmDigit(Number(digit))}
          alt=""
        />
      ))}

      <img className="cmb-notes-label" src={chuniBoxCrop(CHUNI_BOX_NOTES_LABEL_CROP)} alt="" />
      <ScorecardBitmapText
        className="cmb-notes-name"
        text={state.notesDesigner}
        fontKey="kaku16"
        fontSize={14}
        width={200}
        height={20}
        alignment={3}
        color="#313c4e"
        lineSpacing={16 / 14}
      />

      {/* Confirm state (A_start_in): decide frame + start banner fade in over
          the card; nothing else moves. */}
      {state.confirmed ? (
        <>
          <img
            className="cmb-decide-frame"
            src={chuniBakedSprite(CHUNI_BOX_DECIDE_FRAME)}
            alt=""
          />
          <img
            className="cmb-start-banner"
            src={CHUNI_BOX_START_BANNER[state.startBanner]}
            alt=""
          />
        </>
      ) : null}
    </div>
  );
}
