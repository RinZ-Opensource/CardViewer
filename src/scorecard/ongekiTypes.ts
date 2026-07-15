/** MusicDataObject: _difficultyForDisp 0..4 = Basic..Master, Lunatic. */
export type OngekiDifficulty = "basic" | "advanced" | "expert" | "master" | "lunatic";

/** Per-difficulty chart data from the song DB (otoge-db music-ex.json). */
export interface OngekiChart {
  /** Display level, e.g. "13+". */
  level: string;
  /** Numeric chart constant (lev_*_i) when known, 0 otherwise. */
  levelValue: number;
  notesDesigner: string;
  /** Total note count, 0 when unknown. */
  totalNotes: number;
  /** Bell count, 0 when unknown. */
  bells: number;
  /** NUM_PScore_MAX: every note is worth up to 2 platinum points. */
  platinumScoreMax: number;
}

export interface OngekiSong {
  /** Zero-padded jacket id, e.g. "0001" (UI_Jacket_0001_S), or the DB song id. */
  id: string;
  title: string;
  artist: string;
  jacketUrl: string;
  /** Lower-tier jacket URLs tried in order when jacketUrl 404s (songdb.ts). */
  jacketFallbacks?: string[];
  /** Charts per difficulty when the song DB is loaded; absent on samples. */
  charts?: Partial<Record<OngekiDifficulty, OngekiChart>>;
  bpm?: number;
  /** Boss chara level (enemy_lv). */
  bossLevel?: number;
  /** Boss attribute; unset when the DB says MULTI or nothing. */
  bossAttribute?: OngekiAttribute;
}

/** Which ongeki card the surface renders: playing-screen panel or music-select MusicBt. */
export type OngekiCardType = "panel" | "musicbt";

/**
 * PAT_BattleRank patterns 0..4 = Ka(可)/Ryo(良)/Yu(優)/Shu(秀)/Goku(極); the
 * rank derives from boss-beat counts (not score), so it stays a manual select.
 * "none" = badge hidden (rank None/Fuka).
 */
export type OngekiBattleRank =
  | "none"
  | "usually"
  | "good"
  | "great"
  | "excellent"
  | "unbelievable";

/** PAT_FC_AB patterns 0..2; "none" = lamp hidden. */
export type OngekiFcLamp = "none" | "fc" | "ab" | "abplus";

/** DataStudio/AttributeType: Fire 0, Aqua 1, Leaf 2. */
export type OngekiAttribute = "fire" | "aqua" | "leaf";

export interface OngekiScoreState {
  songId: string;
  /** Distinguishes an explicit online-DB selection from a bundled sample with the same id. */
  songDbBacked?: boolean;
  difficulty: OngekiDifficulty;
  /**
   * Display level, e.g. "13" or "13+". The game shows the truncated integer of
   * the chart constant; a trailing "+" maps to isFumenConstPlus (separate sprite).
   */
  level: string;
  /** Speed option, e.g. "9.5" (rendered {0:0.00} -> "9.50"). */
  speed: string;
  /** UserOption.eSpeed.SONIC: the speed text becomes "SONIC". */
  sonic: boolean;
  mirror: boolean;
  /** setActiveSecretMusicInfo: stretched cover over the whole panel. */
  secret: boolean;
  /** Which card the surface renders; older stored states default to "panel". */
  cardType: OngekiCardType;
  /** TECHNICAL SCORE (MusicBt); "" = unplayed -> rank badge hidden, counter "0". */
  techScore: string;
  /** BATTLE SCORE (MusicBt); "" = unplayed -> counter "0". */
  battleScore: string;
  /** My platinum score (NUM_PScore); "" = unplayed -> "0" + transparent stars. */
  platinumScore: string;
  /** Chart platinum max (NUM_PScore_MAX). */
  platinumScoreMax: string;
  /** OVER DAMAGE percent, e.g. "254.5" (rendered with 2 zero-padded decimals). */
  overDamage: string;
  battleRank: OngekiBattleRank;
  /** PAT_FB lamp (isFullMark(FullBell)). */
  fullBell: boolean;
  fcLamp: OngekiFcLamp;
  /** Boss chara level (NUM_CharaLv). */
  bossLevel: string;
  /** Boss card attribute (PAT_AttributeIcon pattern). */
  bossAttribute: OngekiAttribute;
  /** BPM counter digits, e.g. "180". */
  bpm: string;
  /** NOTES DESIGNER text. */
  notesDesigner: string;
}
