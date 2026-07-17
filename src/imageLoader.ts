export const THUMBNAIL_BUFFER_ROWS = 24;
export type ImageLoadPriority = "high" | "normal";

const R2_ASSET_PREFIXES = [
  "/official/generated/",
  "/official/scorecard/",
  "/official/cardviewer/v1/",
] as const;

function safeR2Pathname(pathname: string) {
  if (!R2_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return false;
  if (pathname.includes("\\") || pathname.includes("%") || pathname.includes("//")) return false;
  return pathname.split("/").every((segment, index) => index < 2 || !segment.startsWith("."));
}

export function isStaticAssetPath(path: string) {
  if (path.startsWith("/")) {
    const pathname = path.split(/[?#]/, 1)[0];
    return safeR2Pathname(pathname);
  }
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(path);
    return url.origin === window.location.origin && safeR2Pathname(url.pathname);
  } catch {
    return false;
  }
}

export function resolveWebImageUrl(path: string): Promise<string> {
  if (isStaticAssetPath(path)) return Promise.resolve(path);
  return Promise.reject(new Error(`Unsupported non-R2 image path: ${path}`));
}

/**
 * Resolve and actually decode a browser image before exposing its URL to a
 * renderer. A syntactically valid same-origin route can still be a missing R2
 * object, so URL validation alone is not enough when ordered fallbacks exist.
 */
export async function preloadWebImageUrl(path: string, signal?: AbortSignal): Promise<string> {
  const url = await resolveWebImageUrl(path);
  if (typeof Image === "undefined") {
    throw new Error("Browser image loading is unavailable.");
  }
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    let settled = false;
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => {
      finish(() => {
        image.removeAttribute("src");
        reject(signal?.reason ?? new DOMException("Image load aborted.", "AbortError"));
      });
    };
    image.onload = () => finish(() => resolve(url));
    image.onerror = () =>
      finish(() => reject(new Error(`R2 image object unavailable: ${url}`)));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    image.src = url;
  });
}
