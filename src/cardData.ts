import { CardRecord } from "./types";

export function fieldString(card: CardRecord, key: string) {
  return card.printFields.find((field) => field.key === key)?.value.trim() ?? "";
}

function fieldBool(card: CardRecord, key: string) {
  return card.printFields.find((field) => field.key === key)?.value === "true";
}

function numericField(card: CardRecord, key: string, fallback: number) {
  const raw = fieldString(card, key);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function officialHolo(card: CardRecord) {
  if (card.game === "CHU") return false;
  if (card.game === "MAI") {
    if (card.printFields.some((field) => field.key === "holo")) {
      return fieldBool(card, "holo");
    }
    return [4, 6].includes(numericField(card, "typeId", -1));
  }
  return fieldBool(card, "holo");
}

export function mu3RarityKind(card: CardRecord) {
  const rare = numericField(card, "rareType", card.rareType ?? 0);
  if (rare === 1) return "R";
  if (rare === 2) return "SR";
  if (rare === 3) return "SSR";
  if (rare === 12) return "SRPlus";
  return "N";
}
