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

// Facet dropdowns per game: each is a filter key + its display label (also used
// as the placeholder). The option list is derived from the cards at build time.
const GAME_FACETS: Record<string, Array<{ key: string; label: string }>> = {
  MAI: [
    { key: "mai.type", label: "Type" },
    { key: "mai.character", label: "Character" },
    { key: "mai.version", label: "Version" },
  ],
  MU3: [
    { key: "mu3.rarity", label: "Rarity" },
    { key: "mu3.character", label: "Character" },
    { key: "mu3.version", label: "Version" },
  ],
};

export function buildFilterConfig(
  cards: CardRecord[],
  edits: Record<string, CardEdits>,
  activeFilters: Record<string, string>,
): CardFilterConfig[] {
  const games = uniqueOptions(cards.map((card) => card.game));
  const filters: CardFilterConfig[] = [];
  const selectedGame = activeFilters.game || (games[0]?.value ?? "");
  const facets = GAME_FACETS[selectedGame];
  if (!facets) return filters;

  // Merge each card's edits once, then derive every facet's options from the
  // merged cards (instead of re-running applyEdits per card per facet).
  const mergedGameCards = cards
    .filter((card) => card.game === selectedGame)
    .map((card) => applyEdits(card, effectiveCardEdits(edits, card)));
  for (const facet of facets) {
    pushFilter(
      filters,
      facet.key,
      facet.label,
      facet.label,
      uniqueOptions(mergedGameCards.map((card) => mergedCardFilterValue(card, facet.key))),
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
  const merged = applyEdits(card, edits);
  for (const [key, expected] of Object.entries(filters)) {
    if (!expected) continue;
    if (mergedCardFilterValue(merged, key) !== expected) return false;
  }
  return true;
}

function mergedCardFilterValue(merged: CardRecord, key: string) {
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

// Card frame tiers by in-game typeId (5 is unused / has no distinct frame).
const MAI_TYPE_NAMES: Record<string, string> = {
  "2": "Bronze",
  "3": "Silver",
  "4": "Gold",
  "6": "Freedom",
};

function maiTypeName(typeId: string) {
  const id = typeId.trim();
  if (!id) return "";
  return MAI_TYPE_NAMES[id] ?? `Type ${id}`;
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
