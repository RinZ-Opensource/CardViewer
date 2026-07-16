import React from "react";
import {
  CHUNI_MUSICBOX_HEIGHT,
  CHUNI_MUSICBOX_WIDTH,
} from "./ChuniMusicBoxCard";
import {
  CHUNI_SCORECARD_HEIGHT,
  CHUNI_SCORECARD_WIDTH,
} from "./ChuniScoreCard";
import { ChuniScoreCardEditor } from "./ChuniScoreCardEditor";
import {
  MAI_SCORECARD_HEIGHT,
  MAI_SCORECARD_WIDTH,
} from "./MaiScoreCard";
import { MaiScoreCardEditor } from "./MaiScoreCardEditor";
import {
  ONGEKI_MUSICBT_HEIGHT,
  ONGEKI_MUSICBT_WIDTH,
} from "./OngekiMusicBtCard";
import {
  ONGEKI_SCORECARD_HEIGHT,
  ONGEKI_SCORECARD_WIDTH,
} from "./OngekiScoreCard";
import { OngekiScoreCardEditor } from "./OngekiScoreCardEditor";
import { ScoreCardPreview } from "./ScoreCardPreview";
import { CHUNI_SAMPLE_SONGS } from "./chuniSamples";
import { ChuniCardType, ChuniDifficulty, ChuniSong } from "./chuniTypes";
import { ONGEKI_SAMPLE_SONGS } from "./ongekiSamples";
import { OngekiCardType, OngekiDifficulty, OngekiSong } from "./ongekiTypes";
import { defaultChuniState, defaultOngekiState, defaultState } from "./scorecardDefaults";
import {
  GAMES,
  SCORECARD_ASSET_SENTINEL,
  SHOW_SCORECARD_RESET,
  type ScoreCardGame,
} from "./scorecardSurfaceConfig";
import { MAI_SAMPLE_SONGS } from "./sampleSongs";
import {
  createChuniDifficultySelection,
  createChuniSongSelection,
  createMaiDifficultySelection,
  createMaiSongSelection,
  createOngekiDifficultySelection,
  createOngekiSongSelection,
  migrateChuniStateToSongDb,
  migrateMaiStateToSongDb,
  migrateOngekiStateToSongDb,
} from "./scorecardSelection";
import { MaiDifficulty, MaiScoreState, MaiSong } from "./types";
import { useScoreCardSongDb } from "./useScoreCardSongDb";
import { usePersistScoreCardState, useScoreCardState } from "./useScoreCardState";

/** Active card design-space size; the stage auto-fit zoom uses this. */
function designSize(
  game: ScoreCardGame,
  chuniCard: ChuniCardType,
  ongekiCard: OngekiCardType,
): { width: number; height: number } {
  if (game === "mai") return { width: MAI_SCORECARD_WIDTH, height: MAI_SCORECARD_HEIGHT };
  if (game === "chuni") {
    return chuniCard === "musicbox"
      ? { width: CHUNI_MUSICBOX_WIDTH, height: CHUNI_MUSICBOX_HEIGHT }
      : { width: CHUNI_SCORECARD_WIDTH, height: CHUNI_SCORECARD_HEIGHT };
  }
  return ongekiCard === "musicbt"
    ? { width: ONGEKI_MUSICBT_WIDTH, height: ONGEKI_MUSICBT_HEIGHT }
    : { width: ONGEKI_SCORECARD_WIDTH, height: ONGEKI_SCORECARD_HEIGHT };
}

export function ScoreCardSurface() {
  const {
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
  } = useScoreCardState();
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const [stageScale, setStageScale] = React.useState(1);
  const [assetStatus, setAssetStatus] = React.useState<"checking" | "ready" | "error">(
    "checking",
  );

  React.useEffect(() => {
    let active = true;
    const sentinel = new Image();
    setAssetStatus("checking");
    sentinel.onload = () => {
      if (active) setAssetStatus("ready");
    };
    sentinel.onerror = () => {
      if (active) setAssetStatus("error");
    };
    sentinel.src = SCORECARD_ASSET_SENTINEL[game];
    return () => {
      active = false;
      sentinel.onload = null;
      sentinel.onerror = null;
    };
  }, [game]);

  const { songDb, retrySongDb } = useScoreCardSongDb(game);

  function resetCurrentCard() {
    if (game === "mai") {
      setState(defaultState());
    } else if (game === "chuni") {
      setChuniState(defaultChuniState());
    } else {
      setOngekiState(defaultOngekiState());
    }
  }

  const design = designSize(game, chuniState.cardType, ongekiState.cardType);

  React.useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fit = () => {
      const rect = stage.getBoundingClientRect();
      setStageScale(
        Math.max(
          0.28,
          Math.min((rect.width - 48) / design.width, (rect.height - 48) / design.height, 2.4),
        ),
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [game, design.width, design.height]);

  usePersistScoreCardState({ game, state, chuniState, setChuniState, ongekiState });

  // Dev-only state hook used by visual checks from the console.
  React.useEffect(() => {
    if (!import.meta.env.DEV) return;
    const scope = window as unknown as Record<string, unknown>;
    scope.__setScorecardState = (next: MaiScoreState) =>
      setState((current) => ({ ...current, ...next }));
    return () => {
      delete scope.__setScorecardState;
    };
  }, []);

  // Active song list: DB when loaded, bundled samples otherwise. Selection
  // also falls back to the samples so a stored sample songId keeps working
  // after the DB lands.
  const maiSongs = songDb.mai.status === "ready" ? songDb.mai.songs : MAI_SAMPLE_SONGS;
  const song =
    (state.songDbBacked ? maiSongs.find((entry) => entry.id === state.songId) : undefined) ??
    MAI_SAMPLE_SONGS.find((entry) => entry.id === state.songId) ??
    maiSongs.find((entry) => entry.id === state.songId) ??
    maiSongs[0] ??
    MAI_SAMPLE_SONGS[0];
  const chart =
    song?.charts.find((entry) => entry.difficulty === state.difficulty) ??
    song?.charts[song.charts.length - 1];
  const maxDxScore = Math.min(
    99_999,
    Math.max(0, Number.parseInt(state.dxScoreMax, 10) || chart?.maxDxScore || 0),
  );
  const chuniSongs = songDb.chuni.status === "ready" ? songDb.chuni.songs : CHUNI_SAMPLE_SONGS;
  const chuniSong =
    (chuniState.songDbBacked
      ? chuniSongs.find((entry) => entry.id === chuniState.songId)
      : undefined) ??
    CHUNI_SAMPLE_SONGS.find((entry) => entry.id === chuniState.songId) ??
    chuniSongs.find((entry) => entry.id === chuniState.songId) ??
    chuniSongs[0] ??
    CHUNI_SAMPLE_SONGS[0];
  const ongekiSongs =
    songDb.ongeki.status === "ready" ? songDb.ongeki.songs : ONGEKI_SAMPLE_SONGS;
  const ongekiSong =
    (ongekiState.songDbBacked
      ? ongekiSongs.find((entry) => entry.id === ongekiState.songId)
      : undefined) ??
    ONGEKI_SAMPLE_SONGS.find((entry) => entry.id === ongekiState.songId) ??
    ongekiSongs.find((entry) => entry.id === ongekiState.songId) ??
    ongekiSongs[0] ??
    ONGEKI_SAMPLE_SONGS[0];

  // Bundled entries are an offline/loading fallback, not a sticky choice.
  // Once the complete DB arrives, migrate an old/sample selection to its
  // real row (matching by printed identity where local ids are placeholders).
  React.useEffect(() => {
    if (songDb.mai.status !== "ready" || songDb.mai.songs.length === 0) return;
    setState((current) => migrateMaiStateToSongDb(current, songDb.mai.songs));
  }, [songDb.mai]);

  React.useEffect(() => {
    if (songDb.chuni.status !== "ready" || songDb.chuni.songs.length === 0) return;
    setChuniState((current) => migrateChuniStateToSongDb(current, songDb.chuni.songs));
  }, [songDb.chuni]);

  React.useEffect(() => {
    if (songDb.ongeki.status !== "ready" || songDb.ongeki.songs.length === 0) return;
    setOngekiState((current) => migrateOngekiStateToSongDb(current, songDb.ongeki.songs));
  }, [songDb.ongeki]);

  // Song/difficulty selection (re-)applies the chart-derived fields; manual
  // edits made afterwards stick until the song or difficulty changes again.
  // Samples carry no chart tables, so their *ChartFields are {} (no-op).

  function selectMaiSong(next: MaiSong) {
    setState(createMaiSongSelection(next, state.difficulty, songDb.mai.status === "ready"));
  }

  function selectMaiDifficulty(difficulty: MaiDifficulty) {
    setState(createMaiDifficultySelection(difficulty));
  }

  function selectChuniSong(next: ChuniSong) {
    setChuniState(
      createChuniSongSelection(next, chuniState.difficulty, songDb.chuni.status === "ready"),
    );
  }

  function selectChuniDifficulty(difficulty: ChuniDifficulty) {
    setChuniState(createChuniDifficultySelection(chuniSong, difficulty));
  }

  function selectOngekiSong(next: OngekiSong) {
    setOngekiState(
      createOngekiSongSelection(next, ongekiState.difficulty, songDb.ongeki.status === "ready"),
    );
  }

  function selectOngekiDifficulty(difficulty: OngekiDifficulty) {
    setOngekiState(createOngekiDifficultySelection(ongekiSong, difficulty));
  }

  if (!song || !chart) {
    return <div className="scorecard-empty">No songs available.</div>;
  }

  return (
    <main className="scorecard-shell">
      <aside className="scorecard-form" aria-label="Score card controls">
        <div className="control">
          <span>Game</span>
          <div className="segment" role="group" aria-label="Score card game">
            {GAMES.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className={game === entry.key ? "active" : ""}
                aria-pressed={game === entry.key}
                onClick={() => setGame(entry.key)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        {SHOW_SCORECARD_RESET ? (
          <div className="scorecard-form-actions">
            <button type="button" className="ghost-button" onClick={resetCurrentCard}>
              Reset current card
            </button>
          </div>
        ) : null}

        {game === "mai" ? (
          <MaiScoreCardEditor
            songs={maiSongs}
            song={song}
            chart={chart}
            state={state}
            status={songDb.mai.status}
            onSelectSong={selectMaiSong}
            onSelectDifficulty={selectMaiDifficulty}
            onRetry={() => retrySongDb("mai")}
            onUpdate={update}
          />
        ) : null}

        {game === "chuni" ? (
          <ChuniScoreCardEditor
            songs={chuniSongs}
            song={chuniSong}
            state={chuniState}
            status={songDb.chuni.status}
            onSelectSong={selectChuniSong}
            onSelectDifficulty={selectChuniDifficulty}
            onRetry={() => retrySongDb("chuni")}
            onUpdate={updateChuni}
          />
        ) : null}

        {game === "ongeki" ? (
          <OngekiScoreCardEditor
            songs={ongekiSongs}
            song={ongekiSong}
            state={ongekiState}
            status={songDb.ongeki.status}
            onSelectSong={selectOngekiSong}
            onSelectDifficulty={selectOngekiDifficulty}
            onRetry={() => retrySongDb("ongeki")}
            onUpdate={updateOngeki}
          />
        ) : null}
      </aside>

      <ScoreCardPreview
        game={game}
        song={song}
        chart={chart}
        state={state}
        maxDxScore={maxDxScore}
        chuniSong={chuniSong}
        chuniState={chuniState}
        ongekiSong={ongekiSong}
        ongekiState={ongekiState}
        stageRef={stageRef}
        stageScale={stageScale}
        assetStatus={assetStatus}
      />
    </main>
  );
}
