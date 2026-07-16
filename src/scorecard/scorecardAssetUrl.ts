const SCORECARD_STATIC_ASSET_REVISION = "1";

export type ScoreCardAssetGame = "mai" | "chuni" | "ongeki";

/**
 * Resolve first-party UI PNGs that are published once at stable R2 keys.
 * The revision query isolates a new publication from stale negative edge-cache
 * entries without changing the R2 object key seen by the Pages Function.
 */
export function scorecardStaticPng(game: ScoreCardAssetGame, relativeName: string) {
  return `/official/scorecard/${game}/${relativeName}.png?v=${SCORECARD_STATIC_ASSET_REVISION}`;
}
