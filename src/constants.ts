const explicitStaticManifestUrl = import.meta.env.VITE_CARD_MANIFEST_URL?.trim() ?? "";
export const STATIC_MANIFEST_URL = explicitStaticManifestUrl || "/official/generated/cards.json";
export const CARD_TILT_X_MAX = 26;
export const CARD_TILT_Y_MAX = 34;
// Virtualized list pitch: rendered row height (82px) + window gap (7px).
export const CARD_ROW_HEIGHT = 89;
export const CARD_LIST_OVERSCAN = 6;
