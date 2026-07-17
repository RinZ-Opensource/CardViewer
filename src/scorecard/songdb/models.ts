import type { SongDbGameName } from "../../runtimeJson";

export type SongDbGame = SongDbGameName;
export type SongDbStatus = "loading" | "ready" | "error";

export interface OfficialJacketMap {
  version: number;
  game: SongDbGame;
  images: Record<string, { width: number; height: number }>;
}

export interface OngekiBossMapEntry {
  musicId: string;
  bossCardId: number;
}

export interface OngekiBossMap {
  version: number;
  songs: Record<string, OngekiBossMapEntry>;
}

export interface SupplementalAssets {
  jackets?: OfficialJacketMap;
  ongekiBosses?: OngekiBossMap;
}
