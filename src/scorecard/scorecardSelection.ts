import { CHUNI_SAMPLE_SONGS } from "./chuniSamples";
import type { ChuniDifficulty, ChuniScoreState, ChuniSong } from "./chuniTypes";
import { ONGEKI_SAMPLE_SONGS } from "./ongekiSamples";
import type { OngekiDifficulty, OngekiScoreState, OngekiSong } from "./ongekiTypes";
import { MAI_SAMPLE_SONGS } from "./sampleSongs";
import {
  chuniChartFields,
  chuniPreferredDifficulty,
  maiPreferredDifficulty,
  ongekiChartFields,
  ongekiPreferredDifficulty,
} from "./songdb";
import type { MaiDifficulty, MaiScoreState, MaiSong } from "./types";

/** React-compatible functional state update without a React dependency. */
export type StateTransition<State> = (current: State) => State;

export function migrateMaiStateToSongDb(
  current: MaiScoreState,
  songs: readonly MaiSong[],
): MaiScoreState {
  if (songs.length === 0) return current;
  const currentSong = songs.find((entry) => entry.id === current.songId);
  if (current.songDbBacked && currentSong) return current;
  const sample = MAI_SAMPLE_SONGS.find((entry) => entry.id === current.songId);
  const next = sample
    ? songs.find(
        (entry) =>
          entry.title === sample.title &&
          entry.artist === sample.artist &&
          entry.isDx === sample.isDx,
      )
    : currentSong;
  const resolved = next ?? songs[0];
  const difficulty = maiPreferredDifficulty(resolved, current.difficulty);
  return {
    ...current,
    songId: resolved.id,
    songDbBacked: true,
    difficulty,
    dxScoreMax: "",
  };
}

export function migrateChuniStateToSongDb(
  current: ChuniScoreState,
  songs: readonly ChuniSong[],
): ChuniScoreState {
  if (songs.length === 0) return current;
  const currentSong = songs.find((entry) => entry.id === current.songId);
  if (current.songDbBacked && currentSong) return current;
  const sample = CHUNI_SAMPLE_SONGS.find((entry) => entry.id === current.songId);
  const next = sample
    ? songs.find((entry) => entry.title === sample.title && entry.artist === sample.artist)
    : currentSong;
  const resolved = next ?? songs[0];
  const difficulty = chuniPreferredDifficulty(resolved, current.difficulty);
  return {
    ...current,
    ...chuniChartFields(resolved, difficulty),
    songId: resolved.id,
    songDbBacked: true,
    difficulty,
  };
}

export function migrateOngekiStateToSongDb(
  current: OngekiScoreState,
  songs: readonly OngekiSong[],
): OngekiScoreState {
  if (songs.length === 0) return current;
  const currentSong = songs.find((entry) => entry.id === current.songId);
  if (current.songDbBacked && currentSong) return current;
  const sample = ONGEKI_SAMPLE_SONGS.find((entry) => entry.id === current.songId);
  const next = sample
    ? songs.find((entry) => entry.title === sample.title && entry.artist === sample.artist)
    : currentSong;
  const resolved = next ?? songs[0];
  const difficulty = ongekiPreferredDifficulty(resolved, current.difficulty);
  return {
    ...current,
    ...ongekiChartFields(resolved, difficulty),
    songId: resolved.id,
    songDbBacked: true,
    difficulty,
  };
}

export function createMaiSongSelection(
  next: MaiSong,
  difficultyAtRender: MaiDifficulty,
  songDbReady: boolean,
): StateTransition<MaiScoreState> {
  const difficulty = maiPreferredDifficulty(next, difficultyAtRender);
  return (current) => ({
    ...current,
    songId: next.id,
    songDbBacked: songDbReady,
    difficulty,
    dxScoreMax: "",
  });
}

export function createMaiDifficultySelection(
  difficulty: MaiDifficulty,
): StateTransition<MaiScoreState> {
  return (current) => ({ ...current, difficulty, dxScoreMax: "" });
}

export function createChuniSongSelection(
  next: ChuniSong,
  difficultyAtRender: ChuniDifficulty,
  songDbReady: boolean,
): StateTransition<ChuniScoreState> {
  const difficulty = chuniPreferredDifficulty(next, difficultyAtRender);
  return (current) => ({
    ...current,
    ...chuniChartFields(next, difficulty),
    songId: next.id,
    songDbBacked: songDbReady,
    difficulty,
  });
}

export function createChuniDifficultySelection(
  song: ChuniSong,
  difficulty: ChuniDifficulty,
): StateTransition<ChuniScoreState> {
  return (current) => ({
    ...current,
    ...chuniChartFields(song, difficulty),
    difficulty,
  });
}

export function createOngekiSongSelection(
  next: OngekiSong,
  difficultyAtRender: OngekiDifficulty,
  songDbReady: boolean,
): StateTransition<OngekiScoreState> {
  const difficulty = ongekiPreferredDifficulty(next, difficultyAtRender);
  return (current) => ({
    ...current,
    ...ongekiChartFields(next, difficulty),
    songId: next.id,
    songDbBacked: songDbReady,
    difficulty,
  });
}

export function createOngekiDifficultySelection(
  song: OngekiSong,
  difficulty: OngekiDifficulty,
): StateTransition<OngekiScoreState> {
  return (current) => ({
    ...current,
    ...ongekiChartFields(song, difficulty),
    difficulty,
  });
}
