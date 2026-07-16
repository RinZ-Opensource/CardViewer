import {
  OngekiAttribute,
  OngekiBattleRank,
  OngekiDifficulty,
  OngekiFcLamp,
} from "./ongekiTypes";
import { scorecardStaticPng } from "./scorecardAssetUrl";

const ONGEKI_SCORECARD_ROOT = "/official/scorecard/ongeki";

export function ongekiSprite(name: string) {
  return scorecardStaticPng("ongeki", name);
}

/** Jacket by zero-padded id. The game loads 220x220 S thumbnails here, but we
    serve the 512x512 originals so browser scaling and zoom do not soften them. */
export function ongekiJacket(id: string) {
  return ongekiSprite(`UI_Jacket_${id}`);
}

/** Full 256x256 opponent CardIcon exported from the official game data. */
export function ongekiBossIcon(id: number, version = 1) {
  return `${ONGEKI_SCORECARD_ROOT}/boss/v${version}/UI_Card_Icon_${String(id).padStart(6, "0")}.png`;
}

export const ONGEKI_DIFFICULTY_ORDER: OngekiDifficulty[] = [
  "basic",
  "advanced",
  "expert",
  "master",
  "lunatic",
];

export const ONGEKI_DIFFICULTY_LABEL: Record<OngekiDifficulty, string> = {
  basic: "BASIC",
  advanced: "ADVANCED",
  expert: "EXPERT",
  master: "MASTER",
  lunatic: "LUNATIC",
};

/** PAT_diff_base MU3UIImageChanger sprite list, pattern order 0..4. */
export const ONGEKI_BASE_SPRITE: Record<OngekiDifficulty, string> = {
  basic: "UI_PLY_Userinfo_MusicBase_Basic",
  advanced: "UI_PLY_Userinfo_MusicBase_Advanced",
  expert: "UI_PLY_Userinfo_MusicBase_Expert",
  master: "UI_PLY_Userinfo_MusicBase_Master",
  lunatic: "UI_PLY_Userinfo_MusicBase_Lunatic",
};

/** Per-glyph cuts of the UI_NUM_50pt_01_MusicLevel sheet (56x60 cells, white). */
export function ongekiLevelDigit(digit: string) {
  return ongekiSprite(`UI_NUM_50pt_01_MusicLevel_${digit}`);
}

/** Footer_Plus sprite (20x20), toggled by isFumenConstPlus. */
export const ONGEKI_PLUS_SPRITE = "UI_NUM_24pt_MusicLevel_Plus";

/** PAT_Mirror MU3UIImageChanger: patternNo 0 = On, 1 = Off (both 25x12). */
export const ONGEKI_MIRROR_SPRITE = {
  on: "UI_PLY_Userinfo_MusicBase_Mirror_On",
  off: "UI_PLY_Userinfo_MusicBase_Mirror_Off",
};

/** SecretMusic_cover sprite (294x161, stretched to 310x162). */
export const ONGEKI_SECRET_SPRITE = "UI_PLY_Userinfo_MusicBase_Secret";

/* ---------------------------------------------------------------------------
 * Music-select MusicBt card (ANM_SWH_MusicBt.prefab). Sprite names, pattern
 * lists and thresholds from manifest_musicbt.json / ongeki_musicbt_tree.* and
 * the MU3 runtime mappings cited there.
 * ------------------------------------------------------------------------- */

/** PAT_DF_base MU3UIImageChanger patterns 0..4 (labels baked into the art). */
export const ONGEKI_BT_PLATE_SPRITE: Record<OngekiDifficulty, string> = {
  basic: "UI_SLC_MusicSelect_DF_Basic",
  advanced: "UI_SLC_MusicSelect_DF_Advanced",
  expert: "UI_SLC_MusicSelect_DF_Expert",
  master: "UI_SLC_MusicSelect_DF_Master",
  lunatic: "UI_SLC_MusicSelect_DF_Lunatic",
};

/**
 * Digit-sheet glyph PNGs cut per MU3UICounterBase's 4x4 grid; suffixes are
 * "0".."9" | "plus" | "minus" | "dot" | "comma" | "zeropad".
 */
export function ongekiGlyph(sheet: string, glyph: string) {
  return ongekiSprite(`${sheet}_${glyph}`);
}

/** PAT_BattleRank patterns 0..4 (hidden when rank None/Fuka). */
export const ONGEKI_BT_BATTLE_RANK_SPRITE: Record<Exclude<OngekiBattleRank, "none">, string> = {
  usually: "UI_SLC_MusicSelect_HornorBadge_Usually",
  good: "UI_SLC_MusicSelect_HornorBadge_Good",
  great: "UI_SLC_MusicSelect_HornorBadge_Great",
  excellent: "UI_SLC_MusicSelect_HornorBadge_Excellent",
  unbelievable: "UI_SLC_MusicSelect_HornorBadge_Unbelievable",
};

/** PAT_TechnicalRank patterns 0..11 = D..SSS+. */
export const ONGEKI_BT_TECH_RANK_SPRITE = [
  "UI_SLC_MusicSelect_HornorBadge_D",
  "UI_SLC_MusicSelect_HornorBadge_C",
  "UI_SLC_MusicSelect_HornorBadge_B",
  "UI_SLC_MusicSelect_HornorBadge_BB",
  "UI_SLC_MusicSelect_HornorBadge_BBB",
  "UI_SLC_MusicSelect_HornorBadge_A",
  "UI_SLC_MusicSelect_HornorBadge_AA",
  "UI_SLC_MusicSelect_HornorBadge_AAA",
  "UI_SLC_MusicSelect_HornorBadge_S",
  "UI_SLC_MusicSelect_HornorBadge_SS",
  "UI_SLC_MusicSelect_HornorBadge_SSS",
  "UI_SLC_MusicSelect_HornorBadge_SSSplus",
];

/**
 * GameData.calcTechnicalRank lower bounds (DB/TechnicalRankIDEnum): pattern
 * index = position of the last threshold <= score.
 */
export const ONGEKI_TECH_RANK_LOWER = [
  0, // D
  500000, // C
  700000, // B
  750000, // BB
  800000, // BBB
  850000, // A
  900000, // AA
  940000, // AAA
  970000, // S
  990000, // SS
  1000000, // SSS
  1007500, // SSS+
];

export function ongekiTechRankPattern(score: number): number {
  let pattern = 0;
  for (let index = 0; index < ONGEKI_TECH_RANK_LOWER.length; index += 1) {
    if (score >= ONGEKI_TECH_RANK_LOWER[index]) pattern = index;
  }
  return pattern;
}

/** PAT_FB single pattern; PAT_FC_AB patterns 0..2. */
export const ONGEKI_BT_FB_SPRITE = "UI_SLC_MusicSelect_HornorBadge_FB";
export const ONGEKI_BT_FC_AB_SPRITE: Record<Exclude<OngekiFcLamp, "none">, string> = {
  fc: "UI_SLC_MusicSelect_HornorBadge_FC",
  ab: "UI_SLC_MusicSelect_HornorBadge_AB",
  abplus: "UI_SLC_MusicSelect_HornorBadge_ABPlus",
};

/**
 * Badge art is setNativeSize'd and centred in its 60x60 box; D is 58x58 and
 * FC 50x50, everything else 60x60.
 */
export const ONGEKI_BT_BADGE_NATIVE: Record<string, number> = {
  UI_SLC_MusicSelect_HornorBadge_D: 58,
  UI_SLC_MusicSelect_HornorBadge_FC: 50,
};

/** UI_CMN_Platinum_Star_0..6 (0 = fully transparent blank; 6 = rainbow). */
export function ongekiPlatinumStar(rank: number) {
  return ongekiSprite(`UI_CMN_Platinum_Star_${Math.min(6, Math.max(0, rank))}`);
}

/**
 * GameData.GetPlatinumScoreRank achieve-permille thresholds
 * (DB/PlatinumscorerankrateIDEnum): Rank_01..Rank_05Ex.
 */
export function ongekiPlatinumStarRank(score: number, max: number): number {
  if (!(max > 0) || !(score > 0)) return 0;
  const permille = Math.floor((score * 1000) / max);
  const bounds = [940, 950, 960, 970, 980, 990];
  let rank = 0;
  for (let index = 0; index < bounds.length; index += 1) {
    if (permille >= bounds[index]) rank = index + 1;
  }
  return rank;
}

/** PAT_AttributeIcon patterns 0..2 = AttributeType Fire/Aqua/Leaf. */
export const ONGEKI_BT_ATTRIBUTE_SPRITE: Record<OngekiAttribute, string> = {
  fire: "UI_CMN_AttributeIcon_Fire_mini",
  aqua: "UI_CMN_AttributeIcon_Aqua_mini",
  leaf: "UI_CMN_AttributeIcon_Leaf_mini",
};

/** Boss/VS block statics. */
export const ONGEKI_BT_CHARA_GAUGE = "UI_SLC_MusicSelect_CharaGauge";
export const ONGEKI_BT_VS_SPRITE = "UI_SLC_MusicSelect_CharaGauge_VS_01";
export const ONGEKI_BT_CHARA_LV_BASE = "UI_CMN_CharaLevel_base";
export const ONGEKI_BT_CHARA_LV_HEADER = "UI_CMN_CharaLevel_base_Header";

/** Browser fallback used when the selected boss CardIcon is unavailable. */
export const ONGEKI_BT_DEFAULT_BOSS_ICON = "UI_Jacket_0000";

/** OverDamage '%' footer (tinted like the counter). */
export const ONGEKI_BT_PERCENT_SPRITE = "UI_NUM_24pt_00_per";

/** Static 9-slice assets pre-baked by the external asset producer. */
export const ONGEKI_BT_PSCORE_BASE = "baked_pscore_base_122x52";
export const ONGEKI_BT_RIGHTS_BASE = "baked_rights_base_378x48";
export const ONGEKI_BT_RIGHTS_DUMMY = "UI_DMY_rights_00";
