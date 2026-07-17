import React from "react";
import { buildOrderedAssetLoadPlans, loadFirstAvailable } from "./assetLoading";
import { visibleAssetLayers } from "./cardAssets";
import { isSupportedCardRecord } from "./cardSupport";
import { USE_OFFICIAL_ASSETS } from "./constants";
import { loadOfficialFonts, loadOfficialTmpFont } from "./fonts";
import { isStaticAssetPath, preloadWebImageUrl, resolveWebImageUrl } from "./imageLoader";
import { loadStaticScanResult } from "./manifest";
import { mockScanResult } from "./mockData";
import {
  CardRecord,
  LoadedAssetDataUrls,
  OfficialFontKey,
  ScanResult,
  TmpFontMetrics,
  UnityFontMetrics,
} from "./types";

type LoadedImageDataUrl = {
  path: string;
  dataUrl: string;
};

/** Load the R2-hosted bitmap-font metadata required by the full renderer. */
export function useOfficialFonts() {
  const [officialFonts, setOfficialFonts] = React.useState<
    Partial<Record<OfficialFontKey, UnityFontMetrics>>
  >({});
  const [tmpFont, setTmpFont] = React.useState<TmpFontMetrics | null>(null);

  React.useEffect(() => {
    if (!USE_OFFICIAL_ASSETS) return;
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
  }, []);

  return { officialFonts, tmpFont };
}

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

// Resolves the selected card's primary image to a browser-safe URL. Returns ""
// until it is ready or when the path is not valid in the Web deployment.
export function useSelectedImageDataUrl(selected: CardRecord | null, selectedImagePath: string) {
  const [loadedImageDataUrl, setLoadedImageDataUrl] = React.useState<LoadedImageDataUrl | null>(null);

  React.useEffect(() => {
    if (!selected) {
      setLoadedImageDataUrl(null);
      return;
    }
    if (!selectedImagePath || !isStaticAssetPath(selectedImagePath)) {
      setLoadedImageDataUrl(null);
      return;
    }

    let cancelled = false;
    setLoadedImageDataUrl((prev) => (prev?.path === selectedImagePath ? prev : null));
    resolveWebImageUrl(selectedImagePath)
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

/** Resolve the selected card's manifest-declared R2 layers by semantic key. */
export function useSelectedAssetDataUrls(
  selected: CardRecord | null,
  selectedAssetsSignature: string,
  streamingAssets: string | undefined,
) {
  const [loaded, setLoaded] = React.useState<LoadedAssetDataUrls>({
    signature: "",
    urls: {},
  });

  React.useEffect(() => {
    if (!selected) {
      setLoaded({ signature: "", urls: {} });
      return;
    }

    const controller = new AbortController();
    const layers = visibleAssetLayers(selected, streamingAssets).filter((layer) =>
      isStaticAssetPath(layer.path),
    );
    const plans = buildOrderedAssetLoadPlans(layers);
    setLoaded((current) =>
      current.signature === selectedAssetsSignature
        ? current
        : { signature: selectedAssetsSignature, urls: {} },
    );

    for (const plan of plans) {
      void loadFirstAvailable(
        plan.candidates,
        (candidate) => preloadWebImageUrl(candidate.path, controller.signal),
        () => controller.signal.aborted,
      )
        .then(({ candidate, value: url }) => {
          if (controller.signal.aborted) return;
          setLoaded((current) => {
            if (current.signature !== selectedAssetsSignature) return current;
            if (current.urls[plan.key] === url && current.urls[candidate.key] === url) {
              return current;
            }
            return {
              signature: selectedAssetsSignature,
              urls: {
                ...current.urls,
                [plan.key]: url,
                [candidate.key]: url,
              },
            };
          });
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            console.warn(
              `R2 card layer unavailable: ${plan.candidates.map(({ path }) => path).join(", ")}`,
              error,
            );
          }
        });
    }

    return () => {
      controller.abort();
    };
  }, [selected?.dataName, selectedAssetsSignature]);

  return loaded.signature === selectedAssetsSignature ? loaded.urls : {};
}

// Max resolved thumbnails kept in component state (FIFO).
const THUMB_CACHE_MAX_ENTRIES = 2048;

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
        if (!isStaticAssetPath(thumbPath)) return null;
        thumbPendingRef.current.set(card.dataName, thumbPath);
        return resolveWebImageUrl(thumbPath)
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
