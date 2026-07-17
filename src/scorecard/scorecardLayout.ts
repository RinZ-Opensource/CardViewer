import type { ChuniCardType } from "./chuniTypes";
import type { OngekiCardType } from "./ongekiTypes";

export type ScorecardDesignSize = Readonly<{
  width: number;
  height: number;
}>;

type ScorecardDesignSizeTable = {
  readonly mai: ScorecardDesignSize;
  readonly chuni: Readonly<Record<ChuniCardType, ScorecardDesignSize>>;
  readonly ongeki: Readonly<Record<OngekiCardType, ScorecardDesignSize>>;
};

/** Design-space dimensions shared by the preview fitter and renderer CSS. */
export const SCORECARD_DESIGN_SIZES = {
  mai: { width: 420, height: 690 },
  chuni: {
    panel: { width: 586, height: 182 },
    musicbox: { width: 454, height: 610 },
  },
  ongeki: {
    panel: { width: 310, height: 162 },
    musicbt: { width: 310, height: 496 },
  },
} as const satisfies ScorecardDesignSizeTable;

export type ScorecardLayoutSelection =
  | { readonly game: "mai" }
  | { readonly game: "chuni"; readonly cardType: ChuniCardType }
  | { readonly game: "ongeki"; readonly cardType: OngekiCardType };

/** Return the stable design-size object for the active score-card variant. */
export function scorecardDesignSize(
  selection: ScorecardLayoutSelection,
): ScorecardDesignSize {
  switch (selection.game) {
    case "mai":
      return SCORECARD_DESIGN_SIZES.mai;
    case "chuni":
      return SCORECARD_DESIGN_SIZES.chuni[selection.cardType];
    case "ongeki":
      return SCORECARD_DESIGN_SIZES.ongeki[selection.cardType];
  }
}
