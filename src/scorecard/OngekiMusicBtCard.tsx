import React from "react";
import { FitText } from "./FitText";
import {
  ONGEKI_BT_ATTRIBUTE_SPRITE,
  ONGEKI_BT_BADGE_NATIVE,
  ONGEKI_BT_BATTLE_RANK_SPRITE,
  ONGEKI_BT_CHARA_GAUGE,
  ONGEKI_BT_CHARA_LV_BASE,
  ONGEKI_BT_CHARA_LV_HEADER,
  ONGEKI_BT_DEFAULT_BOSS_ICON,
  ONGEKI_BT_FB_SPRITE,
  ONGEKI_BT_FC_AB_SPRITE,
  ONGEKI_BT_PERCENT_SPRITE,
  ONGEKI_BT_PLATE_SPRITE,
  ONGEKI_BT_PSCORE_BASE,
  ONGEKI_BT_RIGHTS_BASE,
  ONGEKI_BT_RIGHTS_DUMMY,
  ONGEKI_BT_TECH_RANK_SPRITE,
  ONGEKI_BT_VS_SPRITE,
  ongekiGlyph,
  ongekiPlatinumStar,
  ongekiPlatinumStarRank,
  ongekiSprite,
  ongekiTechRankPattern,
} from "./ongekiAssets";
import { OngekiScoreState, OngekiSong } from "./ongekiTypes";
import { jacketImgProps } from "./songdb";

/**
 * Design space: ANM_SWH_MusicBt.prefab — the 278x458 PAT_DF_base plate.
 * Coordinates below are plate-relative CSS px from
 * scripts/scorecard-extract/ongeki_musicbt_tree.json. The capture root is
 * padded (16 left/right/bottom for the Lunatic plate's 310x490 glow, 22 top
 * for the boss VS block that overhangs the plate), so the plate sits at
 * (PAD_X, PAD_TOP) inside a 310x496 root.
 */
const PAD_X = 16;
const PAD_TOP = 22;
export const ONGEKI_MUSICBT_WIDTH = 278 + 2 * PAD_X;
export const ONGEKI_MUSICBT_HEIGHT = 458 + PAD_TOP + 16;
/** Export at 3x so text and sprites survive typical chat-app downscaling. */
export const ONGEKI_MUSICBT_EXPORT_WIDTH = ONGEKI_MUSICBT_WIDTH * 3;

/*
 * MU3UICounter glyph layout (CustomUI/MU3UICounter.cs OnPopulateMesh): a
 * digit quad is size_ wide and advances size_.x + charSpacing_; a comma is
 * drawn signSize_ wide, shifted cammaSidePadding_ from the cursor, advancing
 * signSize_.x + charSpacing_ + 2*cammaSidePadding_ (and lifted cammaYOffset_).
 * The decimal dot renders at signSize_ with dotSidePadding_ per side; decimal
 * digits render at decimalScale_ x size_ with decimalCharSpacing_, bottom-
 * aligned with the integer digits. calcTotalSize adds no spacing after the
 * last glyph; align=Right puts the run's right edge at the node pivot (= the
 * node rect's centre), align=Center centres it there.
 */
interface CounterOpts {
  sheet: string;
  digitW: number;
  digitH: number;
  spacing: number;
  /** signSize + cammaSidePadding/cammaYOffset; omit to render without commas. */
  comma?: { w: number; h: number; pad: number; yOff: number };
  scale: number;
  align: "left" | "right" | "center";
  anchorX: number;
  centerY: number;
}

interface Glyph {
  src: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface RawGlyph {
  src: string;
  offset: number;
  advance: number;
  width: number;
  height: number;
  dy: number;
}

function layout(raw: RawGlyph[], opts: CounterOpts): Glyph[] {
  const scale = opts.scale;
  let cursor = 0;
  const placed = raw.map((glyph) => {
    const left = cursor + glyph.offset * scale;
    cursor += glyph.advance * scale;
    return { ...glyph, left };
  });
  const last = placed[placed.length - 1];
  const total = last ? last.left + last.width * scale : 0;
  const start =
    opts.align === "left"
      ? opts.anchorX
      : opts.align === "right"
        ? opts.anchorX - total
        : opts.anchorX - total / 2;
  return placed.map((glyph) => ({
    src: glyph.src,
    left: start + glyph.left,
    top: opts.centerY - (glyph.height * scale) / 2 + glyph.dy * scale,
    width: glyph.width * scale,
    height: glyph.height * scale,
  }));
}

/** Integer counter: digits + optional thousands commas. */
function intCounterGlyphs(value: number, opts: CounterOpts): Glyph[] {
  const text = opts.comma
    ? Math.max(0, Math.trunc(value)).toLocaleString("en-US")
    : String(Math.max(0, Math.trunc(value)));
  const raw: RawGlyph[] = [];
  for (const char of text) {
    if (char === "," && opts.comma) {
      raw.push({
        src: ongekiGlyph(opts.sheet, "comma"),
        offset: opts.comma.pad,
        advance: opts.comma.w + opts.spacing + 2 * opts.comma.pad,
        width: opts.comma.w,
        height: opts.comma.h,
        dy: -opts.comma.yOff,
      });
    } else if (char >= "0" && char <= "9") {
      raw.push({
        src: ongekiGlyph(opts.sheet, char),
        offset: 0,
        advance: opts.digitW + opts.spacing,
        width: opts.digitW,
        height: opts.digitH,
        dy: 0,
      });
    }
  }
  return layout(raw, opts);
}

/*
 * NUM_OverDamage: UI_NUM_36pt_01 at size_ 18x19, spacing -8.2, comma/dot at
 * signSize 20x21.5 (comma pad -4/yOff -0.15, dot pad -3.19/yOff -0.78), two
 * DecimalZeroPadding decimals at 0.9 scale with spacing -7.32, bottom-aligned
 * with the integer digits.
 */
function overDamageGlyphs(value: number, opts: CounterOpts): Glyph[] {
  const clamped = Math.max(0, value);
  const intText = Math.trunc(clamped).toLocaleString("en-US");
  const decimals = Math.round((clamped % 1) * 100);
  const decText = String(Math.min(99, decimals)).padStart(2, "0");
  const raw: RawGlyph[] = [];
  for (const char of intText) {
    if (char === ",") {
      raw.push({
        src: ongekiGlyph(opts.sheet, "comma"),
        offset: -4,
        advance: 20 + opts.spacing + 2 * -4,
        width: 20,
        height: 21.5,
        dy: 0.15,
      });
    } else {
      raw.push({
        src: ongekiGlyph(opts.sheet, char),
        offset: 0,
        advance: opts.digitW + opts.spacing,
        width: opts.digitW,
        height: opts.digitH,
        dy: 0,
      });
    }
  }
  const decScale = 0.9;
  const decSpacing = -7.32;
  const decW = opts.digitW * decScale;
  const decH = opts.digitH * decScale;
  // Bottom-align decimals with the integer digit row.
  const decDy = (opts.digitH - decH) / 2;
  raw.push({
    src: ongekiGlyph(opts.sheet, "dot"),
    offset: -3.19,
    advance: 20 + decSpacing + 2 * -3.19,
    width: 20,
    height: 21.5,
    dy: 0.39,
  });
  for (const char of decText) {
    raw.push({
      src: ongekiGlyph(opts.sheet, char),
      offset: 0,
      advance: decW + decSpacing,
      width: decW,
      height: decH,
      dy: decDy,
    });
  }
  return layout(raw, opts);
}

const SCORE_COMMA = { w: 20, h: 21.5, pad: -4, yOff: 0.29 };

/** NUM_BattleScore / NUM_TechnicalScore: right edges 135 / 265.1, centre-y 383. */
const BATTLE_SCORE_OPTS: CounterOpts = {
  sheet: "UI_NUM_24pt_00",
  digitW: 18,
  digitH: 19,
  spacing: -8.2,
  comma: SCORE_COMMA,
  scale: 1,
  align: "right",
  anchorX: 135,
  centerY: 383,
};
const TECH_SCORE_OPTS: CounterOpts = { ...BATTLE_SCORE_OPTS, anchorX: 265.1 };

/** NUM_OverDamage: right edge at the node centre x=77.5, centre-y 423.4. */
const OVER_DAMAGE_OPTS: CounterOpts = {
  sheet: "UI_NUM_36pt_01",
  digitW: 18,
  digitH: 19,
  spacing: -8.2,
  scale: 1,
  align: "right",
  anchorX: 77.5,
  centerY: 423.4,
};

/** NUM_BPM: align Left from x=246, node scale 0.64, centre-y 447. */
const BPM_OPTS: CounterOpts = {
  sheet: "UI_NUM_18pt_00",
  digitW: 20,
  digitH: 21.5,
  spacing: -8.9,
  scale: 0.64,
  align: "left",
  anchorX: 246,
  centerY: 447,
};

/** NUM_MusicLevel: 52x56 cells, spacing -28, centred on (43.2, 51.3). */
const LEVEL_OPTS: CounterOpts = {
  sheet: "UI_NUM_50pt_01_MusicLevel",
  digitW: 52,
  digitH: 56,
  spacing: -28,
  scale: 1,
  align: "center",
  anchorX: 43.2,
  centerY: 51.3,
};

/** NUM_PScore (scale 0.9) / NUM_PScore_MAX (scale 0.7), centres at y=334. */
const PSCORE_OPTS: CounterOpts = {
  ...BATTLE_SCORE_OPTS,
  scale: 0.9,
  align: "center",
  anchorX: 192.5,
  centerY: 334,
};
const PSCORE_MAX_OPTS: CounterOpts = { ...PSCORE_OPTS, scale: 0.7, anchorX: 244.5 };

/** NUM_CharaLv: 22.5x24 cells, spacing -9, node scale 0.8, centre (248.2, 69.6). */
const CHARA_LV_OPTS: CounterOpts = {
  sheet: "UI_NUM_13pt_Charalevel_00",
  digitW: 22.5,
  digitH: 24,
  spacing: -9,
  scale: 0.8,
  align: "center",
  anchorX: 248.2,
  centerY: 69.6,
};

/**
 * UI_SLC_MusicSelect_CharaAttribute_Mask approximated as a clip-path polygon
 * (alpha bbox y 28..216 of 256, top edge x 44..208 at y=28 widening to full
 * width by y~104). clip-path needs no external resource, so it survives the
 * html-to-image PNG export where mask-image urls do not.
 */
const BOSS_ICON_CLIP =
  "polygon(17.2% 10.9%, 81.3% 10.9%, 100% 40.6%, 100% 84.4%, 0% 84.4%, 0% 40.6%)";

function parseIntValue(text: string): number {
  return Number.parseInt(text.replace(/\D/g, ""), 10) || 0;
}

function glyphImgs(glyphs: Glyph[], className: string) {
  return glyphs.map((glyph, index) => (
    <img
      key={index}
      className={className}
      style={{ left: glyph.left, top: glyph.top, width: glyph.width, height: glyph.height }}
      src={glyph.src}
      alt=""
    />
  ));
}

/** Badge art is setNativeSize'd, centred in its 60x60 box (centres y=417). */
function badgeImg(sprite: string, centerX: number) {
  const size = ONGEKI_BT_BADGE_NATIVE[sprite] ?? 60;
  return (
    <img
      className="omb-badge"
      style={{ left: centerX - size / 2, top: 417 - size / 2, width: size, height: size }}
      src={ongekiSprite(sprite)}
      alt=""
    />
  );
}

interface OngekiMusicBtCardProps {
  song: OngekiSong;
  state: OngekiScoreState;
  /** Overrides the sample song's jacket when set. */
  jacketUrl?: string;
  /** Boss card icon (runtime CardIcon); defaults to the dummy jacket art. */
  bossIconUrl?: string;
  /** Ordered fallbacks for a mapped boss CardIcon. */
  bossIconFallbacks?: string[];
  /**
   * MusicRights strip (focused songs with musicRightsId != 0 only). It hangs
   * off the card's right edge per the prefab, so the PNG export clips it.
   */
  showRights?: boolean;
  captureRef?: React.Ref<HTMLDivElement>;
}

export function OngekiMusicBtCard({
  song,
  state,
  jacketUrl,
  bossIconUrl,
  bossIconFallbacks,
  showRights,
  captureRef,
}: OngekiMusicBtCardProps) {
  // MusicDataObject: level counter = trunc(fumenConst); '+' = isFumenConstPlus.
  const levelInt = Number.parseInt(state.level, 10);
  const levelValue = Number.isFinite(levelInt) ? Math.max(0, levelInt) : 0;
  const isFumenConstPlus = state.level.includes("+");
  const levelGlyphs = intCounterGlyphs(levelValue, LEVEL_OPTS);
  // Footer '+': centre = run right edge + w/2 + rightOffset(-14) -> left-14.
  const levelRun = levelGlyphs[levelGlyphs.length - 1];
  const levelRight = levelRun ? levelRun.left + levelRun.width : LEVEL_OPTS.anchorX;

  // Unplayed ("" score): counters show 0 and the tech rank badge is hidden
  // (MusicResultObject hides rank None); battle/FB/FC lamps stay manual.
  const techPlayed = state.techScore.trim() !== "";
  const techScore = techPlayed ? parseIntValue(state.techScore) : 0;
  const battleScore = state.battleScore.trim() !== "" ? parseIntValue(state.battleScore) : 0;
  const overDamage =
    state.overDamage.trim() !== "" ? Number.parseFloat(state.overDamage) || 0 : 0;
  const pScore = state.platinumScore.trim() !== "" ? parseIntValue(state.platinumScore) : 0;
  const pScoreMax = parseIntValue(state.platinumScoreMax);
  const starRank = ongekiPlatinumStarRank(pScore, pScoreMax);

  const lunatic = state.difficulty === "lunatic";

  return (
    <div className="ongeki-musicbt-card" ref={captureRef}>
      <div className="omb-plate-space">
        {/* PAT_DF_base: setNativeSize; the 310x490 Lunatic art overhangs. */}
        <img
          className={`omb-plate ${lunatic ? "lunatic" : ""}`}
          src={ongekiSprite(ONGEKI_BT_PLATE_SPRITE[state.difficulty])}
          alt=""
        />

        {/* DMY_jacket: 220x220, Image type Simple (stretched, no aspect fit). */}
        <img
          className="omb-jacket"
          {...jacketImgProps(jacketUrl || song.jacketUrl, song.jacketFallbacks)}
          alt=""
          decoding="async"
        />

        {/* MU3Text marquees in-game; statically compressed via FitText. */}
        <div className="omb-title">
          <FitText maxWidth={260}>{song.title}</FitText>
        </div>
        <div className="omb-artist">
          <FitText maxWidth={260}>{song.artist}</FitText>
        </div>

        {glyphImgs(levelGlyphs, "omb-glyph omb-ink-level")}
        {isFumenConstPlus ? (
          <img
            className="omb-level-plus"
            style={{ left: levelRight - 14 }}
            src={ongekiSprite("UI_NUM_50pt_01_plus")}
            alt="+"
          />
        ) : null}

        {/* Boss/VS block (overhangs the plate top into the root padding). */}
        <img className="omb-boss-gauge" src={ongekiSprite(ONGEKI_BT_CHARA_GAUGE)} alt="" />
        <img className="omb-boss-lv-base" src={ongekiSprite(ONGEKI_BT_CHARA_LV_BASE)} alt="" />
        <img
          className="omb-boss-attr"
          src={ongekiSprite(ONGEKI_BT_ATTRIBUTE_SPRITE[state.bossAttribute])}
          alt=""
        />
        <img
          className="omb-boss-icon"
          style={{ clipPath: BOSS_ICON_CLIP }}
          {...jacketImgProps(
            bossIconUrl || ongekiSprite(ONGEKI_BT_DEFAULT_BOSS_ICON),
            bossIconUrl
              ? [
                  ...(bossIconFallbacks ?? []),
                  ongekiSprite(ONGEKI_BT_DEFAULT_BOSS_ICON),
                ]
              : undefined,
          )}
          alt=""
          decoding="async"
        />
        {glyphImgs(
          intCounterGlyphs(parseIntValue(state.bossLevel), CHARA_LV_OPTS),
          "omb-glyph",
        )}
        <img className="omb-boss-lv-header" src={ongekiSprite(ONGEKI_BT_CHARA_LV_HEADER)} alt="" />
        <img className="omb-boss-vs" src={ongekiSprite(ONGEKI_BT_VS_SPRITE)} alt="" />

        {/* Platinum score block. */}
        <img className="omb-pscore-base" src={ongekiSprite(ONGEKI_BT_PSCORE_BASE)} alt="" />
        {glyphImgs(intCounterGlyphs(pScore, PSCORE_OPTS), "omb-glyph omb-ink-pscore")}
        <div className="omb-pscore-slash" />
        {glyphImgs(
          intCounterGlyphs(pScoreMax, PSCORE_MAX_OPTS),
          "omb-glyph omb-ink-pscore omb-pscore-max",
        )}
        {starRank > 0 ? (
          <img className="omb-pstar" src={ongekiPlatinumStar(starRank)} alt="" />
        ) : null}

        {/* Score counters. */}
        {glyphImgs(intCounterGlyphs(battleScore, BATTLE_SCORE_OPTS), "omb-glyph omb-ink-score")}
        {glyphImgs(intCounterGlyphs(techScore, TECH_SCORE_OPTS), "omb-glyph omb-ink-score")}
        {glyphImgs(overDamageGlyphs(overDamage, OVER_DAMAGE_OPTS), "omb-glyph omb-ink-score")}
        <img
          className="omb-percent omb-ink-score"
          src={ongekiSprite(ONGEKI_BT_PERCENT_SPRITE)}
          alt="%"
        />

        {/* Badge row (centres y=417): battle rank, tech rank, FB, FC/AB. */}
        {state.battleRank !== "none"
          ? badgeImg(ONGEKI_BT_BATTLE_RANK_SPRITE[state.battleRank], 114.4)
          : null}
        {techPlayed ? badgeImg(ONGEKI_BT_TECH_RANK_SPRITE[ongekiTechRankPattern(techScore)], 166.3) : null}
        {state.fullBell ? badgeImg(ONGEKI_BT_FB_SPRITE, 207.5) : null}
        {state.fcLamp !== "none" ? badgeImg(ONGEKI_BT_FC_AB_SPRITE[state.fcLamp], 250.7) : null}

        {/* BPM (white glyphs, node scale 0.64). */}
        {glyphImgs(intCounterGlyphs(parseIntValue(state.bpm), BPM_OPTS), "omb-glyph")}

        <div className="omb-notes">
          <FitText maxWidth={126} origin="left">
            {state.notesDesigner}
          </FitText>
        </div>

        {showRights ? (
          <>
            <img className="omb-rights-base" src={ongekiSprite(ONGEKI_BT_RIGHTS_BASE)} alt="" />
            <img className="omb-rights-text" src={ongekiSprite(ONGEKI_BT_RIGHTS_DUMMY)} alt="" />
          </>
        ) : null}
      </div>
    </div>
  );
}
