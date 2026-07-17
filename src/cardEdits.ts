import type { CardEdits, CardRecord, PrintField, PrintFieldValue } from "./types";

export type CardEditStore = Record<string, CardEdits>;

// Player identity belongs to the browser session rather than an individual
// card. Keeping it under one reserved key makes switching cards predictable.
export const SHARED_PLAYER_EDITS_KEY = "__playerData";
export const PLAYER_EDIT_KEYS = new Set(["userName", "rating", "friendCode"]);

const DISPLAY_NAME_FIELD_KEYS = ["characterName", "charaName", "userName"];

export function randomDigitString(length: number) {
  const digits = new Uint8Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(digits);
  } else {
    for (let index = 0; index < digits.length; index += 1) {
      digits[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(digits, (value) => String(value % 10)).join("");
}

/** Return a render-ready copy of a manifest record with browser edits applied. */
export function applyEdits(card: CardRecord, edits?: CardEdits): CardRecord {
  if (!edits || Object.keys(edits).length === 0) return card;
  const editedPrintFields = Object.keys(edits);
  const printFields = card.printFields.map((field) => {
    const value = edits[field.key];
    return value === undefined ? field : { ...field, value: String(value) };
  });
  const printedName = firstPrintedValue(printFields, DISPLAY_NAME_FIELD_KEYS);
  return {
    ...card,
    printFields,
    editedPrintFields,
    displayName: printedName || card.displayName,
  };
}

/** Keep MAI character identity fields consistent when its selector changes. */
export function maiLinkedPrintEdits(
  card: CardRecord,
  fieldKey: string,
  value: PrintFieldValue,
): CardEdits {
  const edits: CardEdits = { [fieldKey]: value };
  if (card.game !== "MAI" || fieldKey !== "charaId") return edits;

  const choices = fieldString(card, "charaChoices")
    .split(/\r?\n/)
    .map((line) => {
      const [idText, mapText, uniqueText, ...nameParts] = line.split("|");
      const id = Number(idText);
      const mapId = Number(mapText);
      const uniqueId = Number(uniqueText);
      if (!Number.isFinite(id) || !Number.isFinite(mapId) || !Number.isFinite(uniqueId)) return null;
      return { id, mapId, uniqueId, name: nameParts.join("|") || String(id) };
    });
  const choice = choices.find((candidate) => candidate?.id === Number(value));
  if (!choice) return edits;

  edits.mapId = String(choice.mapId);
  edits.uniqueId = String(choice.uniqueId);
  edits.charaName = choice.name;
  const currentVersion = fieldString(card, "verCharaId");
  const prefix = currentVersion.replace(/-\d+$/, "") || "[maimaiDX]";
  edits.verCharaId = `${prefix}-${String(choice.uniqueId).padStart(4, "0")}`;
  return edits;
}

export function firstPrintedValue(fields: PrintField[], keys: string[]) {
  for (const key of keys) {
    const value = fields.find((field) => field.key === key)?.value.trim();
    if (value) return value;
  }
  return "";
}

export function sharedPlayerEdits(edits: CardEditStore): CardEdits {
  return edits[SHARED_PLAYER_EDITS_KEY] ?? {};
}

export function effectiveCardEdits(edits: CardEditStore, card: CardRecord): CardEdits {
  return {
    ...(edits[card.dataName] ?? {}),
    ...sharedPlayerEdits(edits),
  };
}

/** Parse the persisted nested edit map without trusting arbitrary JSON. */
export function parseStoredCardEdits(raw: string | null): CardEditStore {
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};

  const edits: CardEditStore = Object.create(null) as CardEditStore;
  for (const [cardKey, candidate] of Object.entries(parsed)) {
    if (!isRecord(candidate)) continue;
    const cardEdits: CardEdits = Object.create(null) as CardEdits;
    for (const [fieldKey, value] of Object.entries(candidate)) {
      if (typeof value === "string" || typeof value === "boolean") {
        cardEdits[fieldKey] = value;
      }
    }
    if (Object.keys(cardEdits).length > 0) edits[cardKey] = cardEdits;
  }
  return edits;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldString(card: CardRecord, key: string) {
  return card.printFields.find((field) => field.key === key)?.value.trim() ?? "";
}
