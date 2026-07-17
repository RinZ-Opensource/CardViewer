/** Cloudflare bindings generated from wrangler.jsonc, plus secret-only values. */
export type Env = CloudflareBindings & {
  /** `wrangler secret put SYNC_TOKEN`; guards the manual POST /sync trigger. */
  SYNC_TOKEN?: string;
};

export const GAMES = ["maimai", "chunithm", "ongeki"] as const;
export type Game = (typeof GAMES)[number];

const OTOGEDB_ROOT = "https://raw.githubusercontent.com/zvuc/otoge-db/master";
const KEY_PREFIX = "songdb/";

export const DATA_CACHE = "public, max-age=3600";
export const JACKET_CACHE = "public, max-age=2592000, immutable";

export const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type",
  "access-control-max-age": "86400",
};

/**
 * otoge-db jacket names are hashed basenames. Anchoring the shape, together
 * with the game allowlist, confines reads to the intended R2 namespace.
 */
export const JACKET_FILE = /^[A-Za-z0-9_.-]+\.(png|jpg|jpeg|webp)$/;

export function isGame(value: string): value is Game {
  return (GAMES as readonly string[]).includes(value);
}

export function contentTypeFor(file: string): string {
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export function dataKey(game: Game): string {
  return `${KEY_PREFIX}data/${game}/music-ex.json`;
}

export function jacketKey(tier: "jackets" | "hd-jackets", game: Game, file: string): string {
  return `${KEY_PREFIX}${tier}/${game}/${file}`;
}

export function dataOriginUrl(game: Game): string {
  return `${OTOGEDB_ROOT}/${game}/data/music-ex.json`;
}
