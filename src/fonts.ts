import { loadEntriesIndependently } from "./assetLoading";
import { officialData } from "./constants";
import { parseTmpFontMetrics, parseUnityFontMetrics } from "./runtimeJson";
import type { OfficialFontKey, UnityFontMetrics } from "./types";

async function loadRuntimeJson(file: string): Promise<unknown> {
  const response = await fetch(officialData(file), {
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(`R2 runtime asset ${file} unavailable: ${response.status}`);
  }
  return response.json();
}

const OFFICIAL_FONT_CATALOGS: Record<OfficialFontKey, string> = {
  kaku40: "FONT_SegaKakuGothic_40px.json",
  maru32: "FONT_SegaMaruGothic_32px.json",
  kaku16: "FONT_SegaKakuGothic_16px.json",
  maru16: "FONT_SegaMaruGothic_16px.json",
};

const officialFontPromises = new Map<OfficialFontKey, Promise<UnityFontMetrics>>();

/** Load one Unity bitmap catalog, sharing in-flight work across renderers. */
export function loadOfficialFont(key: OfficialFontKey) {
  const cached = officialFontPromises.get(key);
  if (cached) return cached;

  const file = OFFICIAL_FONT_CATALOGS[key];
  const promise = loadRuntimeJson(file).then((value) => parseUnityFontMetrics(value, file));
  officialFontPromises.set(key, promise);
  // A transient edge/R2 failure must not poison this font for future mounts.
  void promise.catch(() => {
    if (officialFontPromises.get(key) === promise) officialFontPromises.delete(key);
  });
  return promise;
}

/**
 * Load the Unity bitmap-font catalogs used by the CHU, MAI, and MU3 card
 * renderers. Both the catalogs and their referenced atlases live in the
 * versioned R2 runtime bundle; the repository intentionally stores neither.
 */
export async function loadOfficialFonts() {
  const entries = Object.entries(OFFICIAL_FONT_CATALOGS) as Array<
    readonly [OfficialFontKey, string]
  >;
  return loadEntriesIndependently<OfficialFontKey, UnityFontMetrics>(
    entries,
    (_file, key) => loadOfficialFont(key),
    (key, file, error) => console.warn(`R2 Unity font catalog unavailable: ${key} (${file})`, error),
  );
}

/** Load the MU3 TMP bitmap-font catalog from the same R2 runtime bundle. */
export function loadOfficialTmpFont() {
  const file = "FONT_TMP_SEGA_HUMMING_B_SDF.json";
  return loadRuntimeJson(file).then((value) => parseTmpFontMetrics(value, file));
}
