import { loadEntriesIndependently } from "./assetLoading";
import { officialData } from "./constants";
import type { OfficialFontKey, TmpFontMetrics, UnityFontMetrics } from "./types";

async function loadRuntimeJson<T>(file: string): Promise<T> {
  const response = await fetch(officialData(file), {
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(`R2 runtime asset ${file} unavailable: ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * Load the three Unity bitmap-font catalogs used by the CHU and MAI card
 * renderers. Both the catalogs and their referenced atlases live in the
 * versioned R2 runtime bundle; the repository intentionally stores neither.
 */
export async function loadOfficialFonts() {
  const entries: Array<readonly [OfficialFontKey, string]> = [
    ["kaku40", "FONT_SegaKakuGothic_40px.json"],
    ["maru32", "FONT_SegaMaruGothic_32px.json"],
    ["kaku16", "FONT_SegaKakuGothic_16px.json"],
  ];
  return loadEntriesIndependently<OfficialFontKey, UnityFontMetrics>(
    entries,
    (file) => loadRuntimeJson<UnityFontMetrics>(file),
    (key, file, error) => console.warn(`R2 Unity font catalog unavailable: ${key} (${file})`, error),
  );
}

/** Load the MU3 TMP bitmap-font catalog from the same R2 runtime bundle. */
export function loadOfficialTmpFont() {
  return loadRuntimeJson<TmpFontMetrics>("FONT_TMP_SEGA_HUMMING_B_SDF.json");
}
