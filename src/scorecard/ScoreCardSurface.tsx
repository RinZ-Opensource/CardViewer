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
import {
  MAI_SCORECARD_EXPORT_WIDTH,
  MAI_SCORECARD_HEIGHT,
  MAI_SCORECARD_WIDTH,
  MaiScoreCard,
} from "./MaiScoreCard";
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
import { SongPicker } from "./SongPicker";
import {
  CHUNI_BOX_DIFFICULTY_ORDER,
  CHUNI_DIFFICULTY_LABEL,
  CHUNI_DIFFICULTY_ORDER,
} from "./chuniAssets";
import { CHUNI_SAMPLE_SONGS } from "./chuniSamples";
import {
  ChuniCardType,
  ChuniComboLamp,
  ChuniDifficulty,
  ChuniFullChainLamp,
  ChuniScoreState,
  ChuniSong,
  ChuniStartBanner,
  ChuniSuccessLamp,
} from "./chuniTypes";
import { MAI_DIFFICULTY_LABEL } from "./maiScore";
import { ONGEKI_DIFFICULTY_LABEL, ONGEKI_DIFFICULTY_ORDER } from "./ongekiAssets";
import { ONGEKI_SAMPLE_SONGS } from "./ongekiSamples";
import {
  OngekiAttribute,
  OngekiBattleRank,
  OngekiCardType,
  OngekiDifficulty,
  OngekiFcLamp,
  OngekiScoreState,
  OngekiSong,
} from "./ongekiTypes";
import { MAI_SAMPLE_SONGS } from "./sampleSongs";
import {
  SongDbStatus,
  chuniChartFields,
  chuniHasChart,
  chuniPreferredDifficulty,
  loadChuniSongs,
  loadMaiSongs,
  loadOngekiSongs,
  maiPreferredDifficulty,
  ongekiChartFields,
  ongekiHasChart,
  ongekiPreferredDifficulty,
} from "./songdb";
import { MaiComboBadge, MaiDifficulty, MaiScoreState, MaiSong, MaiSyncBadge } from "./types";

type ScoreCardGame = "mai" | "chuni" | "ongeki";

const GAME_STORAGE_KEY = "configarc-card-viewer.scorecard-game";
/** Pre-game-selector key; kept verbatim so existing maimai state survives. */
const SCORE_STORAGE_KEY = "configarc-card-viewer.scorecard";
const CHUNI_STORAGE_KEY = "configarc-card-viewer.scorecard-chuni";
const ONGEKI_STORAGE_KEY = "configarc-card-viewer.scorecard-ongeki";

const GAMES: Array<{ key: ScoreCardGame; label: string }> = [
  { key: "mai", label: "maimai" },
  { key: "chuni", label: "CHUNITHM" },
  { key: "ongeki", label: "O.N.G.E.K.I." },
];

/** chuni/ongeki each render one of two cards: playing panel or select card. */
const CARD_TYPES: Array<{ key: "panel" | "score"; label: string }> = [
  { key: "panel", label: "Play panel" },
  { key: "score", label: "Music card" },
];

/** Panel-style cards stay implemented, but are hidden until their UX is ready. */
const SHOW_PANEL_CARDS = false;

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

const COMBO_OPTIONS: Array<{ value: MaiComboBadge; label: string }> = [
  { value: "none", label: "—" },
  { value: "fc", label: "FULL COMBO" },
  { value: "fcp", label: "FULL COMBO+" },
  { value: "ap", label: "ALL PERFECT" },
  { value: "app", label: "ALL PERFECT+" },
];

const SYNC_OPTIONS: Array<{ value: MaiSyncBadge; label: string }> = [
  { value: "none", label: "—" },
  { value: "sync", label: "SYNC PLAY" },
  { value: "fs", label: "FULL SYNC" },
  { value: "fsp", label: "FULL SYNC+" },
  { value: "fsd", label: "FULL SYNC DX" },
  { value: "fsdp", label: "FULL SYNC DX+" },
];

/** WE star options, half-star steps (gold patterns 10-19). */
const WE_STAR_OPTIONS = Array.from({ length: 10 }, (_, index) => (index + 1) / 2);

const CHUNI_SUCCESS_OPTIONS: Array<{ value: ChuniSuccessLamp; label: string }> = [
  { value: "none", label: "—" },
  { value: "failed", label: "FAILED" },
  { value: "clear", label: "CLEAR" },
  { value: "hard", label: "HARD" },
  { value: "brave", label: "BRAVE" },
  { value: "absolute", label: "ABSOLUTE" },
  { value: "catastrophy", label: "CATASTROPHY" },
];

const CHUNI_COMBO_OPTIONS: Array<{ value: ChuniComboLamp; label: string }> = [
  { value: "none", label: "—" },
  { value: "fc", label: "FULL COMBO" },
  { value: "aj", label: "ALL JUSTICE" },
  { value: "ajc", label: "ALL JUSTICE CRITICAL" },
];

const CHUNI_FCHAIN_OPTIONS: Array<{ value: ChuniFullChainLamp; label: string }> = [
  { value: "none", label: "—" },
  { value: "gold", label: "FULL CHAIN (GOLD)" },
  { value: "platinum", label: "FULL CHAIN (PLATINUM)" },
];

const CHUNI_BANNER_OPTIONS: Array<{ value: ChuniStartBanner; label: string }> = [
  { value: "gamestart", label: "GAME START!" },
  { value: "ready", label: "GAME 準備完了" },
  { value: "linkstart", label: "Link START!" },
];

const ONGEKI_BATTLE_RANK_OPTIONS: Array<{ value: OngekiBattleRank; label: string }> = [
  { value: "none", label: "—" },
  { value: "usually", label: "可 (USUALLY)" },
  { value: "good", label: "良 (GOOD)" },
  { value: "great", label: "優 (GREAT)" },
  { value: "excellent", label: "秀 (EXCELLENT)" },
  { value: "unbelievable", label: "極 (UNBELIEVABLE)" },
];

const ONGEKI_FC_OPTIONS: Array<{ value: OngekiFcLamp; label: string }> = [
  { value: "none", label: "—" },
  { value: "fc", label: "FULL COMBO" },
  { value: "ab", label: "ALL BREAK" },
  { value: "abplus", label: "ALL BREAK+" },
];

const ONGEKI_ATTRIBUTE_OPTIONS: Array<{ value: OngekiAttribute; label: string }> = [
  { value: "fire", label: "FIRE" },
  { value: "aqua", label: "AQUA" },
  { value: "leaf", label: "LEAF" },
];

function loadGame(): ScoreCardGame {
  const stored = localStorage.getItem(GAME_STORAGE_KEY);
  return GAMES.some((game) => game.key === stored) ? (stored as ScoreCardGame) : "mai";
}

function defaultState(): MaiScoreState {
  const song = MAI_SAMPLE_SONGS[0];
  return {
    songId: song?.id ?? 0,
    songDbBacked: false,
    difficulty: "expert",
    achievement: "100.9950",
    dxScore: "2589",
    dxScoreMax: "",
    comboBadge: "ap",
    syncBadge: "fsdp",
  };
}

function defaultChuniState(): ChuniScoreState {
  const song = CHUNI_SAMPLE_SONGS[0];
  return {
    songId: song?.id ?? 0,
    songDbBacked: false,
    difficulty: "master",
    level: "13+",
    track: "1",
    speed: "2.0",
    sonic: false,
    mirror: false,
    weKanji: "祭",
    weStars: 3,
    // Music-box defaults; older stored states pick these up via loadStored.
    cardType: "musicbox",
    bestScore: "1007850",
    successLamp: "clear",
    comboLamp: "fc",
    fullChainLamp: "none",
    bpm: "180",
    notesDesigner: "Jack",
    confirmed: false,
    startBanner: "gamestart",
  };
}

function defaultOngekiState(): OngekiScoreState {
  const song = ONGEKI_SAMPLE_SONGS[0];
  return {
    songId: song?.id ?? "0001",
    songDbBacked: false,
    difficulty: "master",
    level: "13+",
    speed: "9.5",
    sonic: false,
    mirror: false,
    secret: false,
    // MusicBt defaults; older stored states pick these up via loadStored.
    cardType: "musicbt",
    techScore: "1004283",
    battleScore: "5123456",
    platinumScore: "1450",
    platinumScoreMax: "1500",
    overDamage: "254.5",
    battleRank: "great",
    fullBell: true,
    fcLamp: "fc",
    bossLevel: "45",
    bossAttribute: "fire",
    bpm: "180",
    notesDesigner: "-",
  };
}

function loadStored<State>(key: string, fallback: () => State): State {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback();
    return { ...fallback(), ...(JSON.parse(raw) as Partial<State>) };
  } catch {
    return fallback();
  }
}

export function ScoreCardSurface() {
  const [game, setGame] = React.useState<ScoreCardGame>(loadGame);
  const [state, setState] = React.useState<MaiScoreState>(() =>
    loadStored(SCORE_STORAGE_KEY, defaultState),
  );
  const [chuniState, setChuniState] = React.useState<ChuniScoreState>(() => {
    const stored = loadStored(CHUNI_STORAGE_KEY, defaultChuniState);
    return SHOW_PANEL_CARDS ? stored : { ...stored, cardType: "musicbox" };
  });
  const [ongekiState, setOngekiState] = React.useState<OngekiScoreState>(() => {
    const stored = loadStored(ONGEKI_STORAGE_KEY, defaultOngekiState);
    return SHOW_PANEL_CARDS ? stored : { ...stored, cardType: "musicbt" };
  });
  const [exportingPng, setExportingPng] = React.useState(false);
  const [exportError, setExportError] = React.useState("");
  const captureRef = React.useRef<HTMLDivElement | null>(null);
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const [stageScale, setStageScale] = React.useState(1);

  /** Online song DB per game; the samples keep rendering until it loads. */
  const [songDb, setSongDb] = React.useState<{
    mai: { status: SongDbStatus; songs: MaiSong[] };
    chuni: { status: SongDbStatus; songs: ChuniSong[] };
    ongeki: { status: SongDbStatus; songs: OngekiSong[] };
  }>({
    mai: { status: "loading", songs: [] },
    chuni: { status: "loading", songs: [] },
    ongeki: { status: "loading", songs: [] },
  });
  const songDbStarted = React.useRef<Set<ScoreCardGame>>(new Set());
  const songDbRequestId = React.useRef<Record<ScoreCardGame, number>>({
    mai: 0,
    chuni: 0,
    ongeki: 0,
  });
  const [songDbReload, setSongDbReload] = React.useState(0);

  // Kick each game's DB fetch the first time its tab is shown. An empty list
  // counts as a failure so the picker falls back to the bundled samples.
  React.useEffect(() => {
    if (songDbStarted.current.has(game)) return;
    songDbStarted.current.add(game);
    const requestId = songDbRequestId.current[game] + 1;
    songDbRequestId.current[game] = requestId;
    const isCurrentRequest = () => songDbRequestId.current[game] === requestId;
    if (game === "mai") {
      loadMaiSongs().then(
        (songs) => {
          if (!isCurrentRequest()) return;
          setSongDb((current) => ({
            ...current,
            mai: { status: songs.length > 0 ? "ready" : "error", songs },
          }));
        },
        () => {
          if (!isCurrentRequest()) return;
          setSongDb((current) => ({ ...current, mai: { status: "error", songs: [] } }));
        },
      );
    } else if (game === "chuni") {
      loadChuniSongs().then(
        (songs) => {
          if (!isCurrentRequest()) return;
          setSongDb((current) => ({
            ...current,
            chuni: { status: songs.length > 0 ? "ready" : "error", songs },
          }));
        },
        () => {
          if (!isCurrentRequest()) return;
          setSongDb((current) => ({ ...current, chuni: { status: "error", songs: [] } }));
        },
      );
    } else {
      loadOngekiSongs().then(
        (songs) => {
          if (!isCurrentRequest()) return;
          setSongDb((current) => ({
            ...current,
            ongeki: { status: songs.length > 0 ? "ready" : "error", songs },
          }));
        },
        () => {
          if (!isCurrentRequest()) return;
          setSongDb((current) => ({ ...current, ongeki: { status: "error", songs: [] } }));
        },
      );
    }
  }, [game, songDbReload]);

  function retrySongDb(target: ScoreCardGame) {
    songDbStarted.current.delete(target);
    songDbRequestId.current[target] += 1;
    setSongDb((current) => ({
      ...current,
      [target]: { status: "loading", songs: [] },
    }));
    setSongDbReload((current) => current + 1);
  }

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

  React.useEffect(() => {
    localStorage.setItem(GAME_STORAGE_KEY, game);
  }, [game]);

  React.useEffect(() => {
    localStorage.setItem(SCORE_STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  React.useEffect(() => {
    localStorage.setItem(CHUNI_STORAGE_KEY, JSON.stringify(chuniState));
  }, [chuniState]);

  React.useEffect(() => {
    localStorage.setItem(ONGEKI_STORAGE_KEY, JSON.stringify(ongekiState));
  }, [ongekiState]);

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
  const maxDxScore =
    Number.parseInt(state.dxScoreMax, 10) || chart?.maxDxScore || 0;
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
      <aside className="scorecard-form">
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

        <div className="scorecard-form-actions">
          <button type="button" className="ghost-button" onClick={resetCurrentCard}>
            Reset current card
          </button>
        </div>

        {game === "mai" ? (
          <>
            <h2>maimai DX Score Card</h2>

            <SongPicker
              songs={maiSongs}
              selected={song}
              status={songDb.mai.status}
              songKey={(entry) => String(entry.id)}
              songBadge={(entry) => (entry.isDx ? "［DX］" : "［スタンダード］")}
              onSelect={selectMaiSong}
              onRetry={() => retrySongDb("mai")}
            />

            <div className="control">
              <span>Difficulty</span>
              <div className="segment" role="group" aria-label="maimai difficulty">
                {song.charts.map((entry) => (
                  <button
                    key={entry.difficulty}
                    type="button"
                    className={state.difficulty === entry.difficulty ? "active" : ""}
                    aria-pressed={state.difficulty === entry.difficulty}
                    onClick={() => selectMaiDifficulty(entry.difficulty)}
                  >
                    {MAI_DIFFICULTY_LABEL[entry.difficulty]}
                  </button>
                ))}
              </div>
            </div>

            <label className="control">
              <span>Achievement %</span>
              <input
                value={state.achievement}
                inputMode="decimal"
                onChange={(event) => update("achievement", event.target.value)}
              />
            </label>

            <label className="control">
              <span>DX Score</span>
              <input
                value={state.dxScore}
                inputMode="numeric"
                onChange={(event) => update("dxScore", event.target.value)}
              />
            </label>

            <label className="control">
              <span>DX Score Max{chart.maxDxScore > 0 ? ` (chart: ${chart.maxDxScore})` : ""}</span>
              <input
                value={state.dxScoreMax}
                inputMode="numeric"
                placeholder={chart.maxDxScore > 0 ? String(chart.maxDxScore) : "note count × 3"}
                onChange={(event) => update("dxScoreMax", event.target.value)}
              />
            </label>

            <label className="control">
              <span>Combo Badge</span>
              <select
                value={state.comboBadge}
                onChange={(event) => update("comboBadge", event.target.value as MaiComboBadge)}
              >
                {COMBO_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="control">
              <span>Sync Badge</span>
              <select
                value={state.syncBadge}
                onChange={(event) => update("syncBadge", event.target.value as MaiSyncBadge)}
              >
                {SYNC_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        {game === "chuni" ? (
          <>
            <h2>
              {chuniState.cardType === "musicbox"
                ? "CHUNITHM Music Select"
                : "CHUNITHM Music Info"}
            </h2>

            {SHOW_PANEL_CARDS ? (
              <div className="control">
                <span>Card</span>
                <div className="segment" role="group" aria-label="CHUNITHM card type">
                  {CARD_TYPES.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      className={
                        (chuniState.cardType === "musicbox") === (entry.key === "score")
                          ? "active"
                          : ""
                      }
                      aria-pressed={
                        (chuniState.cardType === "musicbox") === (entry.key === "score")
                      }
                      onClick={() =>
                        updateChuni("cardType", entry.key === "score" ? "musicbox" : "panel")
                      }
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <SongPicker
              songs={chuniSongs}
              selected={chuniSong}
              status={songDb.chuni.status}
              songKey={(entry) => String(entry.id)}
              onSelect={selectChuniSong}
              onRetry={() => retrySongDb("chuni")}
            />

            <div className="control">
              <span>Difficulty</span>
              <div className="segment" role="group" aria-label="CHUNITHM difficulty">
                {/* The music box has no TUTORIAL pattern. */}
                {(chuniState.cardType === "musicbox"
                  ? CHUNI_BOX_DIFFICULTY_ORDER
                  : CHUNI_DIFFICULTY_ORDER
                ).map((difficulty) => (
                  <button
                    key={difficulty}
                    type="button"
                    className={chuniState.difficulty === difficulty ? "active" : ""}
                    aria-pressed={chuniState.difficulty === difficulty}
                    disabled={!chuniHasChart(chuniSong, difficulty)}
                    onClick={() => selectChuniDifficulty(difficulty)}
                  >
                    {CHUNI_DIFFICULTY_LABEL[difficulty]}
                  </button>
                ))}
              </div>
            </div>

            {chuniState.difficulty === "worldsend" ? (
              <>
                <label className="control">
                  <span>WORLD'S END Kanji</span>
                  <input
                    value={chuniState.weKanji}
                    maxLength={1}
                    onChange={(event) => updateChuni("weKanji", event.target.value)}
                  />
                </label>

                <label className="control">
                  <span>WORLD'S END Stars</span>
                  <select
                    value={String(chuniState.weStars)}
                    onChange={(event) => updateChuni("weStars", Number(event.target.value))}
                  >
                    {WE_STAR_OPTIONS.map((count) => (
                      <option key={count} value={String(count)}>
                        {count}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <label className="control">
                <span>Level</span>
                <input
                  value={chuniState.level}
                  onChange={(event) => updateChuni("level", event.target.value)}
                />
              </label>
            )}

            {chuniState.cardType === "panel" ? (
              <>
                <label className="control">
                  <span>Track</span>
                  <input
                    value={chuniState.track}
                    inputMode="numeric"
                    onChange={(event) => updateChuni("track", event.target.value)}
                  />
                </label>

                <label className="control">
                  <span>Speed</span>
                  <input
                    value={chuniState.speed}
                    inputMode="decimal"
                    disabled={chuniState.sonic}
                    onChange={(event) => updateChuni("speed", event.target.value)}
                  />
                </label>

                <label className="control inline">
                  <input
                    type="checkbox"
                    checked={chuniState.sonic}
                    onChange={(event) => updateChuni("sonic", event.target.checked)}
                  />
                  <span>SONIC (max speed)</span>
                </label>

                <label className="control inline">
                  <input
                    type="checkbox"
                    checked={chuniState.mirror}
                    onChange={(event) => updateChuni("mirror", event.target.checked)}
                  />
                  <span>Mirror</span>
                </label>
              </>
            ) : (
              <>
                <label className="control">
                  <span>Best Score (empty = unplayed)</span>
                  <input
                    value={chuniState.bestScore}
                    inputMode="numeric"
                    placeholder="1010000"
                    onChange={(event) => updateChuni("bestScore", event.target.value)}
                  />
                </label>

                <label className="control">
                  <span>Clear Lamp</span>
                  <select
                    value={chuniState.successLamp}
                    onChange={(event) =>
                      updateChuni("successLamp", event.target.value as ChuniSuccessLamp)
                    }
                  >
                    {CHUNI_SUCCESS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="control">
                  <span>Combo Lamp</span>
                  <select
                    value={chuniState.comboLamp}
                    onChange={(event) =>
                      updateChuni("comboLamp", event.target.value as ChuniComboLamp)
                    }
                  >
                    {CHUNI_COMBO_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="control">
                  <span>Full Chain</span>
                  <select
                    value={chuniState.fullChainLamp}
                    onChange={(event) =>
                      updateChuni("fullChainLamp", event.target.value as ChuniFullChainLamp)
                    }
                  >
                    {CHUNI_FCHAIN_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="control">
                  <span>BPM</span>
                  <input
                    value={chuniState.bpm}
                    inputMode="numeric"
                    onChange={(event) => updateChuni("bpm", event.target.value)}
                  />
                </label>

                <label className="control">
                  <span>Notes Designer</span>
                  <input
                    value={chuniState.notesDesigner}
                    onChange={(event) => updateChuni("notesDesigner", event.target.value)}
                  />
                </label>

                <label className="control inline">
                  <input
                    type="checkbox"
                    checked={chuniState.confirmed}
                    onChange={(event) => updateChuni("confirmed", event.target.checked)}
                  />
                  <span>已确认 START (decide frame)</span>
                </label>

                {chuniState.confirmed ? (
                  <label className="control">
                    <span>Start Banner</span>
                    <select
                      value={chuniState.startBanner}
                      onChange={(event) =>
                        updateChuni("startBanner", event.target.value as ChuniStartBanner)
                      }
                    >
                      {CHUNI_BANNER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </>
            )}
          </>
        ) : null}

        {game === "ongeki" ? (
          <>
            <h2>
              {ongekiState.cardType === "musicbt"
                ? "O.N.G.E.K.I. Music Select"
                : "O.N.G.E.K.I. Play Music"}
            </h2>

            {SHOW_PANEL_CARDS ? (
              <div className="control">
                <span>Card</span>
                <div className="segment" role="group" aria-label="O.N.G.E.K.I. card type">
                  {CARD_TYPES.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      className={
                        (ongekiState.cardType === "musicbt") === (entry.key === "score")
                          ? "active"
                          : ""
                      }
                      aria-pressed={
                        (ongekiState.cardType === "musicbt") === (entry.key === "score")
                      }
                      onClick={() =>
                        updateOngeki("cardType", entry.key === "score" ? "musicbt" : "panel")
                      }
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <SongPicker
              songs={ongekiSongs}
              selected={ongekiSong}
              status={songDb.ongeki.status}
              songKey={(entry) => entry.id}
              onSelect={selectOngekiSong}
              onRetry={() => retrySongDb("ongeki")}
            />

            <div className="control">
              <span>Difficulty</span>
              <div className="segment" role="group" aria-label="O.N.G.E.K.I. difficulty">
                {ONGEKI_DIFFICULTY_ORDER.map((difficulty) => (
                  <button
                    key={difficulty}
                    type="button"
                    className={ongekiState.difficulty === difficulty ? "active" : ""}
                    aria-pressed={ongekiState.difficulty === difficulty}
                    disabled={!ongekiHasChart(ongekiSong, difficulty)}
                    onClick={() => selectOngekiDifficulty(difficulty)}
                  >
                    {ONGEKI_DIFFICULTY_LABEL[difficulty]}
                  </button>
                ))}
              </div>
            </div>

            <label className="control">
              <span>Level (e.g. 13+)</span>
              <input
                value={ongekiState.level}
                onChange={(event) => updateOngeki("level", event.target.value)}
              />
            </label>

            {ongekiState.cardType === "panel" ? (
              <>
                <label className="control">
                  <span>Speed</span>
                  <input
                    value={ongekiState.speed}
                    inputMode="decimal"
                    disabled={ongekiState.sonic}
                    onChange={(event) => updateOngeki("speed", event.target.value)}
                  />
                </label>

                <label className="control inline">
                  <input
                    type="checkbox"
                    checked={ongekiState.sonic}
                    onChange={(event) => updateOngeki("sonic", event.target.checked)}
                  />
                  <span>SONIC (max speed)</span>
                </label>

                <label className="control inline">
                  <input
                    type="checkbox"
                    checked={ongekiState.mirror}
                    onChange={(event) => updateOngeki("mirror", event.target.checked)}
                  />
                  <span>Mirror</span>
                </label>

                <label className="control inline">
                  <input
                    type="checkbox"
                    checked={ongekiState.secret}
                    onChange={(event) => updateOngeki("secret", event.target.checked)}
                  />
                  <span>Secret (cover the panel)</span>
                </label>
              </>
            ) : (
              <>
                <label className="control">
                  <span>Technical Score (empty = unplayed)</span>
                  <input
                    value={ongekiState.techScore}
                    inputMode="numeric"
                    placeholder="1010000"
                    onChange={(event) => updateOngeki("techScore", event.target.value)}
                  />
                </label>

                <label className="control">
                  <span>Battle Score</span>
                  <input
                    value={ongekiState.battleScore}
                    inputMode="numeric"
                    onChange={(event) => updateOngeki("battleScore", event.target.value)}
                  />
                </label>

                <label className="control">
                  <span>Platinum Score</span>
                  <input
                    value={ongekiState.platinumScore}
                    inputMode="numeric"
                    onChange={(event) => updateOngeki("platinumScore", event.target.value)}
                  />
                </label>

                <label className="control">
                  <span>Platinum Score Max</span>
                  <input
                    value={ongekiState.platinumScoreMax}
                    inputMode="numeric"
                    onChange={(event) => updateOngeki("platinumScoreMax", event.target.value)}
                  />
                </label>

                <label className="control">
                  <span>Over Damage %</span>
                  <input
                    value={ongekiState.overDamage}
                    inputMode="decimal"
                    onChange={(event) => updateOngeki("overDamage", event.target.value)}
                  />
                </label>

                <label className="control">
                  <span>Battle Rank (boss beats)</span>
                  <select
                    value={ongekiState.battleRank}
                    onChange={(event) =>
                      updateOngeki("battleRank", event.target.value as OngekiBattleRank)
                    }
                  >
                    {ONGEKI_BATTLE_RANK_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="control inline">
                  <input
                    type="checkbox"
                    checked={ongekiState.fullBell}
                    onChange={(event) => updateOngeki("fullBell", event.target.checked)}
                  />
                  <span>FULL BELL</span>
                </label>

                <label className="control">
                  <span>Combo Lamp</span>
                  <select
                    value={ongekiState.fcLamp}
                    onChange={(event) =>
                      updateOngeki("fcLamp", event.target.value as OngekiFcLamp)
                    }
                  >
                    {ONGEKI_FC_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="control">
                  <span>Boss Level</span>
                  <input
                    value={ongekiState.bossLevel}
                    inputMode="numeric"
                    onChange={(event) => updateOngeki("bossLevel", event.target.value)}
                  />
                </label>

                <label className="control">
                  <span>Boss Attribute</span>
                  <select
                    value={ongekiState.bossAttribute}
                    onChange={(event) =>
                      updateOngeki("bossAttribute", event.target.value as OngekiAttribute)
                    }
                  >
                    {ONGEKI_ATTRIBUTE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="control">
                  <span>BPM</span>
                  <input
                    value={ongekiState.bpm}
                    inputMode="numeric"
                    onChange={(event) => updateOngeki("bpm", event.target.value)}
                  />
                </label>

                <label className="control">
                  <span>Notes Designer</span>
                  <input
                    value={ongekiState.notesDesigner}
                    onChange={(event) => updateOngeki("notesDesigner", event.target.value)}
                  />
                </label>
              </>
            )}
          </>
        ) : null}
      </aside>

      <section className="scorecard-preview">
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
        {exportError ? (
          <div className="scorecard-export-error" role="alert">
            {exportError}
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
              <OngekiMusicBtCard song={ongekiSong} state={ongekiState} captureRef={captureRef} />
            ) : (
              <OngekiScoreCard song={ongekiSong} state={ongekiState} captureRef={captureRef} />
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
