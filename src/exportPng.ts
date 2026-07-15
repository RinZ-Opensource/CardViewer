import { toPng } from "html-to-image";

const EXPORT_READY_TIMEOUT_MS = 15_000;

function waitForPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function waitForDelay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

async function waitForFonts(timeoutMs: number) {
  if (!("fonts" in document)) return;
  await Promise.race([
    document.fonts.ready,
    new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error("Timed out while loading card fonts.")), timeoutMs),
    ),
  ]);
}

function imageLabel(image: HTMLImageElement) {
  if (image.alt) return image.alt;
  const source = image.currentSrc || image.src;
  if (!source || source.startsWith("data:")) return "embedded image";
  try {
    return new URL(source, window.location.href).pathname.split("/").pop() || "image";
  } catch {
    return "image";
  }
}

async function waitForImage(image: HTMLImageElement, timeoutMs: number) {
  const deadline = performance.now() + timeoutMs;

  while (performance.now() < deadline) {
    const observedSource = image.currentSrc || image.src;
    if (!image.complete) {
      const outcome = await new Promise<"load" | "error">((resolve, reject) => {
        const cleanup = () => {
          window.clearTimeout(timer);
          image.removeEventListener("load", onLoad);
          image.removeEventListener("error", onError);
        };
        const onLoad = () => {
          cleanup();
          resolve("load");
        };
        const onError = () => {
          cleanup();
          resolve("error");
        };
        const timer = window.setTimeout(() => {
          cleanup();
          reject(new Error(`Timed out while loading ${imageLabel(image)}.`));
        }, Math.max(1, deadline - performance.now()));
        image.addEventListener("load", onLoad, { once: true });
        image.addEventListener("error", onError, { once: true });
      });

      if (outcome === "error") {
        // An image's own error handler may swap to a fallback source. Let that
        // handler and the following React update settle before deciding that
        // the layer is irrecoverably broken.
        await waitForDelay(0);
      }
    }

    if (image.complete && image.naturalWidth > 0) {
      if (typeof image.decode === "function") {
        try {
          await image.decode();
        } catch {
          // Some browsers reject decode() for an image that is already decoded.
          // naturalWidth is the reliable final check for export readiness.
          if (image.naturalWidth === 0) {
            throw new Error(`Failed to decode ${imageLabel(image)}.`);
          }
        }
      }
      return;
    }

    const nextSource = image.currentSrc || image.src;
    if (nextSource === observedSource && image.complete) {
      throw new Error(`Failed to load ${imageLabel(image)}.`);
    }
  }

  throw new Error(`Timed out while loading ${imageLabel(image)}.`);
}

/**
 * Wait for every async renderer and image inside a card before html-to-image
 * clones the DOM. Canvas/QR components expose their state through
 * `data-export-state`; regular images are decoded here.
 */
export async function waitForExportReady(
  target: HTMLElement,
  timeoutMs = EXPORT_READY_TIMEOUT_MS,
) {
  const deadline = performance.now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - performance.now());

  await waitForFonts(remaining());

  while (true) {
    const failed = target.querySelector<HTMLElement>('[data-export-state="error"]');
    if (failed) {
      throw new Error(failed.dataset.exportError || "A card layer failed to render.");
    }

    const pending = target.querySelector('[data-export-state="pending"]');
    if (!pending) break;
    if (performance.now() >= deadline) {
      throw new Error("Timed out while rendering card layers.");
    }
    await waitForDelay(Math.min(40, remaining()));
  }

  await Promise.all(
    Array.from(target.querySelectorAll("img")).map((image) =>
      waitForImage(image, remaining()),
    ),
  );
  await waitForPaint();

  // Async renderers such as QR can insert an image on their final update.
  await Promise.all(
    Array.from(target.querySelectorAll("img")).map((image) =>
      waitForImage(image, remaining()),
    ),
  );
}

/**
 * Rasterize a DOM node to a PNG data URL at its native design width.
 */
export async function renderNodeToPng(target: HTMLElement, nativeWidth: number) {
  await waitForExportReady(target);
  const width = target.offsetWidth || nativeWidth;
  const pixelRatio = Math.min(4, Math.max(1, nativeWidth / width));
  return toPng(target, {
    pixelRatio,
    // Keep the card art + holo overlay, drop the soft edge-light glow.
    filter: (node) =>
      !(node instanceof HTMLElement && node.classList.contains("edge-light")),
  });
}

/**
 * Rasterize a DOM node to PNG at its native design width and trigger a
 * download. Shared by the card viewer and the score-card surface.
 */
export async function exportNodeAsPng(
  target: HTMLElement,
  baseName: string,
  nativeWidth: number,
) {
  const dataUrl = await renderNodeToPng(target, nativeWidth);
  const safeName =
    baseName
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/[.\s]+$/, "")
      .trim() || "card";
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = `${safeName}.png`;
  anchor.click();
}
