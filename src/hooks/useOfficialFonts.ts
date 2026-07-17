import React from "react";
import { USE_OFFICIAL_ASSETS } from "../constants";
import { loadOfficialFonts, loadOfficialTmpFont } from "../fonts";
import type { OfficialFontKey, TmpFontMetrics, UnityFontMetrics } from "../types";

/** Load the R2-hosted bitmap-font metadata required by the full renderer. */
export function useOfficialFonts(enabled = true) {
  const [officialFonts, setOfficialFonts] = React.useState<
    Partial<Record<OfficialFontKey, UnityFontMetrics>>
  >({});
  const [tmpFont, setTmpFont] = React.useState<TmpFontMetrics | null>(null);

  React.useEffect(() => {
    if (!USE_OFFICIAL_ASSETS || !enabled) return;
    let cancelled = false;
    void loadOfficialFonts()
      .then((fonts) => {
        if (!cancelled) setOfficialFonts(fonts);
      })
      .catch((error) => console.warn("R2 Unity font catalogs unavailable", error));
    void loadOfficialTmpFont()
      .then((font) => {
        if (!cancelled) setTmpFont(font);
      })
      .catch((error) => console.warn("R2 TMP font catalog unavailable", error));
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { officialFonts, tmpFont };
}
