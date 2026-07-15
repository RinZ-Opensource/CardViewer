import React from "react";
import { DeploymentMode, OfficialFontKey, TmpFontMetrics, UnityFontMetrics } from "./types";

export const DEFAULT_PACKAGE_ROOT = "I:\\package";
export const EDIT_STORAGE_KEY = "configarc-card-viewer.print-edits";
export const EXPLICIT_STATIC_MANIFEST_URL = import.meta.env.VITE_CARD_MANIFEST_URL?.trim() ?? "";
export const STATIC_MANIFEST_URL = EXPLICIT_STATIC_MANIFEST_URL || "/official/generated/cards.json";
export const CARD_TILT_X_MAX = 26;
export const CARD_TILT_Y_MAX = 34;
// Virtualized list pitch: rendered row height (82px) + window gap (7px).
export const CARD_ROW_HEIGHT = 89;
export const CARD_LIST_OVERSCAN = 6;
export const DEPLOYMENT_MODE: DeploymentMode =
  import.meta.env.VITE_DEPLOYMENT_MODE === "public" ? "public" : "private";
export const USE_OFFICIAL_ASSETS = DEPLOYMENT_MODE === "private";
export const HOLO_ENABLED = true;
export const OfficialFontContext = React.createContext<Partial<Record<OfficialFontKey, UnityFontMetrics>>>({});
export const TmpFontContext = React.createContext<TmpFontMetrics | null>(null);
export const CANVAS_FONT_SEGA_MARU_DB =
  '"CardViewer SegaMaruDB", "CardViewer Zen Maru", "Yu Gothic", "Meiryo", "Segoe UI", sans-serif';
export const MU3_LIMIT_BREAK_STAR_POSITIONS = [
  -208, -172.2, -134.3, -96.1, -58, -25, 11.3, 47.8, 81.6, 120, 156.8,
];
export const MU3_LIMIT_BREAK_STAR_Y = -290.1;
export const MU3_AWAKEN_MARK_RECT = { x: -273.7, y: 289, w: 174, h: 152 };
export const MU3_LEVEL_LIMITS = [1, 50, 55, 60, 65, 70, 80, 90, 100, 100000];

// Shared MU3 card layer rects, used by both the visual card (cards.tsx) and the
// holo mask (holo.tsx) so each coordinate is authored in exactly one place.
export const MU3_ATTRIBUTE_RECT = { x: -297, y: 439, w: 130, h: 130 } as const;
export const MU3_RARE_SPRITE_RECT = { x: -161.4, y: 442.3, w: 208, h: 118 } as const;
export const MU3_DIGITAL_MARK_RECT = { x: 239.2, y: 477.4, w: 294, h: 102 } as const;
export const MU3_GRADE_RECT = { x: 295, y: 455, w: 94, h: 142 } as const;
export const MU3_SKILL_BASE_RECT = { x: -40.3, y: -367.7, w: 628, h: 108 } as const;
export const MU3_MAX_LABEL_RECT = { x: -291, y: -228.6, w: 108, h: 34 } as const;
export const MU3_USER_NAME_BASE_RECT = { x: 278, y: -291.8, w: 212, h: 56 } as const;
export const MU3_CMN_ICON_RECT = { x: 262.8, y: -224.3, w: 146, h: 38, rotation: 6 } as const;
export const MU3_QR_BASE_RECT = { x: 251.8, y: -396.1, w: 157, h: 158 } as const;
export const MU3_RIGHTS_PLATE_RECT = { x: 0, y: -502, w: 768, h: 48 } as const;
export const MU3_RIGHTS_RECT = { x: -85, y: -447, w: 520, h: 64 } as const;

export const canInvokeTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type SpriteCrop = { sourceW: number; sourceH: number; x: number; y: number; w: number; h: number };

export const OFFICIAL_ASSET_ROOT = "/official/";
export const CARD_WIDTH = 768;
export const CARD_HEIGHT = 1052;
export const MAI_FRAME_ASSETS: string[] = [
  "UI_CMA_Card_Frame_00_Gold",
  "UI_CMA_Card_Frame_01_Silver",
  "UI_CMA_Card_Frame_02_Bronze",
  "UI_CMA_Card_Frame_03_Freedom",
];
export const MAI_PASS_RECT = { x: -134, y: 444, w: 420, h: 124 } as const;
export const MAI_PASS_CROPS: SpriteCrop[] = [
  { sourceW: 420, sourceH: 124, x: 7.0429, y: 5.0267, w: 337.9303, h: 111.9398 },
  { sourceW: 420, sourceH: 124, x: 15.0761, y: 3.0761, w: 362.9179, h: 109.8971 },
  { sourceW: 420, sourceH: 124, x: 19.0761, y: 7.0267, w: 373.8971, h: 104.9465 },
  { sourceW: 420, sourceH: 124, x: 4.0429, y: 3.0761, w: 414.881, h: 114.881 },
];
export const MAI_NAME_BASE_RECT = { x: -231, y: -308, w: 304, h: 82 } as const;
export const MAI_PERIOD_LABEL_RECT = { x: -297.6, y: -314.4, w: 100.9, h: 25 } as const;
export const MAI_CHARA_NAME_RECT = { x: -243.5, y: -281.4, w: 225.1, h: 25 } as const;
export const MAI_END_DATE_RECT = { x: -169.9, y: -318.5, w: 131.2, h: 18.9 } as const;
// Shared MAI card layer rects, used by both the visual card and the holo mask.
export const MAI_EFFECT_ICON_RECT = { x: -303, y: -403, w: 112, h: 112 } as const;
export const MAI_MASTER_ICON_RECT = { x: -193.2, y: -403, w: 112, h: 112 } as const;
export const MAI_RATING_ICON_RECT = { x: -84, y: -403, w: 112, h: 112 } as const;
export const MAI_PLAYER_NAME_BASE_RECT = { x: 211, y: 397, w: 276, h: 48 } as const;
export const MAI_FRIEND_CODE_BASE_RECT = { x: 211, y: 360.8, w: 276, h: 40 } as const;
export const MAI_RATING_BASE_RECT = { x: 212.4, y: 456.9, w: 280, h: 76 } as const;
export const MAI_SERIAL_CODE_BASE_RECT = { x: 0, y: -486.5, w: 490, h: 32 } as const;
export const MAI_QR_CODE_BASE_RECT = { x: 249.7, y: -394.7, w: 164, h: 164 } as const;
export const MAI_HOLO_MASK_CODE_RECT = { x: 43.5, y: -407.5, w: 583, h: 197 } as const;
export const MAI_HOLO_MASK_PLAYER_DATA_RECT = { x: 212.4, y: 434, w: 285, h: 127 } as const;
export const MAI_HOLO_MASK_TEXT_BASE_RECT = { x: 350, y: 245, w: 70, h: 362 } as const;
export const MAI_HOLO_MASK_MATCH_LEVEL_RECT = { x: 263.10004, y: 337.69995, w: 186, h: 88 } as const;
export const MAI_HOLO_UI_MASKS = [
  { asset: "UI_CMA_Holo_Mask_Code_00", rect: MAI_HOLO_MASK_CODE_RECT },
  { asset: "UI_CMA_Holo_Mask_PlayerData_00", rect: MAI_HOLO_MASK_PLAYER_DATA_RECT },
  { asset: "UI_CMA_Holo_Mask_Text_Base_00", rect: MAI_HOLO_MASK_TEXT_BASE_RECT },
  { asset: "UI_CMA_Holo_Mask_MatchLevel_00", rect: MAI_HOLO_MASK_MATCH_LEVEL_RECT },
  { asset: "UI_CMA_Holo_Mask_MatchLevel_01", rect: MAI_HOLO_MASK_MATCH_LEVEL_RECT },
  { asset: "UI_CMA_Holo_Mask_MatchLevel_02", rect: MAI_HOLO_MASK_MATCH_LEVEL_RECT },
  { asset: "UI_CMA_Holo_Mask_MatchLevel_03", rect: MAI_HOLO_MASK_MATCH_LEVEL_RECT },
] as const;

export function officialAsset(name: string) {
  return `${OFFICIAL_ASSET_ROOT}${name}.png`;
}

export function officialData(name: string) {
  return `${OFFICIAL_ASSET_ROOT}${name}`;
}
