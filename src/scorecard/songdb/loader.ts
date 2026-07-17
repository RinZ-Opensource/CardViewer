import { parseSongDbEntries } from "../../runtimeJson";
import type { SongDbRawEntry } from "../../runtimeJson";
import type { ChuniSong } from "../chuniTypes";
import type { OngekiSong } from "../ongekiTypes";
import type { MaiSong } from "../types";
import {
  hasCompleteSupplementalAssets,
  invalidateSupplementalAssetsCache,
  loadSupplementalAssets,
  songdbDataUrl,
} from "./assets";
import type { SongDbGame, SupplementalAssets } from "./models";
import { normalizeChuni } from "./normalizeChuni";
import { normalizeMai } from "./normalizeMai";
import { normalizeOngeki } from "./normalizeOngeki";

const SONGDB_FETCH_TIMEOUT_MS = 20_000;
const songCache = new Map<SongDbGame, Promise<unknown>>();

/** Force the next user retry to perform fresh primary and supplemental loads. */
export function invalidateSongDbCache(game: SongDbGame): void {
  songCache.delete(game);
  invalidateSupplementalAssetsCache(game);
}

async function fetchSongDbEntries(game: SongDbGame): Promise<SongDbRawEntry[]> {
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
    return parseSongDbEntries(await response.json(), game);
  } catch (error) {
    if (timedOut) {
      throw new Error(`songdb ${game}: timed out after ${SONGDB_FETCH_TIMEOUT_MS}ms`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function loadNormalized<Song>(
  game: SongDbGame,
  normalize: (entries: SongDbRawEntry[], assets: SupplementalAssets) => Song[],
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

export function loadMaiSongs(): Promise<MaiSong[]> {
  return loadNormalized("maimai", normalizeMai);
}

export function loadChuniSongs(): Promise<ChuniSong[]> {
  return loadNormalized("chunithm", normalizeChuni);
}

export function loadOngekiSongs(): Promise<OngekiSong[]> {
  return loadNormalized("ongeki", normalizeOngeki);
}
