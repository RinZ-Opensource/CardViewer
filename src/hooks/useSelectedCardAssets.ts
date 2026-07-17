import React from "react";
import { buildOrderedAssetLoadPlans, loadFirstAvailable } from "../assetLoading";
import { visibleAssetLayers } from "../cardAssets";
import { isStaticAssetPath, preloadWebImageUrl } from "../imageLoader";
import type { CardRecord, LoadedAssetDataUrls } from "../types";

type LoadedImageDataUrl = {
  path: string;
  dataUrl: string;
};

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

    const controller = new AbortController();
    setLoadedImageDataUrl((prev) => (prev?.path === selectedImagePath ? prev : null));
    preloadWebImageUrl(selectedImagePath, controller.signal)
      .then((dataUrl) => {
        if (!controller.signal.aborted) {
          setLoadedImageDataUrl({ path: selectedImagePath, dataUrl });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadedImageDataUrl(null);
      });

    return () => {
      controller.abort();
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
