import { CardRecord } from "./types";

/** Records with a renderer and a complete browser selection path. */
export function isSupportedCardRecord(card: CardRecord) {
  return card.recordType === "Card" ||
    (card.game === "MU3" && card.recordType === "AssetCard");
}
