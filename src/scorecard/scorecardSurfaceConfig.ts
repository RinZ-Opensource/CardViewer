import { CHUNI_DIFFICULTY_ORDER } from "./chuniAssets";
import type {
  ChuniComboLamp,
  ChuniFullChainLamp,
  ChuniStartBanner,
  ChuniSuccessLamp,
} from "./chuniTypes";
import { MAI_DIFFICULTY_ORDER } from "./maiScore";
import { ONGEKI_DIFFICULTY_ORDER } from "./ongekiAssets";
import type { OngekiAttribute, OngekiBattleRank, OngekiFcLamp } from "./ongekiTypes";
import { scorecardStaticPng } from "./scorecardAssetUrl";
import type { MaiComboBadge, MaiSyncBadge } from "./types";

export type ScoreCardGame = "mai" | "chuni" | "ongeki";

export const GAME_STORAGE_KEY = "configarc-card-viewer.scorecard-game";
/** Pre-game-selector key; kept verbatim so existing maimai state survives. */
export const SCORE_STORAGE_KEY = "configarc-card-viewer.scorecard";
export const CHUNI_STORAGE_KEY = "configarc-card-viewer.scorecard-chuni";
export const ONGEKI_STORAGE_KEY = "configarc-card-viewer.scorecard-ongeki";

export const GAMES: Array<{ key: ScoreCardGame; label: string }> = [
  { key: "mai", label: "maimai" },
  { key: "chuni", label: "CHUNITHM" },
  { key: "ongeki", label: "O.N.G.E.K.I." },
];

export const SCORECARD_ASSET_SENTINEL: Record<ScoreCardGame, string> = {
  mai: scorecardStaticPng("mai", "UI_CMN_Long_base_big"),
  chuni: scorecardStaticPng("chuni", "baked_musicbox_bpm_0"),
  ongeki: scorecardStaticPng("ongeki", "UI_CMN_AttributeIcon_Fire_mini"),
};

/** chuni/ongeki each render one of two cards: playing panel or select card. */
export const CARD_TYPES: Array<{ key: "panel" | "score"; label: string }> = [
  { key: "panel", label: "Play panel" },
  { key: "score", label: "Music card" },
];

/** Panel-style cards stay implemented, but are hidden until their UX is ready. */
export const SHOW_PANEL_CARDS = false;
/** Keep the unfinished CHUNITHM decide/start state disabled and out of the UI. */
export const SHOW_CHUNI_CONFIRMED_START = false;
/** Keep unfinished/destructive workbench actions out of the UI for now. */
export const SHOW_SCORECARD_RESET = false;

export const COMBO_OPTIONS: Array<{ value: MaiComboBadge; label: string }> = [
  { value: "none", label: "—" },
  { value: "fc", label: "FULL COMBO" },
  { value: "fcp", label: "FULL COMBO+" },
  { value: "ap", label: "ALL PERFECT" },
  { value: "app", label: "ALL PERFECT+" },
];

export const SYNC_OPTIONS: Array<{ value: MaiSyncBadge; label: string }> = [
  { value: "none", label: "—" },
  { value: "sync", label: "SYNC PLAY" },
  { value: "fs", label: "FULL SYNC" },
  { value: "fsp", label: "FULL SYNC+" },
  { value: "fsd", label: "FULL SYNC DX" },
  { value: "fsdp", label: "FULL SYNC DX+" },
];

/** WE star options, half-star steps (gold patterns 10-19). */
export const WE_STAR_OPTIONS = Array.from({ length: 10 }, (_, index) => (index + 1) / 2);

export const CHUNI_SUCCESS_OPTIONS: Array<{ value: ChuniSuccessLamp; label: string }> = [
  { value: "none", label: "—" },
  { value: "failed", label: "FAILED" },
  { value: "clear", label: "CLEAR" },
  { value: "hard", label: "HARD" },
  { value: "brave", label: "BRAVE" },
  { value: "absolute", label: "ABSOLUTE" },
  { value: "catastrophy", label: "CATASTROPHY" },
];

export const CHUNI_COMBO_OPTIONS: Array<{ value: ChuniComboLamp; label: string }> = [
  { value: "none", label: "—" },
  { value: "fc", label: "FULL COMBO" },
  { value: "aj", label: "ALL JUSTICE" },
  { value: "ajc", label: "ALL JUSTICE CRITICAL" },
];

export const CHUNI_FCHAIN_OPTIONS: Array<{ value: ChuniFullChainLamp; label: string }> = [
  { value: "none", label: "—" },
  { value: "gold", label: "FULL CHAIN (GOLD)" },
  { value: "platinum", label: "FULL CHAIN (PLATINUM)" },
];

export const CHUNI_BANNER_OPTIONS: Array<{ value: ChuniStartBanner; label: string }> = [
  { value: "gamestart", label: "GAME START!" },
  { value: "ready", label: "GAME 準備完了" },
  { value: "linkstart", label: "Link START!" },
];

export const ONGEKI_BATTLE_RANK_OPTIONS: Array<{ value: OngekiBattleRank; label: string }> = [
  { value: "none", label: "—" },
  { value: "usually", label: "可 (USUALLY)" },
  { value: "good", label: "良 (GOOD)" },
  { value: "great", label: "優 (GREAT)" },
  { value: "excellent", label: "秀 (EXCELLENT)" },
  { value: "unbelievable", label: "極 (UNBELIEVABLE)" },
];

export const ONGEKI_FC_OPTIONS: Array<{ value: OngekiFcLamp; label: string }> = [
  { value: "none", label: "—" },
  { value: "fc", label: "FULL COMBO" },
  { value: "ab", label: "ALL BREAK" },
  { value: "abplus", label: "ALL BREAK+" },
];

export const ONGEKI_ATTRIBUTE_OPTIONS: Array<{ value: OngekiAttribute; label: string }> = [
  { value: "fire", label: "FIRE" },
  { value: "aqua", label: "AQUA" },
  { value: "leaf", label: "LEAF" },
];

export const MAI_STORAGE_OPTIONS = {
  allowedValues: {
    difficulty: MAI_DIFFICULTY_ORDER,
    comboBadge: COMBO_OPTIONS.map((option) => option.value),
    syncBadge: SYNC_OPTIONS.map((option) => option.value),
  },
};

export const CHUNI_STORAGE_OPTIONS = {
  allowedValues: {
    difficulty: CHUNI_DIFFICULTY_ORDER,
    weStars: WE_STAR_OPTIONS,
    cardType: ["panel", "musicbox"],
    successLamp: CHUNI_SUCCESS_OPTIONS.map((option) => option.value),
    comboLamp: CHUNI_COMBO_OPTIONS.map((option) => option.value),
    fullChainLamp: CHUNI_FCHAIN_OPTIONS.map((option) => option.value),
    startBanner: CHUNI_BANNER_OPTIONS.map((option) => option.value),
  },
};

export const ONGEKI_STORAGE_OPTIONS = {
  allowedValues: {
    difficulty: ONGEKI_DIFFICULTY_ORDER,
    cardType: ["panel", "musicbt"],
    battleRank: ONGEKI_BATTLE_RANK_OPTIONS.map((option) => option.value),
    fcLamp: ONGEKI_FC_OPTIONS.map((option) => option.value),
    bossAttribute: ONGEKI_ATTRIBUTE_OPTIONS.map((option) => option.value),
  },
};
