import React from "react";
import { SongDbStatus, jacketImgProps } from "./songdb";

/** Minimal shape the picker needs; Mai/Chuni/Ongeki songs all satisfy it. */
export interface SongPickerSong {
  title: string;
  artist: string;
  jacketUrl: string;
  jacketFallbacks?: string[];
}

interface SongPickerProps<Song extends SongPickerSong> {
  songs: Song[];
  selected: Song;
  /** DB load state; the songs list already falls back to the bundled samples. */
  status: SongDbStatus;
  songKey: (song: Song) => string;
  /** Optional title suffix, e.g. maimai ［DX］/［スタンダード］. */
  songBadge?: (song: Song) => string | undefined;
  onSelect: (song: Song) => void;
  onRetry?: () => void;
}

/** Case- and kana-insensitive search key (NFKC + katakana folded to hiragana). */
function searchKey(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (kana) => String.fromCharCode(kana.charCodeAt(0) - 0x60));
}

/** Row cap so an empty query doesn't render the full 1500+ song list. */
const MAX_ROWS = 50;

const SCREEN_READER_ONLY: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

/**
 * Searchable song dropdown shared by the three score-card forms: type to
 * filter title+artist, arrows + Enter to pick, Escape to close. Closed, the
 * input shows the selected song; focusing or re-clicking it clears for a
 * fresh search while keeping the current selection as the placeholder.
 */
export function SongPicker<Song extends SongPickerSong>({
  songs,
  selected,
  status,
  songKey,
  songBadge,
  onSelect,
  onRetry,
}: SongPickerProps<Song>) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  const listRef = React.useRef<HTMLUListElement | null>(null);
  const instanceId = React.useId().replace(/:/g, "");
  const labelId = `${instanceId}-song-label`;
  const inputId = `${instanceId}-song-input`;
  const listId = `${instanceId}-song-listbox`;
  const statusId = `${instanceId}-song-status`;

  const { filtered, totalMatches } = React.useMemo(() => {
    const needle = searchKey(query.trim());
    const matches = needle
      ? songs.filter((song) => searchKey(`${song.title}\n${song.artist}`).includes(needle))
      : songs;
    return {
      filtered: matches.slice(0, MAX_ROWS),
      totalMatches: matches.length,
    };
  }, [songs, query]);

  function optionId(song: Song) {
    const key = encodeURIComponent(songKey(song)).replace(/%/g, "-") || "empty";
    return `${listId}-option-${key}`;
  }

  const activeSong = open ? filtered[highlight] : undefined;
  const activeOptionId = activeSong ? optionId(activeSong) : undefined;
  const selectedKey = songKey(selected);

  React.useEffect(() => {
    setHighlight(0);
  }, [query, songs]);

  React.useEffect(() => {
    if (!open || filtered.length === 0) return;
    const row = listRef.current?.children[highlight] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest" });
  }, [open, highlight, filtered.length]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function beginSearch() {
    setOpen(true);
    setQuery("");
    setHighlight(0);
  }

  function choose(song: Song) {
    onSelect(song);
    close();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) {
          setOpen(true);
          setHighlight(0);
        } else if (filtered.length > 0) {
          setHighlight((index) => Math.min(filtered.length - 1, index + 1));
        }
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) {
          setOpen(true);
          setHighlight(Math.max(0, filtered.length - 1));
        } else if (filtered.length > 0) {
          setHighlight((index) => Math.max(0, index - 1));
        }
        break;
      case "Home":
        if (open && filtered.length > 0) {
          event.preventDefault();
          setHighlight(0);
        }
        break;
      case "End":
        if (open && filtered.length > 0) {
          event.preventDefault();
          setHighlight(filtered.length - 1);
        }
        break;
      case "Enter": {
        if (!open) {
          event.preventDefault();
          setOpen(true);
          setHighlight(0);
          break;
        }
        const song = filtered[highlight];
        if (song) {
          event.preventDefault();
          choose(song);
        }
        break;
      }
      case "Escape":
        if (open || query) {
          event.preventDefault();
          close();
        }
        break;
      default:
        break;
    }
  }

  const selectedLabel = `${selected.title}${songBadge?.(selected) ?? ""}`;
  const statusText =
    status === "loading"
      ? "Song database loading…"
      : status === "error"
        ? "Song database unavailable — using bundled samples"
        : null;
  const resultStatusText = open
    ? totalMatches === 0
      ? "No matching songs."
      : totalMatches > MAX_ROWS
        ? `${totalMatches} songs found; showing the first ${MAX_ROWS}.`
        : `${totalMatches} songs found.`
    : "";
  const liveStatusText = [statusText, resultStatusText].filter(Boolean).join(" ");

  return (
    <div className="control songpicker">
      <span id={labelId}>Song</span>
      <input
        id={inputId}
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeOptionId}
        aria-labelledby={labelId}
        aria-describedby={liveStatusText ? statusId : undefined}
        aria-busy={status === "loading"}
        autoComplete="off"
        value={open ? query : selectedLabel}
        placeholder={selectedLabel}
        onPointerDown={(event) => {
          // Selecting an option deliberately keeps focus on this input. A
          // subsequent click therefore has no focus event, so reopen and
          // clear the visible value from pointer-down as well.
          if (event.button === 0 && !open) beginSearch();
        }}
        onFocus={beginSearch}
        onBlur={close}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {statusText ? (
        <span className="songpicker-status-row">
          <span className="songpicker-status" aria-hidden="true">{statusText}</span>
          {status === "error" && onRetry ? (
            <button
              type="button"
              className="songpicker-retry"
              onPointerDown={(event) => event.preventDefault()}
              onClick={onRetry}
            >
              Retry
            </button>
          ) : null}
        </span>
      ) : null}
      <span
        id={statusId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={SCREEN_READER_ONLY}
      >
        {liveStatusText}
      </span>
      {open ? (
        <ul
          className="songpicker-list"
          id={listId}
          ref={listRef}
          role="listbox"
          aria-labelledby={labelId}
          aria-busy={status === "loading"}
        >
          {filtered.length === 0 ? (
            <li
              className="songpicker-empty"
              role="option"
              aria-disabled="true"
              aria-selected="false"
            >
              No matching songs
            </li>
          ) : (
            filtered.map((song, index) => (
              <li
                key={songKey(song)}
                id={optionId(song)}
                role="option"
                aria-selected={songKey(song) === selectedKey}
                className={`songpicker-row${index === highlight ? " active" : ""}`}
                // Keep focus on the combobox so its active-descendant model
                // remains intact, then select through the regular click path.
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(song)}
                onPointerEnter={() => setHighlight(index)}
              >
                <img
                  className="songpicker-thumb"
                  loading="lazy"
                  decoding="async"
                  alt=""
                  {...jacketImgProps(song.jacketUrl, song.jacketFallbacks)}
                />
                <span className="songpicker-text">
                  <span className="songpicker-title">
                    {song.title}
                    {songBadge?.(song) ?? ""}
                  </span>
                  <span className="songpicker-artist">{song.artist}</span>
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
