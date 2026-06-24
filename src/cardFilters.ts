import { applyEdits, fieldString, mu3RarityKind } from "./cardData";
import { effectiveCardEdits } from "./cardEdits";
import { CardEdits, CardRecord } from "./types";

export type FilterOption = {
  value: string;
  label: string;
};

export type CardFilterConfig = {
  key: string;
  label: string;
  placeholder: string;
  options: FilterOption[];
};

export function buildFilterConfig(
  cards: CardRecord[],
  edits: Record<string, CardEdits>,
  activeFilters: Record<string, string>,
): CardFilterConfig[] {
  const games = uniqueOptions(cards.map((card) => card.game));
  const filters: CardFilterConfig[] = [];
  const selectedGame = activeFilters.game || (games[0]?.value ?? "");

  if (selectedGame === "MAI") {
    const maiCards = cards.filter((card) => card.game === "MAI");
    pushFilter(
      filters,
      "mai.type",
      "Type",
      "Type",
      uniqueOptions(maiCards.map((card) => cardFilterValue(card, effectiveCardEdits(edits, card), "mai.type"))),
    );
    pushFilter(
      filters,
      "mai.character",
      "Character",
      "Character",
      uniqueOptions(maiCards.map((card) => cardFilterValue(card, effectiveCardEdits(edits, card), "mai.character"))),
    );
    pushFilter(
      filters,
      "mai.version",
      "Version",
      "Version",
      uniqueOptions(maiCards.map((card) => cardFilterValue(card, effectiveCardEdits(edits, card), "mai.version"))),
    );
  }

  if (selectedGame === "MU3") {
    const mu3Cards = cards.filter((card) => card.game === "MU3");
    pushFilter(
      filters,
      "mu3.rarity",
      "Rarity",
      "Rarity",
      uniqueOptions(mu3Cards.map((card) => cardFilterValue(card, effectiveCardEdits(edits, card), "mu3.rarity"))),
    );
    pushFilter(
      filters,
      "mu3.character",
      "Character",
      "Character",
      uniqueOptions(mu3Cards.map((card) => cardFilterValue(card, effectiveCardEdits(edits, card), "mu3.character"))),
    );
    pushFilter(
      filters,
      "mu3.version",
      "Version",
      "Version",
      uniqueOptions(mu3Cards.map((card) => cardFilterValue(card, effectiveCardEdits(edits, card), "mu3.version"))),
    );
  }

  return filters;
}

function pushFilter(filters: CardFilterConfig[], key: string, label: string, placeholder: string, options: FilterOption[]) {
  if (options.length <= 1) return;
  filters.push({ key, label, placeholder, options });
}

export function uniqueOptions(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  for (const raw of values) {
    const value = raw?.trim();
    if (!value) continue;
    seen.add(value);
  }
  return Array.from(seen)
    .sort(naturalCompare)
    .map((value) => ({ value, label: value }));
}

function naturalCompare(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

export function cardMatchesFilters(card: CardRecord, edits: CardEdits | undefined, filters: Record<string, string>) {
  for (const [key, expected] of Object.entries(filters)) {
    if (!expected) continue;
    if (cardFilterValue(card, edits, key) !== expected) return false;
  }
  return true;
}

function cardFilterValue(card: CardRecord, edits: CardEdits | undefined, key: string) {
  const merged = applyEdits(card, edits);
  switch (key) {
    case "game":
      return merged.game;
    case "mai.type":
      return maiTypeName(fieldString(merged, "typeId"));
    case "mai.character":
      return firstCardField(merged, ["charaName", "characterName"]) || merged.characterName || merged.displayName;
    case "mai.version":
      return normalizedVersion(firstCardField(merged, ["verCharaId", "version", "versionId", "releaseVersion"]));
    case "mu3.rarity":
      return mu3RarityKind(merged);
    case "mu3.character":
      return firstCardField(merged, ["baseCharacterName", "characterName", "nameForCommonModel"]) || merged.characterName || merged.displayName;
    case "mu3.version":
      return normalizedVersion(firstCardField(merged, ["cardNo", "version", "versionId", "releaseVersion", "verCharaId"]));
    default:
      return "";
  }
}

function firstCardField(card: CardRecord, keys: string[]) {
  for (const key of keys) {
    const value = fieldString(card, key);
    if (value) return value;
  }
  return "";
}

function maiTypeName(typeId: string) {
  switch (typeId.trim()) {
    case "2":
      return "Bronze";
    case "3":
      return "Silver";
    case "4":
      return "Gold";
    case "6":
      return "Freedom";
    case "":
      return "";
    default:
      return `Type ${typeId.trim()}`;
  }
}

function normalizedVersion(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const numberedCardVersion = trimmed.match(/^(.+)-\d+$/);
  if (numberedCardVersion) return numberedCardVersion[1];
  const numericVersion = trimmed.match(/^([A-Za-z]*\s*\d+(?:\.\d+){1,3})/);
  if (numericVersion) return numericVersion[1].trim();
  return trimmed;
}
