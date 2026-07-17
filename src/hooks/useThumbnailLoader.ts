import React from "react";
import { isStaticAssetPath, preloadWebImageUrl } from "../imageLoader";
import type { CardRecord } from "../types";

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
        return preloadWebImageUrl(thumbPath)
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
