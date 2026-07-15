import { DEPLOYMENT_MODE, officialData } from "./constants";
import { OfficialFontKey, TmpFontMetrics, UnityFontMetrics } from "./types";

export function installPrivateFontFaces() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.deploymentMode = DEPLOYMENT_MODE;
  if (DEPLOYMENT_MODE !== "private") return;
  if (document.getElementById("cardviewer-private-fonts")) return;

  const style = document.createElement("style");
  style.id = "cardviewer-private-fonts";
  style.textContent = `
@font-face {
  font-family: "CardViewer NewRodin";
  src: url("/fonts/private/FOT-NewRodin-Pro-EB.otf") format("opentype");
  font-weight: 800;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "CardViewer Humming";
  src: url("/fonts/private/FOT-Humming-Std-B.otf") format("opentype");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "CardViewer SegaMaruDB";
  src: url("/fonts/private/SEGA-MaruGothic-DB.ttf") format("truetype");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "CardViewer SegaKakuDB";
  src: url("/fonts/private/SEGA-KakuGothic-DB.ttf") format("truetype");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "CardViewer NewRodinDB";
  /* -unhinted: same broken small-ppem TrueType hinting as the EB weight. */
  src: url("/fonts/private/FOT-NewRodinN-DB-unhinted.ttf") format("truetype");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "CardViewer NewRodinNEB";
  /* -unhinted: the original file's TrueType hinting bytecode is broken at
     small ppem (S rasterizes as $, strokes collapse unevenly at ~12px).
     Outlines are fine, so we ship a copy with hinting stripped (fontTools
     subset --no-hinting); regenerate from FOT-NewRodinN-EB.ttf if replaced. */
  src: url("/fonts/private/FOT-NewRodinN-EB-unhinted.ttf") format("truetype");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "CardViewer MaruDB";
  src: url("/fonts/private/DF-MaruGothic-DB.ttf") format("truetype");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
html[data-deployment-mode="private"] {
  --font-sega-kaku: "CardViewer Zen Kaku", "CardViewer NewRodin", "Yu Gothic", "Meiryo", "Segoe UI", sans-serif;
  --font-sega-maru: "CardViewer Zen Maru", "CardViewer Humming", "Yu Gothic", "Meiryo", "Segoe UI", sans-serif;
  --font-sega-maru-db: "CardViewer SegaMaruDB", "CardViewer Zen Maru", "Yu Gothic", "Meiryo", "Segoe UI", sans-serif;
  --font-tmp-humming: "CardViewer Humming", "Yu Gothic", "Meiryo", "Segoe UI", sans-serif;
  --font-official-number: "CardViewer NewRodin", "Impact", "Arial Black", sans-serif;
  --font-mai-kaku: "CardViewer SegaKakuDB", "Yu Gothic", "Meiryo", "Segoe UI", sans-serif;
  --font-mai-rodin: "CardViewer NewRodinDB", "CardViewer NewRodin", "Arial Black", sans-serif;
  /* NewRodinN v2-EB (the exact game face, unhinted copy) first; Pro EB as
     fallback. */
  --font-mai-rodin-eb: "CardViewer NewRodinNEB", "CardViewer NewRodin", "Arial Black", sans-serif;
  --font-mai-maru: "CardViewer SegaMaruDB", "CardViewer MaruDB", "CardViewer Zen Maru", "Yu Gothic", "Meiryo", sans-serif;
}`;
  document.head.append(style);
}

export async function loadOfficialFonts() {
  const entries: Array<[OfficialFontKey, string]> = [
    ["kaku40", "FONT_SegaKakuGothic_40px.json"],
    ["maru32", "FONT_SegaMaruGothic_32px.json"],
    ["kaku16", "FONT_SegaKakuGothic_16px.json"],
  ];
  const fonts = await Promise.all(
    entries.map(async ([key, file]) => {
      const response = await fetch(officialData(file));
      if (!response.ok) throw new Error(`Failed to load ${file}`);
      return [key, (await response.json()) as UnityFontMetrics] as const;
    }),
  );
  return Object.fromEntries(fonts) as Partial<Record<OfficialFontKey, UnityFontMetrics>>;
}

export async function loadOfficialTmpFont() {
  const file = "FONT_TMP_SEGA_HUMMING_B_SDF.json";
  const response = await fetch(officialData(file));
  if (!response.ok) throw new Error(`Failed to load ${file}`);
  return (await response.json()) as TmpFontMetrics;
}

