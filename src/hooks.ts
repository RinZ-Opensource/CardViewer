import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { assetLayerLoadPriority, visibleAssetLayers } from "./cards";
import { maiLinkedPrintEdits } from "./cardData";
import { PLAYER_EDIT_KEYS, SHARED_PLAYER_EDITS_KEY, sharedPlayerEdits } from "./cardEdits";
import { DEFAULT_PACKAGE_ROOT, EDIT_STORAGE_KEY, USE_OFFICIAL_ASSETS, canInvokeTauri } from "./constants";
import { loadOfficialFonts, loadOfficialTmpFont } from "./fonts";
import { isStaticAssetPath, readCachedImageDataUrl } from "./imageLoader";
import { loadStaticScanResult } from "./manifest";
import { mockScanResult } from "./mockData";
import { CardEdits, CardRecord, LoadedAssetDataUrls, LoadedImageDataUrl, OfficialFontKey, PrintFieldValue, ScanResult, TmpFontMetrics, UnityFontMetrics } from "./types";

// Loads the Unity bitmap fonts and the TMP SDF font used by the official card
// renderers. No-op outside the private/official deployment.
export function useOfficialFonts() {
  const [officialFonts, setOfficialFonts] = React.useState<
    Partial<Record<OfficialFontKey, UnityFontMetrics>>
  >({});
  const [tmpFont, setTmpFont] = React.useState<TmpFontMetrics | null>(null);

  React.useEffect(() => {
    if (!USE_OFFICIAL_ASSETS) return;
    let cancelled = false;
    loadOfficialFonts()
      .then((fonts) => {
        if (!cancelled) setOfficialFonts(fonts);
      })
      .catch(() => undefined);
    loadOfficialTmpFont()
      .then((font) => {
        if (!cancelled) setTmpFont(font);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return { officialFonts, tmpFont };
}

// Loads the card scan once on mount: exported static manifest first, then a
// mock dataset in the browser, then the Tauri package scan as a fallback.
// `setSelectedId` is threaded in so a completed load can seed the selection.
export function useScanResult(setSelectedId: React.Dispatch<React.SetStateAction<string>>) {
  const [scanResult, setScanResult] = React.useState<ScanResult | null>(null);
  const [packageRoot, setPackageRoot] = React.useState(DEFAULT_PACKAGE_ROOT);
  const [status, setStatus] = React.useState("Ready");
  const [error, setError] = React.useState("");
  const autoLoadStartedRef = React.useRef(false);
  const loadSequenceRef = React.useRef(0);

  React.useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(""), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  React.useEffect(() => {
    if (autoLoadStartedRef.current) return;
    autoLoadStartedRef.current = true;

    const scanPackage = async () => {
      setError("");
      const tauriAvailable = canInvokeTauri();
      const loadId = loadSequenceRef.current + 1;
      loadSequenceRef.current = loadId;
      const isCurrentLoad = () => loadSequenceRef.current === loadId;
      const applyScanResult = (result: ScanResult) => {
        const nextDisplayCards = result.cards.filter((card) => card.recordType === "Card");
        setScanResult(result);
        setPackageRoot(result.packageRoot || packageRoot);
        setSelectedId((current) =>
          nextDisplayCards.some((card) => card.dataName === current)
            ? current
            : nextDisplayCards[0]?.dataName ?? "",
        );
      };

      try {
        setStatus("Loading exported manifest");
        try {
          const result = await loadStaticScanResult((partial, loadedCards, totalCards) => {
            if (!isCurrentLoad()) return;
            applyScanResult(partial);
            setStatus(
              `Loaded ${loadedCards.toLocaleString()} of ${totalCards.toLocaleString()} exported records`,
            );
          });
          if (!isCurrentLoad()) return;
          applyScanResult(result);
          setStatus(`Loaded ${result.cards.length.toLocaleString()} exported records`);
          return;
        } catch {
          if (!tauriAvailable) {
            const result = mockScanResult(packageRoot);
            if (!isCurrentLoad()) return;
            applyScanResult(result);
            setStatus("Browser preview data loaded");
            return;
          }
          setStatus("Manifest unavailable; scanning package");
        }

        const result = await invoke<ScanResult>("scan_package", { packageRoot });
        if (!isCurrentLoad()) return;
        applyScanResult(result);
        setStatus(`Loaded ${result.cards.length.toLocaleString()} records`);
      } catch (err) {
        if (!isCurrentLoad()) return;
        setError(String(err));
        setStatus("Scan failed");
      }
    };

    void scanPackage();
  }, [packageRoot, setSelectedId]);

  return { scanResult, status, error, setError };
}

// Owns the persisted print-edit state and the mutations against it. Per-card
// edits are keyed by dataName; player-data edits (name / rating / friend code)
// are shared across cards under a single key.
export function useCardEdits() {
  const [edits, setEdits] = React.useState<Record<string, CardEdits>>(() => {
    const raw = localStorage.getItem(EDIT_STORAGE_KEY);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, CardEdits>;
    } catch {
      return {};
    }
  });

  React.useEffect(() => {
    localStorage.setItem(EDIT_STORAGE_KEY, JSON.stringify(edits));
  }, [edits]);

  const updateCardField = React.useCallback((card: CardRecord, fieldKey: string, value: PrintFieldValue) => {
    setEdits((prev) => ({
      ...prev,
      [card.dataName]: {
        ...prev[card.dataName],
        ...maiLinkedPrintEdits(card, fieldKey, value),
      },
    }));
  }, []);

  const updatePlayerField = React.useCallback((fieldKey: string, value: PrintFieldValue) => {
    if (!PLAYER_EDIT_KEYS.has(fieldKey)) return;
    setEdits((prev) => {
      const next: Record<string, CardEdits> = {
        ...prev,
        [SHARED_PLAYER_EDITS_KEY]: {
          ...sharedPlayerEdits(prev),
          [fieldKey]: value,
        },
      };

      // A player field now lives under the shared key, so drop any stale
      // per-card copy (and the card entry if it becomes empty).
      for (const [key, cardEdits] of Object.entries(prev)) {
        if (key === SHARED_PLAYER_EDITS_KEY || cardEdits[fieldKey] === undefined) continue;
        const cleaned = { ...cardEdits };
        delete cleaned[fieldKey];
        if (Object.keys(cleaned).length === 0) {
          delete next[key];
        } else {
          next[key] = cleaned;
        }
      }

      return next;
    });
  }, []);

  const resetCardEdits = React.useCallback((card: CardRecord) => {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[card.dataName];
      return next;
    });
  }, []);

  return { edits, updateCardField, updatePlayerField, resetCardEdits };
}

// Tracks the card list's scroll position and height (via ResizeObserver) so the
// caller can compute the virtual window. Returns the ref to attach to the
// scroll container plus an onScroll handler.
export function useCardListViewport() {
  const cardListRef = React.useRef<HTMLElement | null>(null);
  const [cardListViewport, setCardListViewport] = React.useState({ height: 0, scrollTop: 0 });

  React.useEffect(() => {
    const element = cardListRef.current;
    if (!element) return;

    const update = () => {
      setCardListViewport({
        height: element.clientHeight,
        scrollTop: element.scrollTop,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const updateCardListScroll = React.useCallback(() => {
    const element = cardListRef.current;
    if (!element) return;
    setCardListViewport((prev) => {
      if (prev.scrollTop === element.scrollTop && prev.height === element.clientHeight) return prev;
      return {
        height: element.clientHeight,
        scrollTop: element.scrollTop,
      };
    });
  }, []);

  return { cardListRef, cardListViewport, updateCardListScroll };
}

// Resolves the selected card's primary image to a data URL (high priority).
// Returns "" until it is ready or when the path can't be read in this context.
export function useSelectedImageDataUrl(selected: CardRecord | null, selectedImagePath: string) {
  const [loadedImageDataUrl, setLoadedImageDataUrl] = React.useState<LoadedImageDataUrl | null>(null);

  React.useEffect(() => {
    if (!selected) {
      setLoadedImageDataUrl(null);
      return;
    }
    if (!selectedImagePath || (!canInvokeTauri() && !isStaticAssetPath(selectedImagePath))) {
      setLoadedImageDataUrl(null);
      return;
    }

    let cancelled = false;
    setLoadedImageDataUrl((prev) => (prev?.path === selectedImagePath ? prev : null));
    readCachedImageDataUrl(selectedImagePath, "high")
      .then((dataUrl) => {
        if (!cancelled) setLoadedImageDataUrl({ path: selectedImagePath, dataUrl });
      })
      .catch(() => {
        if (!cancelled) setLoadedImageDataUrl(null);
      });

    return () => {
      cancelled = true;
    };
    // `selected` is intentionally not a dependency: the only thing the effect
    // reads from it (the resolved image path) is `selectedImagePath`, which the
    // caller derives from `selected` and which becomes "" when it clears. Adding
    // `selected` would re-run on unrelated edits without changing the result.
  }, [selectedImagePath]);

  return loadedImageDataUrl?.path === selectedImagePath ? loadedImageDataUrl.dataUrl : "";
}

// Resolves the selected card's visible asset layers to data URLs, keyed by
// layer key. Keeps results only while their signature matches the selection.
export function useSelectedAssetDataUrls(
  selected: CardRecord | null,
  selectedAssetsSignature: string,
  streamingAssets: string | undefined,
) {
  const [loadedAssetDataUrls, setLoadedAssetDataUrls] = React.useState<LoadedAssetDataUrls>({
    signature: "",
    urls: {},
  });

  React.useEffect(() => {
    if (!selected) {
      setLoadedAssetDataUrls({ signature: "", urls: {} });
      return;
    }

    let cancelled = false;
    const layers = visibleAssetLayers(selected, streamingAssets);
    const readableLayers = layers.filter((layer) => canInvokeTauri() || isStaticAssetPath(layer.path));
    setLoadedAssetDataUrls((prev) =>
      prev.signature === selectedAssetsSignature ? prev : { signature: selectedAssetsSignature, urls: {} },
    );
    readableLayers.forEach((layer) => {
      readCachedImageDataUrl(layer.path, assetLayerLoadPriority(layer))
        .then((dataUrl) => {
          if (cancelled) return;
          setLoadedAssetDataUrls((prev) => {
            if (prev.signature !== selectedAssetsSignature) return prev;
            if (prev.urls[layer.key] === dataUrl) return prev;
            return {
              signature: selectedAssetsSignature,
              urls: { ...prev.urls, [layer.key]: dataUrl },
            };
          });
        })
        .catch(() => undefined);
    });

    return () => {
      cancelled = true;
    };
    // `selected` and `streamingAssets` are intentionally not listed: both feed
    // into `selectedAssetsSignature` (computed by the caller from exactly those
    // two), so any layer-affecting change already flips the signature and
    // re-runs this effect. Depending on them directly would only add redundant
    // re-runs for fields that don't change the visible layers.
  }, [selected?.dataName, selectedAssetsSignature]);

  return loadedAssetDataUrls.signature === selectedAssetsSignature ? loadedAssetDataUrls.urls : {};
}

// Loads thumbnails for the given cards, batching state updates per animation
// frame and de-duplicating in-flight/cached requests. Returns a dataName->url map.
// Keeps at most this many decoded thumbnails in component state. Evicted
// entries still live in the (LRU-bounded) imageDataUrlCache, so scrolling back
// re-resolves them instantly. The cap is far larger than any on-screen window,
// so currently-visible thumbnails are never the ones dropped.
export const THUMB_CACHE_MAX_ENTRIES = 2048;

export function useThumbnailLoader(thumbnailCards: CardRecord[]) {
  const [thumbCache, setThumbCache] = React.useState<Record<string, string>>({});
  const thumbCacheRef = React.useRef<Record<string, string>>({});
  const thumbPendingRef = React.useRef<Set<string>>(new Set());
  // Insertion order of cached keys, used to evict oldest-first (FIFO).
  const thumbOrderRef = React.useRef<string[]>([]);

  React.useEffect(() => {
    thumbCacheRef.current = thumbCache;
  }, [thumbCache]);

  React.useEffect(() => {
    const pendingLoads = thumbnailCards
      .map((card) => {
        const thumbPath = card.thumbnailPath ?? card.imagePath;
        if (!thumbPath || thumbCacheRef.current[card.dataName] || thumbPendingRef.current.has(card.dataName)) {
          return null;
        }
        if (!canInvokeTauri() && !isStaticAssetPath(thumbPath)) return null;
        thumbPendingRef.current.add(card.dataName);
        return readCachedImageDataUrl(thumbPath)
          .then((dataUrl) => ({ dataName: card.dataName, dataUrl }))
          .catch(() => null)
          .finally(() => {
            thumbPendingRef.current.delete(card.dataName);
          });
      })
      .filter((load): load is Promise<{ dataName: string; dataUrl: string } | null> => Boolean(load));

    if (!pendingLoads.length) return;

    let cancelled = false;
    let pendingFrame = 0;
    let loadedThumbs: Array<{ dataName: string; dataUrl: string }> = [];
    const flushLoadedThumbs = () => {
      pendingFrame = 0;
      const nextEntries = loadedThumbs;
      loadedThumbs = [];
      setThumbCache((prev) => {
        let next = prev;
        const order = thumbOrderRef.current;
        for (const entry of nextEntries) {
          if (next[entry.dataName]) continue;
          if (next === prev) next = { ...prev };
          next[entry.dataName] = entry.dataUrl;
          order.push(entry.dataName);
        }
        if (next === prev) return next;
        // Evict oldest entries beyond the cap (FIFO).
        while (order.length > THUMB_CACHE_MAX_ENTRIES) {
          const oldest = order.shift();
          if (oldest !== undefined && oldest in next) delete next[oldest];
        }
        return next;
      });
    };
    const queueLoadedThumb = (entry: { dataName: string; dataUrl: string }) => {
      loadedThumbs.push(entry);
      if (!pendingFrame) pendingFrame = window.requestAnimationFrame(flushLoadedThumbs);
    };

    pendingLoads.forEach((load) => {
      load.then((entry) => {
        if (cancelled || !entry) return;
        queueLoadedThumb(entry);
      });
    });

    return () => {
      cancelled = true;
      if (pendingFrame) window.cancelAnimationFrame(pendingFrame);
    };
  }, [thumbnailCards]);

  return thumbCache;
}
