import React from "react";
import {
  CardEditStore,
  PLAYER_EDIT_KEYS,
  SHARED_PLAYER_EDITS_KEY,
  maiLinkedPrintEdits,
  parseStoredCardEdits,
  sharedPlayerEdits,
} from "./cardEdits";
import { readLocalStorage, writeLocalStorageJson } from "./persistence";
import type { CardEdits, CardRecord, PrintFieldValue } from "./types";

export const CARD_EDIT_STORAGE_KEY = "configarc-card-viewer.print-edits";

/** Owns browser-local print overrides; no private assets or desktop APIs. */
export function useCardEdits() {
  const [edits, setEdits] = React.useState<CardEditStore>(() =>
    parseStoredCardEdits(readLocalStorage(CARD_EDIT_STORAGE_KEY)),
  );

  React.useEffect(() => {
    writeLocalStorageJson(CARD_EDIT_STORAGE_KEY, edits);
  }, [edits]);

  const updateCardField = React.useCallback(
    (card: CardRecord, fieldKey: string, value: PrintFieldValue) => {
      setEdits((current) => ({
        ...current,
        [card.dataName]: {
          ...current[card.dataName],
          ...maiLinkedPrintEdits(card, fieldKey, value),
        },
      }));
    },
    [],
  );

  const updatePlayerField = React.useCallback(
    (fieldKey: string, value: PrintFieldValue) => {
      if (!PLAYER_EDIT_KEYS.has(fieldKey)) return;
      setEdits((current) => movePlayerEdit(current, fieldKey, value));
    },
    [],
  );

  return { edits, updateCardField, updatePlayerField };
}

function movePlayerEdit(
  current: CardEditStore,
  fieldKey: string,
  value: PrintFieldValue,
): CardEditStore {
  const next: CardEditStore = {
    ...current,
    [SHARED_PLAYER_EDITS_KEY]: {
      ...sharedPlayerEdits(current),
      [fieldKey]: value,
    },
  };

  // Migrate stale values written by the former per-card editor format.
  for (const [key, cardEdits] of Object.entries(current)) {
    if (key === SHARED_PLAYER_EDITS_KEY || cardEdits[fieldKey] === undefined) continue;
    const cleaned: CardEdits = { ...cardEdits };
    delete cleaned[fieldKey];
    if (Object.keys(cleaned).length === 0) delete next[key];
    else next[key] = cleaned;
  }

  return next;
}
