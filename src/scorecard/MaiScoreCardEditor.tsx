import { SongPicker } from "./SongPicker";
import { MAI_DIFFICULTY_LABEL } from "./maiScore";
import { sanitizeDecimal, sanitizeDigits } from "./scorecardInput";
import { COMBO_OPTIONS, SYNC_OPTIONS } from "./scorecardSurfaceConfig";
import type {
  MaiChart,
  MaiComboBadge,
  MaiDifficulty,
  MaiScoreState,
  MaiSong,
  MaiSyncBadge,
} from "./types";
import type { SongDbStatus } from "./songdb";

interface MaiScoreCardEditorProps {
  songs: MaiSong[];
  song: MaiSong;
  chart: MaiChart;
  state: MaiScoreState;
  status: SongDbStatus;
  onSelectSong: (song: MaiSong) => void;
  onSelectDifficulty: (difficulty: MaiDifficulty) => void;
  onRetry: () => void;
  onUpdate: <Key extends keyof MaiScoreState>(
    key: Key,
    value: MaiScoreState[Key],
  ) => void;
}

export function MaiScoreCardEditor({
  songs,
  song,
  chart,
  state,
  status,
  onSelectSong,
  onSelectDifficulty,
  onRetry,
  onUpdate,
}: MaiScoreCardEditorProps) {
  return (
    <>
      <h2>maimai DX Score Card</h2>

      <SongPicker
        songs={songs}
        selected={song}
        status={status}
        songKey={(entry) => String(entry.id)}
        songBadge={(entry) => (entry.isDx ? "［DX］" : "［スタンダード］")}
        onSelect={onSelectSong}
        onRetry={onRetry}
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
              onClick={() => onSelectDifficulty(entry.difficulty)}
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
          onChange={(event) =>
            onUpdate("achievement", sanitizeDecimal(event.target.value, 3, 4))
          }
        />
      </label>

      <label className="control">
        <span>DX Score</span>
        <input
          value={state.dxScore}
          inputMode="numeric"
          onChange={(event) =>
            onUpdate("dxScore", sanitizeDigits(event.target.value, 5, 99_999))
          }
        />
      </label>

      <label className="control">
        <span>DX Score Max{chart.maxDxScore > 0 ? ` (chart: ${chart.maxDxScore})` : ""}</span>
        <input
          value={state.dxScoreMax}
          inputMode="numeric"
          placeholder={chart.maxDxScore > 0 ? String(chart.maxDxScore) : "note count × 3"}
          onChange={(event) =>
            onUpdate("dxScoreMax", sanitizeDigits(event.target.value, 5, 99_999))
          }
        />
      </label>

      <label className="control">
        <span>Combo Badge</span>
        <select
          value={state.comboBadge}
          onChange={(event) => onUpdate("comboBadge", event.target.value as MaiComboBadge)}
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
          onChange={(event) => onUpdate("syncBadge", event.target.value as MaiSyncBadge)}
        >
          {SYNC_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
