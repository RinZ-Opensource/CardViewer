import { toPng } from "html-to-image";

/**
 * Rasterize a DOM node to a PNG data URL at its native design width.
 */
export async function renderNodeToPng(target: HTMLElement, nativeWidth: number) {
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
