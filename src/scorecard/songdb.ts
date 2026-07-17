/**
 * Public compatibility facade for the scorecard song database.
 *
 * Keep callers on this module while URL/assets, fetch/cache orchestration,
 * game-specific normalization, and form helpers evolve independently.
 */
export type { SongDbGame, SongDbStatus } from "./songdb/models";

export {
  jacketImgProps,
  songdbDataUrl,
  songdbHdJacketUrl,
  songdbJacketUrl,
} from "./songdb/assets";

export {
  invalidateSongDbCache,
  loadChuniSongs,
  loadMaiSongs,
  loadOngekiSongs,
} from "./songdb/loader";

export {
  chuniChartFields,
  chuniHasChart,
  chuniPreferredDifficulty,
  maiPreferredDifficulty,
  ongekiChartFields,
  ongekiHasChart,
  ongekiPreferredDifficulty,
} from "./songdb/chartHelpers";
