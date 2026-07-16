import { SongPicker } from "./SongPicker";
import { ONGEKI_DIFFICULTY_LABEL, ONGEKI_DIFFICULTY_ORDER } from "./ongekiAssets";
import type {
  OngekiAttribute,
  OngekiBattleRank,
  OngekiDifficulty,
  OngekiFcLamp,
  OngekiScoreState,
  OngekiSong,
} from "./ongekiTypes";
import { sanitizeDecimal, sanitizeDigits, sanitizeLevel } from "./scorecardInput";
import {
  CARD_TYPES,
  ONGEKI_ATTRIBUTE_OPTIONS,
  ONGEKI_BATTLE_RANK_OPTIONS,
  ONGEKI_FC_OPTIONS,
  SHOW_PANEL_CARDS,
} from "./scorecardSurfaceConfig";
import { ongekiHasChart } from "./songdb";
import type { SongDbStatus } from "./songdb";

interface OngekiScoreCardEditorProps {
  songs: OngekiSong[];
  song: OngekiSong;
  state: OngekiScoreState;
  status: SongDbStatus;
  onSelectSong: (song: OngekiSong) => void;
  onSelectDifficulty: (difficulty: OngekiDifficulty) => void;
  onRetry: () => void;
  onUpdate: <Key extends keyof OngekiScoreState>(
    key: Key,
    value: OngekiScoreState[Key],
  ) => void;
}

export function OngekiScoreCardEditor({
  songs: ongekiSongs,
  song: ongekiSong,
  state: ongekiState,
  status,
  onSelectSong: selectOngekiSong,
  onSelectDifficulty: selectOngekiDifficulty,
  onRetry,
  onUpdate: updateOngeki,
}: OngekiScoreCardEditorProps) {
  return (
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
        status={status}
        songKey={(entry) => entry.id}
        onSelect={selectOngekiSong}
        onRetry={onRetry}
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
          onChange={(event) => updateOngeki("level", sanitizeLevel(event.target.value))}
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
              onChange={(event) =>
                updateOngeki(
                  "techScore",
                  sanitizeDigits(event.target.value, 7, 1_010_000),
                )
              }
            />
          </label>

          <label className="control">
            <span>Battle Score</span>
            <input
              value={ongekiState.battleScore}
              inputMode="numeric"
              onChange={(event) =>
                updateOngeki("battleScore", sanitizeDigits(event.target.value, 9))
              }
            />
          </label>

          <label className="control">
            <span>Platinum Score</span>
            <input
              value={ongekiState.platinumScore}
              inputMode="numeric"
              onChange={(event) =>
                updateOngeki("platinumScore", sanitizeDigits(event.target.value, 5))
              }
            />
          </label>

          <label className="control">
            <span>Platinum Score Max</span>
            <input
              value={ongekiState.platinumScoreMax}
              inputMode="numeric"
              onChange={(event) =>
                updateOngeki("platinumScoreMax", sanitizeDigits(event.target.value, 5))
              }
            />
          </label>

          <label className="control">
            <span>Over Damage %</span>
            <input
              value={ongekiState.overDamage}
              inputMode="decimal"
              onChange={(event) =>
                updateOngeki("overDamage", sanitizeDecimal(event.target.value, 4, 2))
              }
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
              onChange={(event) => updateOngeki("fcLamp", event.target.value as OngekiFcLamp)}
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
              onChange={(event) =>
                updateOngeki("bossLevel", sanitizeDigits(event.target.value, 3))
              }
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
              onChange={(event) =>
                updateOngeki("bpm", sanitizeDigits(event.target.value, 3))
              }
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
  );
}
