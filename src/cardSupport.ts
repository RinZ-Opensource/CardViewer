import { CardRecord } from "./types";

/** Records with a renderer and a complete selection/edit/export path. */
export function isSupportedCardRecord(card: CardRecord) {
  return card.recordType === "Card" ||
    (card.game === "MU3" && card.recordType === "AssetCard");
}
