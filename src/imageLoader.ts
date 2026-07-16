import { invoke } from "@tauri-apps/api/core";
import { canInvokeTauri } from "./constants";
import { LruMap } from "./lru";
import { PriorityTaskScheduler, type TaskPriority } from "./priorityTaskScheduler";

export const IMAGE_LOAD_CONCURRENCY = 3;
export const THUMBNAIL_BUFFER_ROWS = 24;
export type ImageLoadPriority = TaskPriority;
// Bound the data-URL cache so browsing thousands of cards cannot grow memory
// without limit. Count two bytes per JS string character as a conservative
// upper bound; engines may store these ASCII strings more compactly.
export const IMAGE_CACHE_MAX_BYTES = 192 * 1024 * 1024;
export const IMAGE_CACHE_MAX_ENTRIES = 4096;
export const imageDataUrlCache = new LruMap<string, string>({
  maxEntries: IMAGE_CACHE_MAX_ENTRIES,
  maxBytes: IMAGE_CACHE_MAX_BYTES,
  sizeOf: (value) => value.length * 2,
});
export const imageDataUrlPending = new Map<string, Promise<string>>();
const imageDataUrlPromotions = new Map<string, () => boolean>();

const imageLoadScheduler = new PriorityTaskScheduler(IMAGE_LOAD_CONCURRENCY);

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
  if (pending) {
    if (priority === "high") imageDataUrlPromotions.get(path)?.();
    return pending;
  }

  const scheduled = imageLoadScheduler.schedule(() =>
    invoke<string>("read_image_data_url", { path }),
    priority,
  );
  const request = scheduled.promise
    .then((dataUrl) => {
      imageDataUrlCache.set(path, dataUrl);
      return dataUrl;
    })
    .finally(() => {
      imageDataUrlPending.delete(path);
      imageDataUrlPromotions.delete(path);
    });
  imageDataUrlPending.set(path, request);
  imageDataUrlPromotions.set(path, scheduled.promote);
  return request;
}
