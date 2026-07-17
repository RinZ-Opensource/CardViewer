export { clampNumber } from "./numeric";

export { clearCanvas, getPixelRatio } from "./textRendering/shared";

export {
  drawCanvasLine,
  measureCanvasLine,
  renderCanvasText,
  waitForCanvasFont,
} from "./textRendering/canvasText";

export {
  TMP_GLYPH_CANVAS_CACHE_MAX,
  TMP_GLYPH_CANVAS_CACHE_MAX_BYTES,
  TMP_TEXT_PADDING,
  canvasAlphaBounds,
  drawTmpRun,
  loadTmpAtlas,
  measureTmpLine,
  rasterizeTmpText,
  renderTmpGlyphCanvas,
  renderTmpText,
  smoothAlpha,
  tmpAtlasCache,
  tmpGlyph,
  tmpGlyphCanvasCache,
  tmpSdfAlpha,
} from "./textRendering/tmpText";

export type {
  RasterizedTextLayer,
  TmpHorizontalAlign,
  TmpTextRenderOptions,
  TmpTextVariant,
  TmpVerticalAlign,
} from "./textRendering/tmpText";

export { reactText } from "./textRendering/reactText";

export {
  layoutUnityText,
  layoutUnityTextPixels,
  unityGlyph,
} from "./textRendering/unityText";

export type { UnityTextGlyphLayout } from "./textRendering/unityText";
