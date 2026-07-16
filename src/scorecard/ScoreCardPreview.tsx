import type { RefObject } from "react";
import { ChuniMusicBoxCard } from "./ChuniMusicBoxCard";
import { ChuniScoreCard } from "./ChuniScoreCard";
import { MaiScoreCard } from "./MaiScoreCard";
import { OngekiMusicBtCard } from "./OngekiMusicBtCard";
import { OngekiScoreCard } from "./OngekiScoreCard";
import type { ChuniScoreState, ChuniSong } from "./chuniTypes";
import type { OngekiScoreState, OngekiSong } from "./ongekiTypes";
import { SHOW_SCORECARD_EXPORT, type ScoreCardGame } from "./scorecardSurfaceConfig";
import type { MaiChart, MaiScoreState, MaiSong } from "./types";

interface ScoreCardPreviewProps {
  game: ScoreCardGame;
  song: MaiSong;
  chart: MaiChart;
  state: MaiScoreState;
  maxDxScore: number;
  chuniSong: ChuniSong;
  chuniState: ChuniScoreState;
  ongekiSong: OngekiSong;
  ongekiState: OngekiScoreState;
  captureRef: RefObject<HTMLDivElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  stageScale: number;
  assetStatus: "checking" | "ready" | "error";
  exportingPng: boolean;
  exportError: string;
  onExport: () => Promise<void>;
}

export function ScoreCardPreview({
  game,
  song,
  chart,
  state,
  maxDxScore,
  chuniSong,
  chuniState,
  ongekiSong,
  ongekiState,
  captureRef,
  stageRef,
  stageScale,
  assetStatus,
  exportingPng,
  exportError,
  onExport,
}: ScoreCardPreviewProps) {
  return (
    <section className="scorecard-preview">
      {SHOW_SCORECARD_EXPORT ? (
        <div className="scorecard-toolbar">
          <button
            type="button"
            className="scorecard-export"
            onClick={onExport}
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
  );
}
