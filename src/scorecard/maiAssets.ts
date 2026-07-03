import { MaiComboBadge, MaiDifficulty, MaiRank, MaiSyncBadge } from "./types";

const MAI_SCORECARD_ROOT = "/official/scorecard/mai";

export function maiSprite(name: string) {
  return `${MAI_SCORECARD_ROOT}/${name}.png`;
}

export function maiJacket(songId: number) {
  return `${MAI_SCORECARD_ROOT}/jackets/jacket_${songId}.png`;
}

/** Sprite-name suffix per difficulty, shared by MBase / Tab / banner text / LvBase. */
export const MAI_DIFF_SUFFIX: Record<MaiDifficulty, string> = {
  basic: "BSC",
  advanced: "ADV",
  expert: "EXP",
  master: "MST",
  remaster: "MST_Re",
};

/** UI_NUM_MLevel_XX digit-sheet index per difficulty (01=green … 05=white/purple). */
export const MAI_LEVEL_SHEET: Record<MaiDifficulty, string> = {
  basic: "01",
  advanced: "02",
  expert: "03",
  master: "04",
  remaster: "05",
};

export const MAI_RANK_SPRITE: Record<MaiRank, string> = {
  d: "UI_MSS_Rank_D",
  c: "UI_MSS_Rank_C",
  b: "UI_MSS_Rank_B",
  bb: "UI_MSS_Rank_BB",
  bbb: "UI_MSS_Rank_BBB",
  a: "UI_MSS_Rank_A",
  aa: "UI_MSS_Rank_AA",
  aaa: "UI_MSS_Rank_AAA",
  s: "UI_MSS_Rank_S",
  sp: "UI_MSS_Rank_Sp",
  ss: "UI_MSS_Rank_SS",
  ssp: "UI_MSS_Rank_SSp",
  sss: "UI_MSS_Rank_SSS",
  sssp: "UI_MSS_Rank_SSSp",
};

export const MAI_COMBO_SPRITE: Record<Exclude<MaiComboBadge, "none">, string> = {
  fc: "UI_MSS_MBase_Icon_FC",
  fcp: "UI_MSS_MBase_Icon_FCp",
  ap: "UI_MSS_MBase_Icon_AP",
  app: "UI_MSS_MBase_Icon_APp",
};

export const MAI_SYNC_SPRITE: Record<Exclude<MaiSyncBadge, "none">, string> = {
  sync: "UI_MSS_MBase_Icon_SP",
  fs: "UI_MSS_MBase_Icon_FS",
  fsp: "UI_MSS_MBase_Icon_FSp",
  fsd: "UI_MSS_MBase_Icon_FSD",
  fsdp: "UI_MSS_MBase_Icon_FSDp",
};

/**
 * DX-score star pip colors from MusicChainCard's _starColors:
 * earned = orange, unearned = blue-gray. Pips use the star silhouette as a
 * CSS mask so both states come from one sprite.
 */
export const MAI_STAR_EARNED = "#f8b534";
export const MAI_STAR_UNEARNED = "#8a9dd3";
export const MAI_STAR_SPRITE = "UI_MSS_DXScore_Star_02";

interface DigitSheet {
  /** Sheet grid cell size in native sprite px. */
  cellWidth: number;
  cellHeight: number;
  columns: number;
  rows: number;
  glyphs: Record<string, [number, number]>;
}

/**
 * UI_NUM_MLevel_XX: 192x240, 4x4 grid of 48x60 cells — the source texture of
 * the UI_CMN_MusicLevel_* sprites the game feeds to SpriteCounter.
 * "L" maps to the "Lv" glyph cell.
 */
export const MAI_LEVEL_DIGITS: DigitSheet = {
  cellWidth: 48,
  cellHeight: 60,
  columns: 4,
  rows: 4,
  glyphs: {
    "0": [0, 0], "1": [1, 0], "2": [2, 0], "3": [3, 0],
    "4": [0, 1], "5": [1, 1], "6": [2, 1], "7": [3, 1],
    "8": [0, 2], "9": [1, 2], "+": [2, 2], "-": [3, 2],
    ",": [0, 3], ".": [1, 3], "L": [2, 3],
  },
};
