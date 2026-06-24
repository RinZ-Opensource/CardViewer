import { CardEdits, CardRecord } from "./types";

// Player-data edits (name / rating / friend code) are shared across every card
// under this single key rather than stored per card.
export const SHARED_PLAYER_EDITS_KEY = "__playerData";
export const PLAYER_EDIT_KEYS = new Set(["userName", "rating", "friendCode"]);

export function sharedPlayerEdits(edits: Record<string, CardEdits>) {
  return edits[SHARED_PLAYER_EDITS_KEY] ?? {};
}

// A card's own edits merged with the shared player-data edits.
export function effectiveCardEdits(edits: Record<string, CardEdits>, card: CardRecord) {
  return {
    ...(edits[card.dataName] ?? {}),
    ...sharedPlayerEdits(edits),
  };
}
