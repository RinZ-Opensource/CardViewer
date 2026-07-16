import React from "react";
import type { ChuniSong } from "./chuniTypes";
import type { OngekiSong } from "./ongekiTypes";
import type { ScoreCardGame } from "./scorecardSurfaceConfig";
import {
  type SongDbStatus,
  invalidateSongDbCache,
  loadChuniSongs,
  loadMaiSongs,
  loadOngekiSongs,
} from "./songdb";
import type { MaiSong } from "./types";

export interface ScoreCardSongDb {
  mai: { status: SongDbStatus; songs: MaiSong[] };
  chuni: { status: SongDbStatus; songs: ChuniSong[] };
  ongeki: { status: SongDbStatus; songs: OngekiSong[] };
}

/** Lazily loads each game's song database and rejects stale retry results. */
export function useScoreCardSongDb(game: ScoreCardGame) {
  const [songDb, setSongDb] = React.useState<ScoreCardSongDb>({
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
    invalidateSongDbCache(
      target === "mai" ? "maimai" : target === "chuni" ? "chunithm" : "ongeki",
    );
    songDbStarted.current.delete(target);
    songDbRequestId.current[target] += 1;
    setSongDb((current) => ({
      ...current,
      [target]: { status: "loading", songs: [] },
    }));
    setSongDbReload((current) => current + 1);
  }

  return { songDb, retrySongDb };
}
