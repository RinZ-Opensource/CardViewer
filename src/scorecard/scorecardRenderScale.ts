export const SCORECARD_TEXT_SUPERSAMPLE = 2;
export const SCORECARD_MAX_BACKING_SCALE = 4;

function positiveFinite(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Backing pixels per design-space pixel for raster-backed score-card text. */
export function scorecardTextBackingScale(
  stageScale: number,
  devicePixelRatio: number,
  minimum = 1,
) {
  const physicalScale = positiveFinite(stageScale, 1) * positiveFinite(devicePixelRatio, 1);
  const lowerBound = Math.min(
    SCORECARD_MAX_BACKING_SCALE,
    positiveFinite(minimum, 1),
  );
  return Math.min(
    SCORECARD_MAX_BACKING_SCALE,
    Math.max(lowerBound, physicalScale * SCORECARD_TEXT_SUPERSAMPLE),
  );
}
