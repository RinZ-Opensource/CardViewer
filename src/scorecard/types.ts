export type MaiDifficulty = "basic" | "advanced" | "expert" | "master" | "remaster";

export type MaiComboBadge = "none" | "fc" | "fcp" | "ap" | "app";

export type MaiSyncBadge = "none" | "sync" | "fs" | "fsp" | "fsd" | "fsdp";

export type MaiRank =
  | "d"
  | "c"
  | "b"
  | "bb"
  | "bbb"
  | "a"
  | "aa"
  | "aaa"
  | "s"
  | "sp"
  | "ss"
  | "ssp"
  | "sss"
  | "sssp";

export interface MaiChart {
  difficulty: MaiDifficulty;
  /** Display level, e.g. "13" or "13+". */
  level: string;
  /** Numeric chart constant when known, e.g. 13.7. */
  levelValue: number;
  notesDesigner: string;
  /** Total notes * 3, the DX score denominator. 0 when unknown. */
  maxDxScore: number;
}

export interface MaiSong {
  id: number;
  title: string;
  artist: string;
  bpm: number;
  genre: string;
  genreId: number;
  /** True for でらっくす charts, false for スタンダード. */
  isDx: boolean;
  /** Long-version music (longMusic == 1): shows the LONG badge over the frame. */
  isLong?: boolean;
  jacketUrl: string;
  /** Lower-tier jacket URLs tried in order when jacketUrl 404s (songdb.ts). */
  jacketFallbacks?: string[];
  charts: MaiChart[];
}

export interface MaiScoreState {
  songId: number;
  difficulty: MaiDifficulty;
  /** Achievement percentage as entered, e.g. "100.9950". */
  achievement: string;
  dxScore: string;
  /** Manual DX score denominator; falls back to the chart's maxDxScore when empty. */
  dxScoreMax: string;
  comboBadge: MaiComboBadge;
  syncBadge: MaiSyncBadge;
}
