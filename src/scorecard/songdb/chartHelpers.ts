import type { ChuniDifficulty, ChuniScoreState, ChuniSong } from "../chuniTypes";
import type { OngekiDifficulty, OngekiScoreState, OngekiSong } from "../ongekiTypes";
import type { MaiDifficulty, MaiSong } from "../types";

/**
 * Form-state helpers: chart availability, landing difficulty, and the
 * chart-derived fields (re-)applied on song/difficulty selection. All of them
 * treat chart-less songs (the bundled samples) as "no data": everything stays
 * enabled and nothing is overwritten.
 */

export function maiPreferredDifficulty(song: MaiSong, current: MaiDifficulty): MaiDifficulty {
  if (song.charts.some((chart) => chart.difficulty === current)) return current;
  const master = song.charts.find((chart) => chart.difficulty === "master");
  return (master ?? song.charts[song.charts.length - 1])?.difficulty ?? current;
}

export function chuniHasChart(song: ChuniSong, difficulty: ChuniDifficulty): boolean {
  return song.charts ? Boolean(song.charts[difficulty]) : true;
}

const CHUNI_LANDING_ORDER: ChuniDifficulty[] = [
  "master",
  "ultima",
  "expert",
  "advanced",
  "basic",
  "worldsend",
];

export function chuniPreferredDifficulty(
  song: ChuniSong,
  current: ChuniDifficulty,
): ChuniDifficulty {
  if (chuniHasChart(song, current)) return current;
  return CHUNI_LANDING_ORDER.find((difficulty) => chuniHasChart(song, difficulty)) ?? current;
}

/** Chart-derived chuni form fields; {} on samples (no chart data). */
export function chuniChartFields(
  song: ChuniSong,
  difficulty: ChuniDifficulty,
): Partial<ChuniScoreState> {
  if (!song.charts) return {};
  const fields: Partial<ChuniScoreState> = {};
  const chart = song.charts[difficulty];
  if (chart) {
    fields.level = chart.level;
    fields.notesDesigner = chart.notesDesigner || "-";
  }
  if (song.bpm !== undefined) fields.bpm = String(song.bpm);
  if (difficulty === "worldsend") {
    if (song.weKanji) fields.weKanji = song.weKanji;
    if (song.weStars !== undefined) fields.weStars = song.weStars;
  }
  return fields;
}

export function ongekiHasChart(song: OngekiSong, difficulty: OngekiDifficulty): boolean {
  return song.charts ? Boolean(song.charts[difficulty]) : true;
}

const ONGEKI_LANDING_ORDER: OngekiDifficulty[] = [
  "master",
  "lunatic",
  "expert",
  "advanced",
  "basic",
];

export function ongekiPreferredDifficulty(
  song: OngekiSong,
  current: OngekiDifficulty,
): OngekiDifficulty {
  if (ongekiHasChart(song, current)) return current;
  return ONGEKI_LANDING_ORDER.find((difficulty) => ongekiHasChart(song, difficulty)) ?? current;
}

/** Chart-derived ongeki form fields; {} on samples (no chart data). */
export function ongekiChartFields(
  song: OngekiSong,
  difficulty: OngekiDifficulty,
): Partial<OngekiScoreState> {
  if (!song.charts) return {};
  const fields: Partial<OngekiScoreState> = {};
  const chart = song.charts[difficulty];
  if (chart) {
    fields.level = chart.level;
    fields.notesDesigner = chart.notesDesigner || "-";
    fields.platinumScoreMax = chart.platinumScoreMax > 0 ? String(chart.platinumScoreMax) : "";
  }
  if (song.bpm !== undefined) fields.bpm = String(song.bpm);
  if (song.bossLevel !== undefined) fields.bossLevel = String(song.bossLevel);
  if (song.bossAttribute !== undefined) fields.bossAttribute = song.bossAttribute;
  return fields;
}
