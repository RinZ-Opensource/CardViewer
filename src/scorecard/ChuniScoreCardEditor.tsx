import { SongPicker } from "./SongPicker";
import {
  CHUNI_BOX_DIFFICULTY_ORDER,
  CHUNI_DIFFICULTY_LABEL,
  CHUNI_DIFFICULTY_ORDER,
} from "./chuniAssets";
import type {
  ChuniComboLamp,
  ChuniDifficulty,
  ChuniFullChainLamp,
  ChuniScoreState,
  ChuniSong,
  ChuniStartBanner,
  ChuniSuccessLamp,
} from "./chuniTypes";
import { sanitizeDigits, sanitizeLevel } from "./scorecardInput";
import {
  CARD_TYPES,
  CHUNI_BANNER_OPTIONS,
  CHUNI_COMBO_OPTIONS,
  CHUNI_FCHAIN_OPTIONS,
  CHUNI_SUCCESS_OPTIONS,
  SHOW_CHUNI_CONFIRMED_START,
  SHOW_PANEL_CARDS,
  WE_STAR_OPTIONS,
} from "./scorecardSurfaceConfig";
import { chuniHasChart } from "./songdb";
import type { SongDbStatus } from "./songdb";

interface ChuniScoreCardEditorProps {
  songs: ChuniSong[];
  song: ChuniSong;
  state: ChuniScoreState;
  status: SongDbStatus;
  onSelectSong: (song: ChuniSong) => void;
  onSelectDifficulty: (difficulty: ChuniDifficulty) => void;
  onRetry: () => void;
  onUpdate: <Key extends keyof ChuniScoreState>(
    key: Key,
    value: ChuniScoreState[Key],
  ) => void;
}

export function ChuniScoreCardEditor({
  songs: chuniSongs,
  song: chuniSong,
  state: chuniState,
  status,
  onSelectSong: selectChuniSong,
  onSelectDifficulty: selectChuniDifficulty,
  onRetry,
  onUpdate: updateChuni,
}: ChuniScoreCardEditorProps) {
  return (
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
        status={status}
        songKey={(entry) => String(entry.id)}
        onSelect={selectChuniSong}
        onRetry={onRetry}
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
            onChange={(event) => updateChuni("level", sanitizeLevel(event.target.value))}
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
              onChange={(event) =>
                updateChuni("bestScore", sanitizeDigits(event.target.value, 7, 9_999_999))
              }
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
              onChange={(event) =>
                updateChuni("bpm", sanitizeDigits(event.target.value, 4, 9_999))
              }
            />
          </label>

          <label className="control">
            <span>Notes Designer</span>
            <input
              value={chuniState.notesDesigner}
              onChange={(event) => updateChuni("notesDesigner", event.target.value)}
            />
          </label>

          {SHOW_CHUNI_CONFIRMED_START ? (
            <>
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
          ) : null}
        </>
      )}
    </>
  );
}
