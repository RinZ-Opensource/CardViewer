import type { ReactEventHandler } from "react";
import { CHUNI_DUMMY_JACKET } from "./chuniAssets";
import { ChuniChart, ChuniDifficulty, ChuniScoreState, ChuniSong } from "./chuniTypes";
import { ongekiJacket } from "./ongekiAssets";
import {
  OngekiChart,
  OngekiDifficulty,
  OngekiScoreState,
  OngekiSong,
} from "./ongekiTypes";
import { MaiChart, MaiDifficulty, MaiSong } from "./types";

/**
 * Online song database (otoge-db) loader + normalizers.
 *
 * URL layouts: with VITE_SONGDB_BASE_URL set, data/jackets come from our
 * songdb worker (workers/songdb-sync — R2 mirror with an HD override tier);
 * unset, they come straight from the public jsDelivr mirror of otoge-db.
 * Both send Access-Control-Allow-Origin: *, so html-to-image exports stay
 * taint-free either way. Loader failures leave the app on the bundled
 * sample songs.
 */

export type SongDbGame = "maimai" | "chunithm" | "ongeki";
export type SongDbStatus = "loading" | "ready" | "error";

const OTOGEDB_JSDELIVR_ROOT = "https://cdn.jsdelivr.net/gh/zvuc/otoge-db@master";

function workerBase(): string | undefined {
  const base = import.meta.env.VITE_SONGDB_BASE_URL;
  return base ? base.replace(/\/+$/, "") : undefined;
}

export function songdbDataUrl(game: SongDbGame): string {
  const base = workerBase();
  return base
    ? `${base}/data/${game}/music-ex.json`
    : `${OTOGEDB_JSDELIVR_ROOT}/${game}/data/music-ex.json`;
}

export function songdbJacketUrl(game: SongDbGame, file: string): string {
  const base = workerBase();
  return base ? `${base}/jackets/${game}/${file}` : `${OTOGEDB_JSDELIVR_ROOT}/${game}/jacket/${file}`;
}

/** High-res override tier; worker-only (no jsDelivr equivalent). */
export function songdbHdJacketUrl(game: SongDbGame, file: string): string | undefined {
  const base = workerBase();
  return base ? `${base}/hd-jackets/${game}/${file}` : undefined;
}

/** Terminal <img> fallback: flat slate square as a data URI so it can never
    404 or taint the export (maimai ships no dummy jacket sprite). */
const PLACEHOLDER_JACKET =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="#2b3242"/></svg>',
  );

/** Preferred jacket + ordered fallbacks: HD (worker only) -> mirrored jacket
    -> local dummy art -> inline placeholder. */
function jacketChain(
  game: SongDbGame,
  file: string,
  localDummy?: string,
): { jacketUrl: string; jacketFallbacks: string[] } {
  const mirrored = songdbJacketUrl(game, file);
  const hd = songdbHdJacketUrl(game, file);
  const tail = localDummy ? [localDummy, PLACEHOLDER_JACKET] : [PLACEHOLDER_JACKET];
  return hd
    ? { jacketUrl: hd, jacketFallbacks: [mirrored, ...tail] }
    : { jacketUrl: mirrored, jacketFallbacks: tail };
}

/**
 * Spread onto an <img>: on load error the src walks the fallback list. The
 * per-node dataset keeps the step; it resets whenever the rendered src
 * changes, so a re-used <img> retries the full chain for the next song.
 */
export function jacketImgProps(
  src: string,
  fallbacks?: string[],
): { src: string; onError?: ReactEventHandler<HTMLImageElement> } {
  if (!fallbacks || fallbacks.length === 0) return { src };
  return {
    src,
    onError: (event) => {
      const image = event.currentTarget;
      if (image.dataset.jacketFor !== src) {
        image.dataset.jacketFor = src;
        image.dataset.jacketStep = "0";
      }
      const step = Number(image.dataset.jacketStep ?? "0");
      const next = fallbacks[step];
      if (!next) return;
      image.dataset.jacketStep = String(step + 1);
      image.src = next;
    },
  };
}

/* ---------------------------------------------------------------------------
 * Fetch + normalize, cached per game (module map; HTTP caching handles the
 * rest — no IndexedDB).
 * ------------------------------------------------------------------------- */

/** music-ex.json rows are flat string maps (numbers included). */
type RawEntry = Record<string, string | undefined>;

const songCache = new Map<SongDbGame, Promise<unknown>>();

function loadNormalized<Song>(
  game: SongDbGame,
  normalize: (entries: RawEntry[]) => Song[],
): Promise<Song[]> {
  let pending = songCache.get(game) as Promise<Song[]> | undefined;
  if (!pending) {
    pending = fetch(songdbDataUrl(game))
      .then((response) => {
        if (!response.ok) throw new Error(`songdb ${game}: HTTP ${response.status}`);
        return response.json() as Promise<RawEntry[]>;
      })
      .then(normalize);
    // Drop failed loads from the cache so a later tab switch can retry.
    pending.catch(() => songCache.delete(game));
    songCache.set(game, pending);
  }
  return pending;
}

function parseIntField(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseFloatField(value: string | undefined): number | undefined {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : undefined;
}

/* --- maimai ---------------------------------------------------------------- */

/** catcode -> in-game genre id (101.. order matches the sample songs). */
const MAI_GENRE_ID: Record<string, number> = {
  "POPS＆アニメ": 101,
  "niconico＆ボーカロイド": 102,
  "東方Project": 103,
  "ゲーム＆バラエティ": 104,
  maimai: 105,
  "オンゲキ＆CHUNITHM": 106,
};

const MAI_DIFF_FIELD: Array<[MaiDifficulty, string]> = [
  ["basic", "bas"],
  ["advanced", "adv"],
  ["expert", "exp"],
  ["master", "mas"],
  ["remaster", "remas"],
];

/** One chart set (lev_* = Standard, dx_lev_* = DX) of an otoge-db row. */
function maiCharts(entry: RawEntry, prefix: "lev" | "dx_lev"): MaiChart[] {
  const charts: MaiChart[] = [];
  for (const [difficulty, key] of MAI_DIFF_FIELD) {
    const level = entry[`${prefix}_${key}`];
    if (!level) continue;
    charts.push({
      difficulty,
      level,
      // Constant unknown: approximate from the display level ("13+" -> 13.6).
      levelValue:
        parseFloatField(entry[`${prefix}_${key}_i`]) ??
        (parseIntField(level) ?? 0) + (level.includes("+") ? 0.6 : 0),
      notesDesigner: entry[`${prefix}_${key}_designer`] ?? "",
      // DX score denominator: every note is worth up to 3 (CRITICAL PERFECT).
      maxDxScore: (parseIntField(entry[`${prefix}_${key}_notes`]) ?? 0) * 3,
    });
  }
  return charts;
}

function normalizeMai(entries: RawEntry[]): MaiSong[] {
  const songs: MaiSong[] = [];
  for (const entry of entries) {
    if (!entry.title || !entry.image_url) continue;
    // 宴会場 (UTAGE) rows only carry lev_utage charts; the card has no utage art.
    if (entry.lev_utage || entry.kanji) continue;
    const sort = parseIntField(entry.sort);
    if (sort === undefined) continue;
    const base = {
      title: entry.title,
      artist: entry.artist ?? "",
      // MaiScoreCard renders "???" for negative BPM.
      bpm: parseIntField(entry.bpm) ?? -1,
      genre: entry.catcode ?? "",
      genreId: MAI_GENRE_ID[entry.catcode ?? ""] ?? 0,
      ...jacketChain("maimai", entry.image_url),
    };
    // A row can carry both chart sets; split so the DX/Standard tab art stays
    // per-song. otoge-db has no numeric song id, so sort*10+variant is ours.
    const standard = maiCharts(entry, "lev");
    const dx = maiCharts(entry, "dx_lev");
    if (standard.length > 0) songs.push({ ...base, id: sort * 10, isDx: false, charts: standard });
    if (dx.length > 0) songs.push({ ...base, id: sort * 10 + 1, isDx: true, charts: dx });
  }
  return songs;
}

export function loadMaiSongs(): Promise<MaiSong[]> {
  return loadNormalized("maimai", normalizeMai);
}

/* --- CHUNITHM --------------------------------------------------------------- */

const CHUNI_DIFF_FIELD: Array<[ChuniDifficulty, string]> = [
  ["basic", "bas"],
  ["advanced", "adv"],
  ["expert", "exp"],
  ["master", "mas"],
  ["ultima", "ult"],
];

function normalizeChuni(entries: RawEntry[]): ChuniSong[] {
  const songs: ChuniSong[] = [];
  for (const entry of entries) {
    if (!entry.title || !entry.image) continue;
    const id = parseIntField(entry.id);
    if (id === undefined) continue;
    const charts: Partial<Record<ChuniDifficulty, ChuniChart>> = {};
    for (const [difficulty, key] of CHUNI_DIFF_FIELD) {
      const level = entry[`lev_${key}`];
      if (!level) continue;
      charts[difficulty] = {
        level,
        levelValue: parseFloatField(entry[`lev_${key}_i`]) ?? 0,
        notesDesigner: entry[`lev_${key}_designer`] ?? "",
        totalNotes: parseIntField(entry[`lev_${key}_notes`]) ?? 0,
      };
    }
    const weKanji = entry.we_kanji ?? "";
    if (weKanji) {
      charts.worldsend = {
        level: "",
        levelValue: 0,
        notesDesigner: entry.lev_we_designer ?? "",
        totalNotes: parseIntField(entry.lev_we_notes) ?? 0,
      };
    }
    if (Object.keys(charts).length === 0) continue;
    songs.push({
      id,
      title: entry.title,
      artist: entry.artist ?? "",
      ...jacketChain("chunithm", entry.image, CHUNI_DUMMY_JACKET),
      charts,
      bpm: parseIntField(entry.bpm),
      weKanji: weKanji || undefined,
      // we_star comes as odd 1/3/5/7/9 = 1..5 whole stars; (we_star+1)/2 lands
      // exactly on our 0.5-step WE_STAR option scale.
      weStars: weKanji ? ((parseIntField(entry.we_star) ?? 9) + 1) / 2 : undefined,
    });
  }
  return songs;
}

export function loadChuniSongs(): Promise<ChuniSong[]> {
  return loadNormalized("chunithm", normalizeChuni);
}

/* --- O.N.G.E.K.I. ------------------------------------------------------------ */

const ONGEKI_DIFF_FIELD: Array<[OngekiDifficulty, string]> = [
  ["basic", "bas"],
  ["advanced", "adv"],
  ["expert", "exc"],
  ["master", "mas"],
  ["lunatic", "lnt"],
];

function normalizeOngeki(entries: RawEntry[]): OngekiSong[] {
  const songs: OngekiSong[] = [];
  for (const entry of entries) {
    if (!entry.title || !entry.image_url || !entry.id) continue;
    const charts: Partial<Record<OngekiDifficulty, OngekiChart>> = {};
    for (const [difficulty, key] of ONGEKI_DIFF_FIELD) {
      const level = entry[`lev_${key}`];
      if (!level) continue;
      const totalNotes = parseIntField(entry[`lev_${key}_notes`]) ?? 0;
      charts[difficulty] = {
        level,
        levelValue: parseFloatField(entry[`lev_${key}_i`]) ?? 0,
        notesDesigner: entry[`lev_${key}_designer`] ?? "",
        totalNotes,
        bells: parseIntField(entry[`lev_${key}_bells`]) ?? 0,
        // NUM_PScore_MAX: every note is worth up to 2 platinum points.
        platinumScoreMax: totalNotes * 2,
      };
    }
    if (Object.keys(charts).length === 0) continue;
    const attribute = (entry.enemy_type ?? "").toLowerCase();
    songs.push({
      id: entry.id,
      title: entry.title,
      artist: entry.artist ?? "",
      ...jacketChain("ongeki", entry.image_url, ongekiJacket("0000")),
      charts,
      bpm: parseIntField(entry.bpm),
      bossLevel: parseIntField(entry.enemy_lv),
      // FIRE/AQUA/LEAF map onto our union; MULTI and "" stay unset so the
      // form keeps its current selection.
      bossAttribute:
        attribute === "fire" || attribute === "aqua" || attribute === "leaf"
          ? attribute
          : undefined,
    });
  }
  return songs;
}

export function loadOngekiSongs(): Promise<OngekiSong[]> {
  return loadNormalized("ongeki", normalizeOngeki);
}

/* ---------------------------------------------------------------------------
 * Form-state helpers: chart availability, landing difficulty, and the
 * chart-derived fields (re-)applied on song/difficulty selection. All of them
 * treat chart-less songs (the bundled samples) as "no data": everything stays
 * enabled and nothing is overwritten.
 * ------------------------------------------------------------------------- */

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
