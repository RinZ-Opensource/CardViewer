import {
  ChuniComboLamp,
  ChuniDifficulty,
  ChuniFullChainLamp,
  ChuniStartBanner,
  ChuniSuccessLamp,
} from "./chuniTypes";
import { scorecardStaticPng } from "./scorecardAssetUrl";

/** Atlas the whole panel is cut from; PNGs are named <texture>_<cropIndex>.png. */
const CHUNI_SHEET = "CHU_UI_playing_00_v11";

export function chuniCrop(cropIndex: number) {
  return scorecardStaticPng("chuni", `${CHUNI_SHEET}_${cropIndex}`);
}

/** 300x300 dummy jacket the scene ships with (real jackets not extracted yet). */
export const CHUNI_DUMMY_JACKET = scorecardStaticPng("chuni", "CHU_UI_Jacket_dummy_0");

export const CHUNI_DIFFICULTY_ORDER: ChuniDifficulty[] = [
  "basic",
  "advanced",
  "expert",
  "master",
  "ultima",
  "worldsend",
  "tutorial",
];

export const CHUNI_DIFFICULTY_LABEL: Record<ChuniDifficulty, string> = {
  basic: "BASIC",
  advanced: "ADVANCED",
  expert: "EXPERT",
  master: "MASTER",
  ultima: "ULTIMA",
  worldsend: "WORLD'S END",
  tutorial: "TUTORIAL",
};

/**
 * PAT_base_left pattern index -> crop (586x182 base with "TRACK" + difficulty
 * name baked in). Pattern order 0..6 = BASIC green, ADVANCED orange, EXPERT
 * red, MASTER purple, ULTIMA black/red, WORLD'S END rainbow, TUTORIAL gold.
 */
export const CHUNI_BASE_CROP: Record<ChuniDifficulty, number> = {
  basic: 0,
  advanced: 1,
  expert: 2,
  master: 3,
  ultima: 89,
  worldsend: 4,
  tutorial: 5,
};

/** C_judge_base_01: black option bar with baked スピード設定/ミラー設定 labels. */
export const CHUNI_OPTION_BAR_CROP = 6;

/** DIS_sonic: white "SONIC" label, shown instead of the speed number. */
export const CHUNI_SONIC_CROP = 23;

/** PAT_mirror: pattern0=OFF crop25 (default), pattern1=ON crop24 (pixel-verified). */
export const CHUNI_MIRROR_CROP = { on: 24, off: 25 };

/** NUM_speed digits 0..9 = crops 12..21 (12x14 cells); crop22 = 6x8 decimal dot. */
export const CHUNI_SPEED_DIGIT_CROP_BASE = 12;
export const CHUNI_SPEED_DOT_CROP = 22;

/** C_music_level_normal_num digits 0..9 = crops 78..87 (28x42 cells). */
export const CHUNI_LEVEL_DIGIT_CROP_BASE = 78;

/** C_plus: 18x18 "+" mark for X+ levels. */
export const CHUNI_PLUS_CROP = 88;

/** C_track_num digits 0..9 = crops 68..77 (14x18 cells). */
export const CHUNI_TRACK_DIGIT_CROP_BASE = 68;

/**
 * WORLD'S END star strip, gold patterns 10..19 = 0.5..5 stars in half-star
 * steps (hollow 0..9 unused here). Sprite-list order and widths straight from
 * the C_..._WE_level crop rects in chuni_musicinfo_tree.json — note the crop
 * indices are NOT monotonic (…67, 61) and widths are the exact rect widths.
 */
export const CHUNI_WE_STAR: Array<{ crop: number; width: number }> = [
  { crop: 58, width: 8 },
  { crop: 59, width: 14 },
  { crop: 60, width: 21 },
  { crop: 62, width: 28 },
  { crop: 63, width: 35 },
  { crop: 64, width: 42 },
  { crop: 65, width: 49 },
  { crop: 66, width: 55 },
  { crop: 67, width: 62 },
  { crop: 61, width: 70 },
];

/* ---------------------------------------------------------------------------
 * Music-select music box (CHU_UI_Select_00_v10.srd :: CHU_UI_Select_musicbox_00)
 * All maps below come from manifest_musicbox.json / chuni_musicbox_tree.*;
 * every pattern label is pixel-verified there.
 * ------------------------------------------------------------------------- */

/** Generic <texture>_<cropIndex>.png resolver for the music-box sheets. */
export function chuniSelectSprite(texture: string, cropIndex: number) {
  return scorecardStaticPng("chuni", `${texture}_${cropIndex}`);
}

/** Static 9-slice assets pre-baked by the external asset producer. */
export function chuniBakedSprite(name: string) {
  return scorecardStaticPng("chuni", name);
}

const BOX_SHEET = "CHU_UI_Select_musicbox_00";
const BATCH_SHEET = "CHU_UI_Common_batch_00";
const SELECT_BOX_SHEET = "CHU_UI_Common_select_box_00";

export function chuniBoxCrop(cropIndex: number) {
  return chuniSelectSprite(BOX_SHEET, cropIndex);
}

export function chuniBatchCrop(cropIndex: number) {
  return chuniSelectSprite(BATCH_SHEET, cropIndex);
}

/** Music-box difficulties (C_music_box_base_00 has no TUTORIAL pattern). */
export const CHUNI_BOX_DIFFICULTY_ORDER: ChuniDifficulty[] = [
  "basic",
  "advanced",
  "expert",
  "master",
  "ultima",
  "worldsend",
];

/**
 * C_music_box_base_00 patterns 0..5 = BASIC..WORLD'S END (438x584, "SCORE:"/
 * "BPM:" labels baked in). TUTORIAL has no music-box art; fall back to the
 * scene's default pattern (3 = MASTER).
 */
export const CHUNI_BOX_BASE_CROP: Record<ChuniDifficulty, number> = {
  basic: 0,
  advanced: 1,
  expert: 2,
  master: 3,
  ultima: 4,
  worldsend: 5,
  tutorial: 3,
};

export function chuniBoxBase(difficulty: ChuniDifficulty) {
  return chuniSelectSprite(SELECT_BOX_SHEET, CHUNI_BOX_BASE_CROP[difficulty]);
}

/** C_level_base: navy LEVEL box (normal) / cream box (WORLD'S END), 80x88. */
export const CHUNI_BOX_LEVEL_BASE_CROP = { normal: 5, we: 6 };

/** C_level_num digits 0..9 = crops 9..18 (40x52 cells). */
export const CHUNI_BOX_LEVEL_DIGIT_CROP_BASE = 9;

/** C_level_plus: 26x28 '+' at a fixed spot (not appended after the digits). */
export const CHUNI_BOX_LEVEL_PLUS_CROP = 19;

/**
 * C_score_num patterns: digits 0..9 (16x20 cells) + comma (8x20). Crop indices
 * are NOT contiguous (digit 0 = crop30, 1.. = 32..40, comma = 41).
 */
export const CHUNI_BOX_SCORE_DIGIT_CROP = [30, 32, 33, 34, 35, 36, 37, 38, 39, 40];
export const CHUNI_BOX_SCORE_COMMA_CROP = 41;

/**
 * C_bpm_num digits: white ink tinted by vertex color #313C4E in-game, so we
 * ship pre-baked tinted copies because CSS filters cannot multiply an exact
 * non-gray color. Digit 3's crop is 11px wide, the rest 12 (12px pitch).
 */
export function chuniBoxBpmDigit(digit: number) {
  return chuniBakedSprite(`baked_musicbox_bpm_${digit}`);
}
export const CHUNI_BOX_BPM_DIGIT_WIDTH = [12, 12, 12, 11, 12, 12, 12, 12, 12, 12];

/**
 * C_level_star gold patterns 10..19 = 0.5..5 stars in half-star steps (the
 * static confirmed pose; dark row 0..9 is only the fill-up animation).
 */
export const CHUNI_BOX_WE_STAR: Array<{ crop: number; width: number }> = [
  { crop: 57, width: 8 },
  { crop: 58, width: 14 },
  { crop: 59, width: 21 },
  { crop: 61, width: 28 },
  { crop: 62, width: 35 },
  { crop: 63, width: 42 },
  { crop: 64, width: 49 },
  { crop: 65, width: 55 },
  { crop: 66, width: 62 },
  { crop: 60, width: 70 },
];

/** C_notesdesigner_txt pat0: "NOTES DESIGNER:" label strip (148x24, navy ink). */
export const CHUNI_BOX_NOTES_LABEL_CROP = 31;

/**
 * Badge rows, CHU_UI_Common_batch_00 crops (134x26 each). "Blank" states use
 * crop28, a faint empty plate the game shows on unplayed charts; fchain's
 * blank pattern (crop17) is fully transparent, so it renders nothing.
 */
export const CHUNI_BOX_SUCCESS_CROP: Record<ChuniSuccessLamp, number> = {
  none: 28,
  failed: 0,
  clear: 21,
  hard: 22,
  brave: 23,
  absolute: 24,
  catastrophy: 26,
};

export const CHUNI_BOX_COMBO_CROP: Record<ChuniComboLamp, number> = {
  none: 28,
  fc: 2,
  aj: 3,
  ajc: 27,
};

export const CHUNI_BOX_FCHAIN_CROP: Record<Exclude<ChuniFullChainLamp, "none">, number> = {
  gold: 4,
  platinum: 5,
};

/** C_achievement_rank patterns 0..14; index = rank pattern (0 = blank plate). */
export const CHUNI_BOX_RANK_CROP = [28, 9, 10, 11, 12, 13, 14, 6, 15, 7, 18, 16, 19, 8, 20];

/**
 * Rank pattern from a best score. The musicbox SRD carries no thresholds;
 * these are the standard CHUNITHM rank boundaries (fallback, not from dump).
 */
export function chuniRankPattern(score: number): number {
  const bounds: Array<[number, number]> = [
    [1009000, 14], // SSS+
    [1007500, 13], // SSS
    [1005000, 12], // SS+
    [1000000, 11], // SS
    [990000, 10], // S+
    [975000, 9], // S
    [950000, 8], // AAA
    [925000, 7], // AA
    [900000, 6], // A
    [800000, 5], // BBB
    [700000, 4], // BB
    [600000, 3], // B
    [500000, 2], // C
  ];
  for (const [min, pattern] of bounds) if (score >= min) return pattern;
  return 1; // D
}

/** PAT_start_txt patterns 0..2 (422x138 art on a 424x138 box). */
export const CHUNI_BOX_START_BANNER: Record<ChuniStartBanner, string> = {
  gamestart: chuniSelectSprite(BOX_SHEET, 44),
  ready: chuniSelectSprite(BOX_SHEET, 45),
  linkstart: chuniSelectSprite("CHU_UI_LinkedVERSE_LinkSTART", 0),
};

/** C_base decide frame, pre-baked from the CSLI strips (454x610). */
export const CHUNI_BOX_DECIDE_FRAME = "baked_musicbox_decide_frame";
