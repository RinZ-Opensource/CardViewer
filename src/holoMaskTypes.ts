import type {
  TmpHorizontalAlign,
  TmpTextVariant,
  TmpVerticalAlign,
} from "./textRendering";
import type { TmpFontMetrics } from "./types";

export type HoloMaskRenderState = {
  url: string;
  status: "pending" | "ready" | "error";
  error: string;
  warnings: string[];
};

export type HoloMaskImage = {
  href: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  maskMode?: HoloRootMaskMode;
  /** A failed critical source invalidates the generated mask. */
  required?: boolean;
};

export type HoloMaskRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
};

export type HoloTmpTextMask = HoloMaskRect & {
  text: string;
  fontSize: number;
  variant: TmpTextVariant;
  characterSpacing?: number;
  autoSize?: boolean;
  minFontSize?: number;
  horizontalAlign?: TmpHorizontalAlign;
  verticalAlign?: TmpVerticalAlign;
  dilation?: number;
  maskIncludeUnderlay?: boolean;
};

export type HoloMaskMode = "alpha" | "light-or-alpha" | "dark-or-alpha" | "raw";
export type HoloRootMaskMode = HoloMaskMode | "red";

export type HoloCssMaskOptions = {
  fallbackAllowWhenSparse?: boolean;
  invertApplicationArea?: boolean;
};

// Named inputs for the holo mask builder — grouping them (vs ~10 positional args)
// self-documents call sites and removes the signMask/signClear transpose risk.
export type HoloMaskInput = {
  rootImages: HoloMaskImage[];
  frontImages: HoloMaskImage[];
  frontRects: HoloMaskRect[];
  signMaskImages?: HoloMaskImage[];
  signClearImages?: HoloMaskImage[];
  frontTextMasks?: HoloTmpTextMask[];
  excludeImages?: HoloMaskImage[];
  tmpFont?: TmpFontMetrics | null;
  waitingForRequiredResources?: boolean;
  options?: HoloCssMaskOptions;
};
