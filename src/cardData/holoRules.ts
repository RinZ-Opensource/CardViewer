import { HOLO_ENABLED } from "../constants";
import type { CardRecord } from "../types";
import { fieldBool, numericField } from "./fields";

export function officialHolo(card: CardRecord) {
  if (!HOLO_ENABLED) return false;
  if (card.game === "CHU") return false;
  if (card.game === "MAI") return maiOfficialHolo(card);
  return fieldBool(card, "holo");
}

export function maiOfficialHolo(card: CardRecord) {
  if (card.printFields.some((field) => field.key === "holo")) {
    return fieldBool(card, "holo");
  }
  return [4, 6].includes(numericField(card, "typeId", -1));
}
