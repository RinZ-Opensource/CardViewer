import { MaiDifficulty, MaiRank } from "./types";

export const MAI_DIFFICULTY_ORDER: MaiDifficulty[] = [
  "basic",
  "advanced",
  "expert",
  "master",
  "remaster",
];

export const MAI_DIFFICULTY_LABEL: Record<MaiDifficulty, string> = {
  basic: "BASIC",
  advanced: "ADVANCED",
  expert: "EXPERT",
  master: "MASTER",
  remaster: "Re:MASTER",
};

/** Official rank thresholds, highest first. */
const RANK_THRESHOLDS: Array<[number, MaiRank]> = [
  [100.5, "sssp"],
  [100, "sss"],
  [99.5, "ssp"],
  [99, "ss"],
  [98, "sp"],
  [97, "s"],
  [94, "aaa"],
  [90, "aa"],
  [80, "a"],
  [75, "bbb"],
  [70, "bb"],
  [60, "b"],
  [50, "c"],
];

export function maiRankForAchievement(achievement: number): MaiRank {
  for (const [threshold, rank] of RANK_THRESHOLDS) {
    if (achievement >= threshold) return rank;
  }
  return "d";
}

/**
 * DX score star count (0-5) from the in-game ratio thresholds:
 * 85% / 90% / 93% / 95% / 97%.
 */
export function maiDxStars(dxScore: number, maxDxScore: number): number {
  if (maxDxScore <= 0 || dxScore <= 0) return 0;
  const ratio = dxScore / maxDxScore;
  if (ratio >= 0.97) return 5;
  if (ratio >= 0.95) return 4;
  if (ratio >= 0.93) return 3;
  if (ratio >= 0.9) return 2;
  if (ratio >= 0.85) return 1;
  return 0;
}

/** "100.9950" -> "100.9950", "99.5" -> "99.5000"; keeps the 4-decimal in-game format. */
export function formatAchievement(raw: string): string {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return "0.0000";
  return Math.min(101, Math.max(0, value)).toFixed(4);
}
