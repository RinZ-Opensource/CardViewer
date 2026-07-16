import { MaiComboBadge, MaiDifficulty, MaiRank, MaiSyncBadge } from "./types";
import { scorecardStaticPng } from "./scorecardAssetUrl";

export function maiSprite(name: string) {
  return scorecardStaticPng("mai", name);
}

export function maiJacket(songId: number) {
  return scorecardStaticPng("mai", `jackets/jacket_${songId}`);
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
 * Star_Base (UI_TST_MBase_Box_02, 40x32, 9-slice borders L25/R14) pre-sliced
 * per star count at the game's animated widths (DXScore_01..05 sizeDelta.x),
 * baked to PNGs by the external asset producer. Single images avoid seams from
 * the separate quads drawn by CSS border-image at fractional zoom levels.
 */
export const MAI_STAR_BASE: Record<number, { width: number; sprite: string }> = {
  1: { width: 40, sprite: "UI_TST_MBase_Box_02_star1" },
  2: { width: 59, sprite: "UI_TST_MBase_Box_02_star2" },
  3: { width: 79, sprite: "UI_TST_MBase_Box_02_star3" },
  4: { width: 96, sprite: "UI_TST_MBase_Box_02_star4" },
  5: { width: 115, sprite: "UI_TST_MBase_Box_02_star5" },
};

