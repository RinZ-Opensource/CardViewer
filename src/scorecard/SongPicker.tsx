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

/**
 * Searchable song dropdown shared by the three score-card forms: type to
 * filter title+artist, arrows + Enter to pick, Escape to close. Closed, the
 * input shows the selected song; focusing it clears for a fresh search.
 */
export function SongPicker<Song extends SongPickerSong>({
  songs,
  selected,
  status,
  songKey,
  songBadge,
  onSelect,
}: SongPickerProps<Song>) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  const listRef = React.useRef<HTMLUListElement | null>(null);

  const filtered = React.useMemo(() => {
    const needle = searchKey(query.trim());
    const matches = needle
      ? songs.filter((song) => searchKey(`${song.title}\n${song.artist}`).includes(needle))
      : songs;
    return matches.slice(0, MAX_ROWS);
  }, [songs, query]);

  React.useEffect(() => {
    setHighlight(0);
  }, [query, songs]);

  React.useEffect(() => {
    if (!open) return;
    const row = listRef.current?.children[highlight] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function choose(song: Song) {
    onSelect(song);
    close();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (open) setHighlight((index) => Math.min(filtered.length - 1, index + 1));
      else setOpen(true);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      const song = filtered[highlight];
      if (open && song) {
        event.preventDefault();
        choose(song);
      }
    } else if (event.key === "Escape") {
      close();
    }
  }

  const selectedLabel = `${selected.title}${songBadge?.(selected) ?? ""}`;
  const statusText =
    status === "loading" ? "DB加载中…" : status === "error" ? "DB不可用（使用内置示例）" : null;

  return (
    <label className="control songpicker">
      <span>Song</span>
      <input
        value={open ? query : selectedLabel}
        placeholder={selectedLabel}
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setHighlight(0);
        }}
        onBlur={close}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {statusText ? <span className="songpicker-status">{statusText}</span> : null}
      {open ? (
        <ul className="songpicker-list" ref={listRef}>
          {filtered.length === 0 ? (
            <li className="songpicker-empty">无匹配歌曲</li>
          ) : (
            filtered.map((song, index) => (
              <li
                key={songKey(song)}
                className={`songpicker-row${index === highlight ? " active" : ""}`}
                // mousedown (not click) + preventDefault: select before the
                // input's blur closes the list, without stealing its focus.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(song);
                }}
                onMouseEnter={() => setHighlight(index)}
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
    </label>
  );
}
