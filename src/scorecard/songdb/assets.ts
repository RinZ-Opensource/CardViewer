import type { ReactEventHandler } from "react";
import type {
  OfficialJacketMap,
  OngekiBossMap,
  SongDbGame,
  SupplementalAssets,
} from "./models";

const SAME_ORIGIN_SONGDB_ROOT = "/official/songdb";
const OFFICIAL_ASSET_FETCH_TIMEOUT_MS = 5_000;

const OFFICIAL_SCORECARD_DIR: Record<SongDbGame, string> = {
  maimai: "mai",
  chunithm: "chuni",
  ongeki: "ongeki",
};

/** Terminal fallback is a versioned R2 object, never an in-bundle data URI. */
const PLACEHOLDER_JACKET = "/official/cardviewer/v1/runtime/jacket-placeholder.png";
const JACKET_FILE = /^[A-Za-z0-9_.-]+\.(png|jpg|jpeg|webp)$/i;

const officialAssetsCache = new Map<SongDbGame, Promise<SupplementalAssets>>();

export function songdbDataUrl(game: SongDbGame): string {
  return `${SAME_ORIGIN_SONGDB_ROOT}/data/${game}/music-ex.json`;
}

export function songdbJacketUrl(game: SongDbGame, file: string): string {
  return `${SAME_ORIGIN_SONGDB_ROOT}/jackets/${game}/${file}`;
}

/** High-resolution override tier stored alongside mirrored jackets in R2. */
export function songdbHdJacketUrl(game: SongDbGame, file: string): string {
  return `${SAME_ORIGIN_SONGDB_ROOT}/hd-jackets/${game}/${file}`;
}

/** Preferred jacket + ordered R2 fallbacks: HD -> mirror -> dummy -> placeholder. */
export function jacketChain(
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

export function hasCompleteSupplementalAssets(
  game: SongDbGame,
  assets: SupplementalAssets,
): boolean {
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

function parseOfficialJacketMap(
  value: unknown,
  game: SongDbGame,
): OfficialJacketMap | undefined {
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

export function officialJacketUrl(
  game: SongDbGame,
  file: string,
  map: OfficialJacketMap | undefined,
): string | undefined {
  if (!map?.images[file]) return undefined;
  return `/official/scorecard/${OFFICIAL_SCORECARD_DIR[game]}/jackets/v${map.version}/${encodeURIComponent(file)}`;
}

export function loadSupplementalAssets(game: SongDbGame): Promise<SupplementalAssets> {
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

export function invalidateSupplementalAssetsCache(game: SongDbGame): void {
  officialAssetsCache.delete(game);
}
