import React from "react";
import { isSupportedCardRecord } from "../cardSupport";
import { loadStaticScanResult } from "../manifest";
import { mockScanResult } from "../mockData";
import type { ScanResult } from "../types";

// Loads the Cloudflare/R2 manifest and falls back to bundled browser samples
// when deployment data is unavailable.
export function useScanResult(setSelectedId: React.Dispatch<React.SetStateAction<string>>) {
  const [scanResult, setScanResult] = React.useState<ScanResult | null>(null);
  const [status, setStatus] = React.useState("Ready");
  const [loading, setLoading] = React.useState(true);
  const [source, setSource] = React.useState<"loading" | "manifest" | "mock">("loading");
  const [reloadToken, setReloadToken] = React.useState(0);
  const loadSequenceRef = React.useRef(0);

  React.useEffect(() => {
    const loadManifest = async () => {
      setLoading(true);
      setSource("loading");
      const loadId = loadSequenceRef.current + 1;
      loadSequenceRef.current = loadId;
      const isCurrentLoad = () => loadSequenceRef.current === loadId;
      const applyScanResult = (result: ScanResult) => {
        const nextDisplayCards = result.cards.filter(isSupportedCardRecord);
        setScanResult(result);
        setSelectedId((current) =>
          nextDisplayCards.some((card) => card.dataName === current)
            ? current
            : nextDisplayCards[0]?.dataName ?? "",
        );
      };

      try {
        setStatus("Loading exported manifest");
        const result = await loadStaticScanResult((partial, loadedCards, totalCards) => {
          if (!isCurrentLoad()) return;
          applyScanResult(partial);
          setStatus(
            `Loaded ${loadedCards.toLocaleString()} of ${totalCards.toLocaleString()} exported records`,
          );
        });
        if (!isCurrentLoad()) return;
        applyScanResult(result);
        setSource("manifest");
        setStatus(`Loaded ${result.cards.length.toLocaleString()} exported records`);
      } catch (manifestError) {
        if (!isCurrentLoad()) return;
        const result = mockScanResult("bundled-samples");
        console.warn("Exported manifest unavailable; using bundled samples", manifestError);
        applyScanResult(result);
        setSource("mock");
        setStatus(
          `Manifest unavailable — showing ${result.cards.length.toLocaleString()} bundled sample records`,
        );
      } finally {
        if (isCurrentLoad()) setLoading(false);
      }
    };

    void loadManifest();
  }, [reloadToken, setSelectedId]);

  const retry = React.useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  return {
    scanResult,
    status,
    source,
    loading,
    retry,
  };
}
