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

export interface GlyphSheet {
  /** Full texture size. */
  textureWidth: number;
  textureHeight: number;
  /** Grid cell height (glyph vertical offsets are preserved within cells). */
  cellHeight: number;
  /** Tight glyph rects [x, y, w, h] in texture px (alpha-thresholded). */
  glyphs: Record<string, [number, number, number, number]>;
}

/**
 * UI_NUM_MLevel_XX: 192x240 sheet backing the UI_CMN_MusicLevel_* sprites the
 * game feeds to SpriteCounter (48x60 grid). Rects are tight crops so glyphs
 * render at Unity's visible size; "+" keeps its superscript offset, "L" is
 * the "Lv" glyph.
 */
export const MAI_LEVEL_GLYPHS: GlyphSheet = {
  textureWidth: 192,
  textureHeight: 240,
  cellHeight: 60,
  glyphs: {
    "0": [3, 5, 40, 52],
    "1": [55, 6, 27, 50],
    "2": [101, 5, 37, 51],
    "3": [147, 5, 39, 52],
    "4": [3, 66, 40, 49],
    "5": [52, 66, 39, 51],
    "6": [99, 65, 40, 52],
    "7": [149, 66, 37, 50],
    "8": [3, 125, 40, 52],
    "9": [51, 125, 40, 52],
    "+": [106, 122, 27, 27],
    "-": [157, 141, 23, 13],
    ",": [17, 210, 15, 21],
    ".": [65, 211, 14, 14],
    "L": [102, 207, 38, 29],
  },
};
