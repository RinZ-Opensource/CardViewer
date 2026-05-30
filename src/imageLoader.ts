import { invoke } from "@tauri-apps/api/core";
import { canInvokeTauri } from "./constants";

export const IMAGE_LOAD_CONCURRENCY = 3;
export const THUMBNAIL_BUFFER_ROWS = 24;
export type ImageLoadPriority = "high" | "normal";
export const imageDataUrlCache = new Map<string, string>();
export const imageDataUrlPending = new Map<string, Promise<string>>();
export let activeImageLoads = 0;
export const highPriorityImageLoads: Array<() => void> = [];
export const queuedImageLoads: Array<() => void> = [];

export function scheduleImageLoad<T>(
  task: () => Promise<T>,
  priority: ImageLoadPriority = "normal",
): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeImageLoads += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeImageLoads -= 1;
          runNextImageLoad();
        });
    };

    if (activeImageLoads < IMAGE_LOAD_CONCURRENCY) {
      run();
    } else {
      if (priority === "high") {
        highPriorityImageLoads.push(run);
      } else {
        queuedImageLoads.push(run);
      }
    }
  });
}

export function runNextImageLoad() {
  const next = highPriorityImageLoads.shift() ?? queuedImageLoads.shift();
  next?.();
}

export function isStaticAssetPath(path: string) {
  return (
    path.startsWith("/") ||
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("data:")
  );
}

export function readCachedImageDataUrl(
  path: string,
  priority: ImageLoadPriority = "normal",
): Promise<string> {
  if (isStaticAssetPath(path)) return Promise.resolve(path);
  if (!canInvokeTauri()) return Promise.reject(new Error(`Cannot read local image path: ${path}`));

  const cached = imageDataUrlCache.get(path);
  if (cached) return Promise.resolve(cached);

  const pending = imageDataUrlPending.get(path);
  if (pending) return pending;

  const request = scheduleImageLoad(() =>
    invoke<string>("read_image_data_url", { path }),
    priority,
  )
    .then((dataUrl) => {
      imageDataUrlCache.set(path, dataUrl);
      return dataUrl;
    })
    .finally(() => {
      imageDataUrlPending.delete(path);
    });
  imageDataUrlPending.set(path, request);
  return request;
}

