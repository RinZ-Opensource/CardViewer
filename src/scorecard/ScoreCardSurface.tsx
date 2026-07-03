import React from "react";
import { ThemeToggle } from "../ThemeToggle";
import { exportNodeAsPng, renderNodeToPng } from "../exportPng";
import { MAI_SCORECARD_EXPORT_WIDTH, MaiScoreCard } from "./MaiScoreCard";
import { MAI_DIFFICULTY_LABEL } from "./maiScore";
import { MAI_SAMPLE_SONGS } from "./sampleSongs";
import { MaiComboBadge, MaiScoreState, MaiSyncBadge } from "./types";

const SCORE_STORAGE_KEY = "configarc-card-viewer.scorecard";

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

function defaultState(): MaiScoreState {
  const song = MAI_SAMPLE_SONGS[0];
  return {
    songId: song?.id ?? 0,
    difficulty: "expert",
    achievement: "100.9950",
    dxScore: "2589",
    dxScoreMax: "",
    comboBadge: "ap",
    syncBadge: "fsdp",
  };
}

function loadState(): MaiScoreState {
  try {
    const raw = localStorage.getItem(SCORE_STORAGE_KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...(JSON.parse(raw) as Partial<MaiScoreState>) };
  } catch {
    return defaultState();
  }
}

export function ScoreCardSurface() {
  const [state, setState] = React.useState<MaiScoreState>(loadState);
  const [exportingPng, setExportingPng] = React.useState(false);
  const captureRef = React.useRef<HTMLDivElement | null>(null);
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const [stageScale, setStageScale] = React.useState(1);

  React.useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fit = () => {
      const rect = stage.getBoundingClientRect();
      setStageScale(
        Math.max(
          0.5,
          Math.min((rect.width - 48) / 284, (rect.height - 48) / 464, 2.4),
        ),
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    localStorage.setItem(SCORE_STORAGE_KEY, JSON.stringify(state));
  }, [state]);

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

  const song =
    MAI_SAMPLE_SONGS.find((entry) => entry.id === state.songId) ?? MAI_SAMPLE_SONGS[0];
  const chart =
    song?.charts.find((entry) => entry.difficulty === state.difficulty) ??
    song?.charts[song.charts.length - 1];
  const maxDxScore =
    Number.parseInt(state.dxScoreMax, 10) || chart?.maxDxScore || 0;

  function update<Key extends keyof MaiScoreState>(key: Key, value: MaiScoreState[Key]) {
    setState((current) => ({ ...current, [key]: value }));
  }

  async function exportPng() {
    const target = captureRef.current;
    if (!target || !song) return;
    try {
      setExportingPng(true);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
      );
      await exportNodeAsPng(
        target,
        `${song.title}-${state.difficulty}`,
        MAI_SCORECARD_EXPORT_WIDTH,
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
        <h2>maimai DX Score Card</h2>

        <label className="control">
          <span>Song</span>
          <select
            value={String(song.id)}
            onChange={(event) => update("songId", Number(event.target.value))}
          >
            {MAI_SAMPLE_SONGS.map((entry) => (
              <option key={entry.id} value={String(entry.id)}>
                {entry.title}
              </option>
            ))}
          </select>
        </label>

        <label className="control">
          <span>Difficulty</span>
          <div className="segment">
            {song.charts.map((entry) => (
              <button
                key={entry.difficulty}
                type="button"
                className={state.difficulty === entry.difficulty ? "active" : ""}
                onClick={() => update("difficulty", entry.difficulty)}
              >
                {MAI_DIFFICULTY_LABEL[entry.difficulty]}
              </button>
            ))}
          </div>
        </label>

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
      </aside>

      <section className="scorecard-preview">
        <div className="scorecard-toolbar">
          <ThemeToggle />
          <button
            type="button"
            className="scorecard-export"
            onClick={exportPng}
            disabled={exportingPng}
          >
            {exportingPng ? "Exporting…" : "Export PNG"}
          </button>
        </div>
        <div className="scorecard-stage" ref={stageRef}>
          <div className="scorecard-zoom" style={{ transform: `scale(${stageScale})` }}>
            <MaiScoreCard
              song={song}
              chart={chart}
              state={state}
              maxDxScore={maxDxScore}
              captureRef={captureRef}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
