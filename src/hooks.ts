import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { assetLayerLoadPriority, visibleAssetLayers } from "./cards";
import { maiLinkedPrintEdits } from "./cardData";
import { PLAYER_EDIT_KEYS, SHARED_PLAYER_EDITS_KEY, sharedPlayerEdits } from "./cardEdits";
import { isSupportedCardRecord } from "./cardSupport";
import { DEFAULT_PACKAGE_ROOT, EDIT_STORAGE_KEY, USE_OFFICIAL_ASSETS, canInvokeTauri } from "./constants";
import { loadOfficialFonts, loadOfficialTmpFont } from "./fonts";
import { isStaticAssetPath, readCachedImageDataUrl } from "./imageLoader";
import { loadStaticScanResult } from "./manifest";
import { mockScanResult } from "./mockData";
import { loadStoredCardEdits, writeLocalStorageJson } from "./persistence";
import { CardEdits, CardRecord, LoadedAssetDataUrls, LoadedImageDataUrl, OfficialFontKey, PrintFieldValue, ScanResult, TmpFontMetrics, UnityFontMetrics } from "./types";

// Loads the official Unity + TMP fonts; no-op outside the private deployment.
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
  const [status, setStatus] = React.useState("Ready");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [source, setSource] = React.useState<"loading" | "manifest" | "tauri" | "mock" | "error">("loading");
  const [reloadToken, setReloadToken] = React.useState(0);
  const loadSequenceRef = React.useRef(0);
  const packageRoot = DEFAULT_PACKAGE_ROOT;

  React.useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(""), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  React.useEffect(() => {
    const scanPackage = async () => {
      setError("");
      setLoading(true);
      setSource("loading");
      const tauriAvailable = canInvokeTauri();
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
          setSource("manifest");
          setStatus(`Loaded ${result.cards.length.toLocaleString()} exported records`);
          return;
        } catch (manifestError) {
          if (!tauriAvailable) {
            const result = mockScanResult(packageRoot);
            if (!isCurrentLoad()) return;
            console.warn("Exported manifest unavailable; using bundled samples", manifestError);
            applyScanResult(result);
            setSource("mock");
            setStatus(
              `Manifest unavailable — showing ${result.cards.length.toLocaleString()} bundled sample records`,
            );
            return;
          }
          setStatus("Manifest unavailable; scanning package");
        }

        const result = await invoke<ScanResult>("scan_package", { packageRoot });
        if (!isCurrentLoad()) return;
        applyScanResult(result);
        setSource("tauri");
        setStatus(`Loaded ${result.cards.length.toLocaleString()} records`);
      } catch (err) {
        if (!isCurrentLoad()) return;
        setError(String(err));
        setSource("error");
        setStatus("Scan failed");
      } finally {
        if (isCurrentLoad()) setLoading(false);
      }
    };

    void scanPackage();
  }, [reloadToken, setSelectedId]);

  const retry = React.useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  return { scanResult, status, source, error, setError, loading, retry };
}

// Owns the persisted print-edit state and the mutations against it. Per-card
// edits are keyed by dataName; player-data edits (name / rating / friend code)
// are shared across cards under a single key.
export function useCardEdits() {
  const [edits, setEdits] = React.useState<Record<string, CardEdits>>(() =>
    loadStoredCardEdits(EDIT_STORAGE_KEY),
  );

  React.useEffect(() => {
    writeLocalStorageJson(EDIT_STORAGE_KEY, edits);
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

  const resetPlayerEdits = React.useCallback(() => {
    setEdits((prev) => {
      if (!prev[SHARED_PLAYER_EDITS_KEY]) return prev;
      const next = { ...prev };
      delete next[SHARED_PLAYER_EDITS_KEY];
      return next;
    });
  }, []);

  return { edits, updateCardField, updatePlayerField, resetCardEdits, resetPlayerEdits };
}

// Tracks the card list's scroll position and height (via ResizeObserver) for the
// caller's virtual-window math.
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
    // `selected` intentionally omitted: the effect only reads selectedImagePath
    // (derived from it by the caller), so depending on it adds redundant re-runs.
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
    // `selected` / `streamingAssets` intentionally omitted: both feed
    // selectedAssetsSignature, so any layer-affecting change already re-runs this.
  }, [selected?.dataName, selectedAssetsSignature]);

  return loadedAssetDataUrls.signature === selectedAssetsSignature ? loadedAssetDataUrls.urls : {};
}

// Max decoded thumbnails kept in component state (FIFO); evicted entries remain
// in the LRU imageDataUrlCache, so scrolling back re-resolves instantly.
export const THUMB_CACHE_MAX_ENTRIES = 2048;

type ThumbnailCacheEntry = {
  path: string;
  dataUrl: string;
};

// Loads thumbnails for the given cards, batching state updates per frame and
// de-duplicating in-flight/cached requests.
export function useThumbnailLoader(thumbnailCards: CardRecord[]) {
  const [thumbCache, setThumbCache] = React.useState<Record<string, ThumbnailCacheEntry>>({});
  const thumbCacheRef = React.useRef<Record<string, ThumbnailCacheEntry>>({});
  const thumbPendingRef = React.useRef<Map<string, string>>(new Map());
  // Insertion order of cached keys, used to evict oldest-first (FIFO).
  const thumbOrderRef = React.useRef<string[]>([]);
  const desiredThumbPathsRef = React.useRef<Map<string, string>>(new Map());
  const loadedThumbsRef = React.useRef<Array<ThumbnailCacheEntry & { dataName: string }>>([]);
  const pendingFrameRef = React.useRef(0);
  const mountedRef = React.useRef(false);

  const desiredThumbPaths = React.useMemo(
    () =>
      new Map(
        thumbnailCards.flatMap((card) => {
          const path = card.thumbnailPath ?? card.imagePath;
          return path ? [[card.dataName, path] as const] : [];
        }),
      ),
    [thumbnailCards],
  );

  // Publish only committed paths. Layout effects run before the passive effect
  // below starts loads, while abandoned concurrent renders cannot mutate this ref.
  React.useLayoutEffect(() => {
    desiredThumbPathsRef.current = desiredThumbPaths;
  }, [desiredThumbPaths]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pendingFrameRef.current) {
        window.cancelAnimationFrame(pendingFrameRef.current);
        pendingFrameRef.current = 0;
      }
      loadedThumbsRef.current = [];
    };
  }, []);

  React.useEffect(() => {
    thumbCacheRef.current = thumbCache;
  }, [thumbCache]);

  React.useEffect(() => {
    const pendingLoads = thumbnailCards
      .map((card) => {
        const thumbPath = card.thumbnailPath ?? card.imagePath;
        if (
          !thumbPath ||
          thumbCacheRef.current[card.dataName]?.path === thumbPath ||
          thumbPendingRef.current.get(card.dataName) === thumbPath
        ) {
          return null;
        }
        if (!canInvokeTauri() && !isStaticAssetPath(thumbPath)) return null;
        thumbPendingRef.current.set(card.dataName, thumbPath);
        return readCachedImageDataUrl(thumbPath)
          .then((dataUrl) => ({ dataName: card.dataName, path: thumbPath, dataUrl }))
          .catch(() => null)
          .finally(() => {
            if (thumbPendingRef.current.get(card.dataName) === thumbPath) {
              thumbPendingRef.current.delete(card.dataName);
            }
          });
      })
      .filter(
        (load): load is Promise<(ThumbnailCacheEntry & { dataName: string }) | null> => Boolean(load),
      );

    if (!pendingLoads.length) return;

    const flushLoadedThumbs = () => {
      pendingFrameRef.current = 0;
      if (!mountedRef.current) {
        loadedThumbsRef.current = [];
        return;
      }
      const nextEntries = loadedThumbsRef.current;
      loadedThumbsRef.current = [];
      setThumbCache((prev) => {
        let next = prev;
        const order = thumbOrderRef.current;
        for (const entry of nextEntries) {
          if (desiredThumbPathsRef.current.get(entry.dataName) !== entry.path) continue;
          if (next[entry.dataName]?.path === entry.path) continue;
          if (next === prev) next = { ...prev };
          next[entry.dataName] = { path: entry.path, dataUrl: entry.dataUrl };
          const existingIndex = order.indexOf(entry.dataName);
          if (existingIndex >= 0) order.splice(existingIndex, 1);
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
    const queueLoadedThumb = (entry: ThumbnailCacheEntry & { dataName: string }) => {
      if (
        !mountedRef.current ||
        desiredThumbPathsRef.current.get(entry.dataName) !== entry.path
      ) {
        return;
      }
      loadedThumbsRef.current.push(entry);
      if (!pendingFrameRef.current) {
        pendingFrameRef.current = window.requestAnimationFrame(flushLoadedThumbs);
      }
    };

    pendingLoads.forEach((load) => {
      load.then((entry) => {
        if (!entry) return;
        queueLoadedThumb(entry);
      });
    });
  }, [thumbnailCards]);

  return React.useMemo(() => {
    const urls: Record<string, string> = {};
    thumbnailCards.forEach((card) => {
      const path = card.thumbnailPath ?? card.imagePath;
      const cached = thumbCache[card.dataName];
      if (path && cached?.path === path) urls[card.dataName] = cached.dataUrl;
    });
    return urls;
  }, [thumbCache, thumbnailCards]);
}
