import type { ReactEventHandler } from "react";
import { CHUNI_DUMMY_JACKET } from "./chuniAssets";
import { ChuniChart, ChuniDifficulty, ChuniScoreState, ChuniSong } from "./chuniTypes";
import { ongekiBossIcon, ongekiJacket } from "./ongekiAssets";
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
const SONGDB_FETCH_TIMEOUT_MS = 20_000;
const OFFICIAL_ASSET_FETCH_TIMEOUT_MS = 5_000;

const OFFICIAL_SCORECARD_DIR: Record<SongDbGame, string> = {
  maimai: "mai",
  chunithm: "chuni",
  ongeki: "ongeki",
};

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
  officialOverride?: string,
): { jacketUrl: string; jacketFallbacks: string[] } {
  const mirrored = songdbJacketUrl(game, file);
  const hd = songdbHdJacketUrl(game, file);
  const tail = localDummy ? [localDummy, PLACEHOLDER_JACKET] : [PLACEHOLDER_JACKET];
  const urls = [officialOverride, hd, mirrored, ...tail].filter(
    (url, index, all): url is string => Boolean(url) && all.indexOf(url) === index,
  );
  return { jacketUrl: urls[0], jacketFallbacks: urls.slice(1) };
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

interface OfficialJacketMap {
  version: number;
  game: SongDbGame;
  images: Record<string, { width: number; height: number }>;
}

interface OngekiBossMapEntry {
  musicId: string;
  bossCardId: number;
}

interface OngekiBossMap {
  version: number;
  songs: Record<string, OngekiBossMapEntry>;
}

interface SupplementalAssets {
  jackets?: OfficialJacketMap;
  ongekiBosses?: OngekiBossMap;
}

const JACKET_FILE = /^[A-Za-z0-9_.-]+\.(png|jpg|jpeg|webp)$/i;
const officialAssetsCache = new Map<SongDbGame, Promise<SupplementalAssets>>();

function hasCompleteSupplementalAssets(game: SongDbGame, assets: SupplementalAssets): boolean {
  return Boolean(assets.jackets) && (game !== "ongeki" || Boolean(assets.ongekiBosses));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function fetchOptionalJson(url: string): Promise<unknown | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OFFICIAL_ASSET_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function parseOfficialJacketMap(value: unknown, game: SongDbGame): OfficialJacketMap | undefined {
  if (!isRecord(value) || value.game !== game || !Number.isInteger(value.version)) return undefined;
  const version = Number(value.version);
  if (version < 1 || !isRecord(value.images)) return undefined;
  const images: OfficialJacketMap["images"] = {};
  for (const [file, rawImage] of Object.entries(value.images)) {
    if (!JACKET_FILE.test(file) || !isRecord(rawImage)) return undefined;
    const width = Number(rawImage.width);
    const height = Number(rawImage.height);
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
      return undefined;
    }
    images[file] = { width, height };
  }
  return { version, game, images };
}

function parseOngekiBossMap(value: unknown): OngekiBossMap | undefined {
  if (!isRecord(value) || !Number.isInteger(value.version) || !isRecord(value.songs)) {
    return undefined;
  }
  const version = Number(value.version);
  if (version < 1) return undefined;
  const songs: OngekiBossMap["songs"] = {};
  for (const [sortOrder, rawEntry] of Object.entries(value.songs)) {
    if (!/^\d+$/.test(sortOrder) || !isRecord(rawEntry)) return undefined;
    const musicId = String(rawEntry.musicId ?? "");
    const bossCardId = Number(rawEntry.bossCardId);
    if (!/^\d{4}$/.test(musicId) || !Number.isInteger(bossCardId) || bossCardId < 1) {
      return undefined;
    }
    songs[sortOrder] = { musicId, bossCardId };
  }
  return { version, songs };
}

function officialJacketUrl(
  game: SongDbGame,
  file: string,
  map: OfficialJacketMap | undefined,
): string | undefined {
  if (!map?.images[file]) return undefined;
  return `/official/scorecard/${OFFICIAL_SCORECARD_DIR[game]}/jackets/v${map.version}/${encodeURIComponent(file)}`;
}

function loadSupplementalAssets(game: SongDbGame): Promise<SupplementalAssets> {
  const pending = officialAssetsCache.get(game);
  if (pending) return pending;
  const scorecardDir = OFFICIAL_SCORECARD_DIR[game];
  const request = Promise.all([
    fetchOptionalJson(`/official/scorecard/${scorecardDir}/jackets/jacket-map.json`),
    game === "ongeki"
      ? fetchOptionalJson("/official/scorecard/ongeki/boss/boss-map.json")
      : Promise.resolve(undefined),
  ]).then(([rawJackets, rawBosses]) => ({
    jackets: parseOfficialJacketMap(rawJackets, game),
    ongekiBosses: game === "ongeki" ? parseOngekiBossMap(rawBosses) : undefined,
  }));
  officialAssetsCache.set(game, request);
  void request.then(
    (assets) => {
      if (
        !hasCompleteSupplementalAssets(game, assets) &&
        officialAssetsCache.get(game) === request
      ) {
        officialAssetsCache.delete(game);
      }
    },
    () => {
      if (officialAssetsCache.get(game) === request) officialAssetsCache.delete(game);
    },
  );
  return request;
}

const songCache = new Map<SongDbGame, Promise<unknown>>();

/** Force the next user retry to perform fresh primary and supplemental loads. */
export function invalidateSongDbCache(game: SongDbGame) {
  songCache.delete(game);
  officialAssetsCache.delete(game);
}

async function fetchSongDbEntries(game: SongDbGame): Promise<RawEntry[]> {
  const url = songdbDataUrl(game);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SONGDB_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`songdb ${game}: HTTP ${response.status}`);
    return (await response.json()) as RawEntry[];
  } catch (err) {
    if (timedOut) {
      throw new Error(
        `songdb ${game}: timed out after ${SONGDB_FETCH_TIMEOUT_MS}ms`,
        { cause: err },
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function loadNormalized<Song>(
  game: SongDbGame,
  normalize: (entries: RawEntry[], assets: SupplementalAssets) => Song[],
): Promise<Song[]> {
  let pending = songCache.get(game) as Promise<Song[]> | undefined;
  if (!pending) {
    let hasCompleteAssets = false;
    const request = Promise.all([fetchSongDbEntries(game), loadSupplementalAssets(game)]).then(
      ([entries, assets]) => {
        hasCompleteAssets = hasCompleteSupplementalAssets(game, assets);
        return normalize(entries, assets);
      },
    );
    songCache.set(game, request);
    // Empty or fallback-only results remain usable for this request, but do
    // not poison later retry/remount attempts with an incomplete snapshot.
    void request.then(
      (songs) => {
        if ((!songs.length || !hasCompleteAssets) && songCache.get(game) === request) {
          songCache.delete(game);
        }
      },
      () => {
        if (songCache.get(game) === request) songCache.delete(game);
      },
    );
    pending = request;
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

function normalizeMai(entries: RawEntry[], assets: SupplementalAssets): MaiSong[] {
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
      ...jacketChain(
        "maimai",
        entry.image_url,
        undefined,
        officialJacketUrl("maimai", entry.image_url, assets.jackets),
      ),
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

function normalizeChuni(entries: RawEntry[], assets: SupplementalAssets): ChuniSong[] {
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
      ...jacketChain(
        "chunithm",
        entry.image,
        CHUNI_DUMMY_JACKET,
        officialJacketUrl("chunithm", entry.image, assets.jackets),
      ),
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

function normalizeOngeki(entries: RawEntry[], assets: SupplementalAssets): OngekiSong[] {
  const bossMap = assets.ongekiBosses;
  const bossCountsByCharacter = new Map<
    string,
    Map<number, { boss: OngekiBossMapEntry; count: number }>
  >();

  // otoge-db's id normally matches Music.xml SortOrder, but older/removed
  // songs can retain a historical id. Build a deterministic, verified
  // same-character fallback from rows which still have an exact SortOrder
  // mapping so those songs do not collapse to the dummy jacket.
  for (const entry of entries) {
    const boss = bossMap?.songs[entry.id ?? ""];
    const characterKey = entry.chara_id || entry.character;
    if (!boss || !characterKey) continue;
    let counts = bossCountsByCharacter.get(characterKey);
    if (!counts) {
      counts = new Map();
      bossCountsByCharacter.set(characterKey, counts);
    }
    const current = counts.get(boss.bossCardId);
    counts.set(boss.bossCardId, { boss, count: (current?.count ?? 0) + 1 });
  }

  const representativeBossByCharacter = new Map<string, OngekiBossMapEntry>();
  for (const [characterKey, counts] of bossCountsByCharacter) {
    const representative = [...counts.values()].sort(
      (left, right) => right.count - left.count || left.boss.bossCardId - right.boss.bossCardId,
    )[0]?.boss;
    if (representative) representativeBossByCharacter.set(characterKey, representative);
  }

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
    const exactBoss = bossMap?.songs[entry.id];
    const characterKey = entry.chara_id || entry.character;
    const representativeBoss = characterKey
      ? representativeBossByCharacter.get(characterKey)
      : undefined;
    const exactBossIconUrl = exactBoss
      ? ongekiBossIcon(exactBoss.bossCardId, bossMap?.version)
      : undefined;
    const representativeBossIconUrl = representativeBoss
      ? ongekiBossIcon(representativeBoss.bossCardId, bossMap?.version)
      : undefined;
    songs.push({
      id: entry.id,
      title: entry.title,
      artist: entry.artist ?? "",
      ...jacketChain(
        "ongeki",
        entry.image_url,
        ongekiJacket("0000"),
        officialJacketUrl("ongeki", entry.image_url, assets.jackets),
      ),
      charts,
      bpm: parseIntField(entry.bpm),
      bossLevel: parseIntField(entry.enemy_lv),
      // FIRE/AQUA/LEAF map onto our union; MULTI and "" stay unset so the
      // form keeps its current selection.
      bossAttribute:
        attribute === "fire" || attribute === "aqua" || attribute === "leaf"
          ? attribute
          : undefined,
      officialMusicId: exactBoss?.musicId,
      bossCardId: exactBoss?.bossCardId,
      bossIconUrl: exactBossIconUrl ?? representativeBossIconUrl,
      bossIconFallbacks:
        exactBossIconUrl &&
        representativeBossIconUrl &&
        representativeBoss?.bossCardId !== exactBoss?.bossCardId
          ? [representativeBossIconUrl]
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
