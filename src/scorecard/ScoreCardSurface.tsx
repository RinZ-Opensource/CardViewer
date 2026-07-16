import React from "react";
import { exportNodeAsPng, renderNodeToPng } from "../exportPng";
import {
  CHUNI_MUSICBOX_EXPORT_WIDTH,
  CHUNI_MUSICBOX_HEIGHT,
  CHUNI_MUSICBOX_WIDTH,
  ChuniMusicBoxCard,
} from "./ChuniMusicBoxCard";
import {
  CHUNI_SCORECARD_EXPORT_WIDTH,
  CHUNI_SCORECARD_HEIGHT,
  CHUNI_SCORECARD_WIDTH,
  ChuniScoreCard,
} from "./ChuniScoreCard";
import { ChuniScoreCardEditor } from "./ChuniScoreCardEditor";
import {
  MAI_SCORECARD_EXPORT_WIDTH,
  MAI_SCORECARD_HEIGHT,
  MAI_SCORECARD_WIDTH,
  MaiScoreCard,
} from "./MaiScoreCard";
import { MaiScoreCardEditor } from "./MaiScoreCardEditor";
import {
  ONGEKI_MUSICBT_EXPORT_WIDTH,
  ONGEKI_MUSICBT_HEIGHT,
  ONGEKI_MUSICBT_WIDTH,
  OngekiMusicBtCard,
} from "./OngekiMusicBtCard";
import {
  ONGEKI_SCORECARD_EXPORT_WIDTH,
  ONGEKI_SCORECARD_HEIGHT,
  ONGEKI_SCORECARD_WIDTH,
  OngekiScoreCard,
} from "./OngekiScoreCard";
import { OngekiScoreCardEditor } from "./OngekiScoreCardEditor";
import { CHUNI_SAMPLE_SONGS } from "./chuniSamples";
import { ChuniCardType, ChuniDifficulty, ChuniSong } from "./chuniTypes";
import { ONGEKI_SAMPLE_SONGS } from "./ongekiSamples";
import { OngekiCardType, OngekiDifficulty, OngekiSong } from "./ongekiTypes";
import { defaultChuniState, defaultOngekiState, defaultState } from "./scorecardDefaults";
import {
  GAMES,
  SCORECARD_ASSET_SENTINEL,
  SHOW_SCORECARD_EXPORT,
  SHOW_SCORECARD_RESET,
  type ScoreCardGame,
} from "./scorecardSurfaceConfig";
import { MAI_SAMPLE_SONGS } from "./sampleSongs";
import {
  chuniChartFields,
  chuniPreferredDifficulty,
  maiPreferredDifficulty,
  ongekiChartFields,
  ongekiPreferredDifficulty,
} from "./songdb";
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
  const [exportingPng, setExportingPng] = React.useState(false);
  const [exportError, setExportError] = React.useState("");
  const captureRef = React.useRef<HTMLDivElement | null>(null);
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
    setExportError("");
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

  // Dev-only automation hooks for generating sample PNGs from the console.
  React.useEffect(() => {
    if (!import.meta.env.DEV) return;
    const scope = window as unknown as Record<string, unknown>;
    scope.__setScorecardState = (next: MaiScoreState) =>
      setState((current) => ({ ...current, ...next }));
    scope.__renderScorecardPng = async () => {
      const target = captureRef.current;
      if (!target) return null;
      const images = Array.from(target.querySelectorAll("img"));
      await Promise.all(
        images.map((image) =>
          image.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
                image.addEventListener("load", resolve, { once: true });
                image.addEventListener("error", resolve, { once: true });
              }),
        ),
      );
      return renderNodeToPng(target, target.offsetWidth * 3);
    };
    return () => {
      delete scope.__setScorecardState;
      delete scope.__renderScorecardPng;
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
    setState((current) => {
      const currentSong = songDb.mai.songs.find((entry) => entry.id === current.songId);
      if (current.songDbBacked && currentSong) return current;
      const sample = MAI_SAMPLE_SONGS.find((entry) => entry.id === current.songId);
      const next = sample
        ? songDb.mai.songs.find(
            (entry) =>
              entry.title === sample.title &&
              entry.artist === sample.artist &&
              entry.isDx === sample.isDx,
          )
        : currentSong;
      const resolved = next ?? songDb.mai.songs[0];
      const difficulty = maiPreferredDifficulty(resolved, current.difficulty);
      return {
        ...current,
        songId: resolved.id,
        songDbBacked: true,
        difficulty,
        dxScoreMax: "",
      };
    });
  }, [songDb.mai]);

  React.useEffect(() => {
    if (songDb.chuni.status !== "ready" || songDb.chuni.songs.length === 0) return;
    setChuniState((current) => {
      const currentSong = songDb.chuni.songs.find((entry) => entry.id === current.songId);
      if (current.songDbBacked && currentSong) return current;
      const sample = CHUNI_SAMPLE_SONGS.find((entry) => entry.id === current.songId);
      const next = sample
        ? songDb.chuni.songs.find(
            (entry) => entry.title === sample.title && entry.artist === sample.artist,
          )
        : currentSong;
      const resolved = next ?? songDb.chuni.songs[0];
      const difficulty = chuniPreferredDifficulty(resolved, current.difficulty);
      return {
        ...current,
        ...chuniChartFields(resolved, difficulty),
        songId: resolved.id,
        songDbBacked: true,
        difficulty,
      };
    });
  }, [songDb.chuni]);

  React.useEffect(() => {
    if (songDb.ongeki.status !== "ready" || songDb.ongeki.songs.length === 0) return;
    setOngekiState((current) => {
      const currentSong = songDb.ongeki.songs.find((entry) => entry.id === current.songId);
      if (current.songDbBacked && currentSong) return current;
      const sample = ONGEKI_SAMPLE_SONGS.find((entry) => entry.id === current.songId);
      const next = sample
        ? songDb.ongeki.songs.find(
            (entry) => entry.title === sample.title && entry.artist === sample.artist,
          )
        : currentSong;
      const resolved = next ?? songDb.ongeki.songs[0];
      const difficulty = ongekiPreferredDifficulty(resolved, current.difficulty);
      return {
        ...current,
        ...ongekiChartFields(resolved, difficulty),
        songId: resolved.id,
        songDbBacked: true,
        difficulty,
      };
    });
  }, [songDb.ongeki]);

  // Song/difficulty selection (re-)applies the chart-derived fields; manual
  // edits made afterwards stick until the song or difficulty changes again.
  // Samples carry no chart tables, so their *ChartFields are {} (no-op).

  function selectMaiSong(next: MaiSong) {
    const difficulty = maiPreferredDifficulty(next, state.difficulty);
    // dxScoreMax cleared: the chart's own max takes over as the denominator.
    setState((current) => ({
      ...current,
      songId: next.id,
      songDbBacked: songDb.mai.status === "ready",
      difficulty,
      dxScoreMax: "",
    }));
  }

  function selectMaiDifficulty(difficulty: MaiDifficulty) {
    setState((current) => ({ ...current, difficulty, dxScoreMax: "" }));
  }

  function selectChuniSong(next: ChuniSong) {
    const difficulty = chuniPreferredDifficulty(next, chuniState.difficulty);
    setChuniState((current) => ({
      ...current,
      ...chuniChartFields(next, difficulty),
      songId: next.id,
      songDbBacked: songDb.chuni.status === "ready",
      difficulty,
    }));
  }

  function selectChuniDifficulty(difficulty: ChuniDifficulty) {
    setChuniState((current) => ({
      ...current,
      ...chuniChartFields(chuniSong, difficulty),
      difficulty,
    }));
  }

  function selectOngekiSong(next: OngekiSong) {
    const difficulty = ongekiPreferredDifficulty(next, ongekiState.difficulty);
    setOngekiState((current) => ({
      ...current,
      ...ongekiChartFields(next, difficulty),
      songId: next.id,
      songDbBacked: songDb.ongeki.status === "ready",
      difficulty,
    }));
  }

  function selectOngekiDifficulty(difficulty: OngekiDifficulty) {
    setOngekiState((current) => ({
      ...current,
      ...ongekiChartFields(ongekiSong, difficulty),
      difficulty,
    }));
  }

  async function exportPng() {
    const target = captureRef.current;
    if (!target || !song) return;
    // Filenames carry the card type so panel/select exports don't collide.
    const exportName =
      game === "mai"
        ? `maimai-${song.title}-${state.difficulty}`
        : game === "chuni"
          ? chuniState.cardType === "musicbox"
            ? `chunithm-musicbox-${chuniSong.title}-${chuniState.difficulty}`
            : `chunithm-${chuniSong.title}-${chuniState.difficulty}`
          : ongekiState.cardType === "musicbt"
            ? `ongeki-musicbt-${ongekiSong.title}-${ongekiState.difficulty}`
            : `ongeki-${ongekiSong.title}-${ongekiState.difficulty}`;
    const exportWidth =
      game === "mai"
        ? MAI_SCORECARD_EXPORT_WIDTH
        : game === "chuni"
          ? chuniState.cardType === "musicbox"
            ? CHUNI_MUSICBOX_EXPORT_WIDTH
            : CHUNI_SCORECARD_EXPORT_WIDTH
          : ongekiState.cardType === "musicbt"
            ? ONGEKI_MUSICBT_EXPORT_WIDTH
            : ONGEKI_SCORECARD_EXPORT_WIDTH;
    try {
      setExportError("");
      setExportingPng(true);
      await exportNodeAsPng(target, exportName, exportWidth);
    } catch (err) {
      setExportError(
        `Export failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setExportingPng(false);
    }
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

      <section className="scorecard-preview">
        {SHOW_SCORECARD_EXPORT ? (
          <div className="scorecard-toolbar">
            <button
              type="button"
              className="scorecard-export"
              onClick={exportPng}
              disabled={exportingPng}
            >
              {exportingPng ? "Exporting…" : "Export PNG"}
            </button>
          </div>
        ) : null}
        {exportError ? (
          <div className="scorecard-export-error" role="alert">
            {exportError}
          </div>
        ) : null}
        {assetStatus === "error" ? (
          <div className="scorecard-export-error" role="alert">
            {import.meta.env.DEV
              ? "Official artwork is unavailable in this preview. Use the private preview or seed the Cloudflare R2 asset store."
              : "Official artwork is temporarily unavailable from the asset store."}
          </div>
        ) : null}
        <div className="scorecard-stage" ref={stageRef}>
          {/* CSS zoom (not transform:scale): text re-rasterizes at the zoomed
              size, so glyph spacing stays even at fractional fit factors. */}
          <div className="scorecard-zoom" style={{ zoom: stageScale }}>
            {game === "mai" ? (
              <MaiScoreCard
                song={song}
                chart={chart}
                state={state}
                maxDxScore={maxDxScore}
                captureRef={captureRef}
              />
            ) : game === "chuni" ? (
              chuniState.cardType === "musicbox" ? (
                <ChuniMusicBoxCard song={chuniSong} state={chuniState} captureRef={captureRef} />
              ) : (
                <ChuniScoreCard song={chuniSong} state={chuniState} captureRef={captureRef} />
              )
            ) : ongekiState.cardType === "musicbt" ? (
              <OngekiMusicBtCard
                song={ongekiSong}
                state={ongekiState}
                bossIconUrl={ongekiSong.bossIconUrl}
                bossIconFallbacks={ongekiSong.bossIconFallbacks}
                captureRef={captureRef}
              />
            ) : (
              <OngekiScoreCard song={ongekiSong} state={ongekiState} captureRef={captureRef} />
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
