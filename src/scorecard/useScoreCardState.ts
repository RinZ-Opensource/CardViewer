import React from "react";
import {
  loadStoredRecord,
  readLocalStorage,
  writeLocalStorage,
  writeLocalStorageJson,
} from "../persistence";
import type { ChuniScoreState } from "./chuniTypes";
import type { OngekiScoreState } from "./ongekiTypes";
import { defaultChuniState, defaultOngekiState, defaultState } from "./scorecardDefaults";
import {
  CHUNI_STORAGE_KEY,
  CHUNI_STORAGE_OPTIONS,
  GAMES,
  GAME_STORAGE_KEY,
  MAI_STORAGE_OPTIONS,
  ONGEKI_STORAGE_KEY,
  ONGEKI_STORAGE_OPTIONS,
  SCORE_STORAGE_KEY,
  SHOW_CHUNI_CONFIRMED_START,
  SHOW_PANEL_CARDS,
  type ScoreCardGame,
} from "./scorecardSurfaceConfig";
import type { MaiScoreState } from "./types";

function loadGame(): ScoreCardGame {
  const stored = readLocalStorage(GAME_STORAGE_KEY);
  return GAMES.some((game) => game.key === stored) ? (stored as ScoreCardGame) : "mai";
}

export function useScoreCardState() {
  const [game, setGame] = React.useState<ScoreCardGame>(loadGame);
  const [state, setState] = React.useState<MaiScoreState>(() =>
    loadStoredRecord(SCORE_STORAGE_KEY, defaultState, MAI_STORAGE_OPTIONS),
  );
  const [chuniState, setChuniState] = React.useState<ChuniScoreState>(() => {
    const stored = loadStoredRecord(
      CHUNI_STORAGE_KEY,
      defaultChuniState,
      CHUNI_STORAGE_OPTIONS,
    );
    return {
      ...stored,
      cardType: SHOW_PANEL_CARDS ? stored.cardType : "musicbox",
      confirmed: SHOW_CHUNI_CONFIRMED_START ? stored.confirmed : false,
    };
  });
  const [ongekiState, setOngekiState] = React.useState<OngekiScoreState>(() => {
    const stored = loadStoredRecord(
      ONGEKI_STORAGE_KEY,
      defaultOngekiState,
      ONGEKI_STORAGE_OPTIONS,
    );
    return SHOW_PANEL_CARDS ? stored : { ...stored, cardType: "musicbt" };
  });

  function update<Key extends keyof MaiScoreState>(key: Key, value: MaiScoreState[Key]) {
    setState((current) => ({ ...current, [key]: value }));
  }

  function updateChuni<Key extends keyof ChuniScoreState>(
    key: Key,
    value: ChuniScoreState[Key],
  ) {
    setChuniState((current) => ({ ...current, [key]: value }));
  }

  function updateOngeki<Key extends keyof OngekiScoreState>(
    key: Key,
    value: OngekiScoreState[Key],
  ) {
    setOngekiState((current) => ({ ...current, [key]: value }));
  }

  return {
    game,
    setGame,
    state,
    setState,
    chuniState,
    setChuniState,
    ongekiState,
    setOngekiState,
    update,
    updateChuni,
    updateOngeki,
  };
}

interface PersistScoreCardState {
  game: ScoreCardGame;
  state: MaiScoreState;
  chuniState: ChuniScoreState;
  setChuniState: React.Dispatch<React.SetStateAction<ChuniScoreState>>;
  ongekiState: OngekiScoreState;
}

/** Registers persistence effects at the Surface's original effect position. */
export function usePersistScoreCardState({
  game,
  state,
  chuniState,
  setChuniState,
  ongekiState,
}: PersistScoreCardState) {
  React.useEffect(() => {
    writeLocalStorage(GAME_STORAGE_KEY, game);
  }, [game]);

  React.useEffect(() => {
    writeLocalStorageJson(SCORE_STORAGE_KEY, state);
  }, [state]);

  React.useEffect(() => {
    writeLocalStorageJson(CHUNI_STORAGE_KEY, chuniState);
  }, [chuniState]);

  React.useEffect(() => {
    if (SHOW_CHUNI_CONFIRMED_START || !chuniState.confirmed) return;
    setChuniState((current) =>
      current.confirmed ? { ...current, confirmed: false } : current,
    );
  }, [chuniState.confirmed]);

  React.useEffect(() => {
    writeLocalStorageJson(ONGEKI_STORAGE_KEY, ongekiState);
  }, [ongekiState]);
}
