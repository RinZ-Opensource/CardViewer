/**
 * PAT_base_left pattern set: the four normal difficulties plus ULTIMA,
 * WORLD'S END and TUTORIAL panel bases (CHU_UI_Playing_00_v10.srd).
 */
export type ChuniDifficulty =
  | "basic"
  | "advanced"
  | "expert"
  | "master"
  | "ultima"
  | "worldsend"
  | "tutorial";

/** Per-difficulty chart data from the song DB (otoge-db music-ex.json). */
export interface ChuniChart {
  /** Display level, e.g. "13+" ("" for WORLD'S END charts). */
  level: string;
  /** Numeric chart constant (lev_*_i) when known, 0 otherwise. */
  levelValue: number;
  notesDesigner: string;
  /** Total note count, 0 when unknown. */
  totalNotes: number;
}

export interface ChuniSong {
  id: number;
  title: string;
  artist: string;
  jacketUrl: string;
  /** Lower-tier jacket URLs tried in order when jacketUrl 404s (songdb.ts). */
  jacketFallbacks?: string[];
  /** Charts per difficulty when the song DB is loaded; absent on samples. */
  charts?: Partial<Record<ChuniDifficulty, ChuniChart>>;
  bpm?: number;
  /** WORLD'S END kanji + star count (0.5-step scale) when the song has a WE chart. */
  weKanji?: string;
  weStars?: number;
}

/** Which chuni card the surface renders: playing-screen info panel or music-select box. */
export type ChuniCardType = "panel" | "musicbox";

/** C_achievement_success patterns 0..7 (p6 is an unused transparent slot). */
export type ChuniSuccessLamp =
  | "none"
  | "failed"
  | "clear"
  | "hard"
  | "brave"
  | "absolute"
  | "catastrophy";

/** C_achievement_combo_perfect patterns 0..3. */
export type ChuniComboLamp = "none" | "fc" | "aj" | "ajc";

/** C_achievement_fchain patterns 0..2. */
export type ChuniFullChainLamp = "none" | "gold" | "platinum";

/** PAT_start_txt patterns 0..2 (confirm-state banner). */
export type ChuniStartBanner = "gamestart" | "ready" | "linkstart";

export interface ChuniScoreState {
  songId: number;
  difficulty: ChuniDifficulty;
  /** Display level, e.g. "13" or "13+" (normal charts only). */
  level: string;
  /** Track number as entered, e.g. "1". */
  track: string;
  /** Speed option as displayed, e.g. "2.0" (digits + decimal dot glyphs). */
  speed: string;
  /** Maxed speed: the SONIC label replaces the speed number (same slot). */
  sonic: boolean;
  mirror: boolean;
  /** WORLD'S END kanji (single 60pt char, e.g. 祭); shown instead of the level. */
  weKanji: string;
  /** WORLD'S END star count, 0.5..5 in half-star steps (gold patterns 10-19). */
  weStars: number;
  /** Which card the surface renders; older stored states default to "panel". */
  cardType: ChuniCardType;
  /** BEST SCORE digits (music box); "" = unplayed -> rank/lamps show blanks. */
  bestScore: string;
  successLamp: ChuniSuccessLamp;
  comboLamp: ChuniComboLamp;
  fullChainLamp: ChuniFullChainLamp;
  /** BPM digits (music box), e.g. "180". */
  bpm: string;
  /** NOTES DESIGNER name text (music box). */
  notesDesigner: string;
  /** Confirm state: decide frame + start banner over the music box. */
  confirmed: boolean;
  startBanner: ChuniStartBanner;
}
