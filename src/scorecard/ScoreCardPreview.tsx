import type { RefObject } from "react";
import { ChuniMusicBoxCard } from "./ChuniMusicBoxCard";
import { ChuniScoreCard } from "./ChuniScoreCard";
import { MaiScoreCard } from "./MaiScoreCard";
import { OngekiMusicBtCard } from "./OngekiMusicBtCard";
import { OngekiScoreCard } from "./OngekiScoreCard";
import { ScorecardRenderScaleProvider } from "./ScorecardRenderContext";
import type { ChuniScoreState, ChuniSong } from "./chuniTypes";
import type { OngekiScoreState, OngekiSong } from "./ongekiTypes";
import type { ScoreCardGame } from "./scorecardSurfaceConfig";
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
  stageRef: RefObject<HTMLDivElement | null>;
  stageScale: number;
  assetStatus: "checking" | "ready" | "error";
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
  stageRef,
  stageScale,
  assetStatus,
}: ScoreCardPreviewProps) {
  return (
    <section className="scorecard-preview">
      {assetStatus === "error" ? (
        <div className="scorecard-asset-error" role="alert">
          {import.meta.env.DEV
            ? "Official artwork is unavailable. Run the Cloudflare preview with a seeded ASSETS_BUCKET binding."
            : "Official artwork is temporarily unavailable from the asset store."}
        </div>
      ) : null}
      <div className="scorecard-stage" ref={stageRef}>
        <ScorecardRenderScaleProvider scale={stageScale}>
          {/* Raster-backed text renderers receive this exact fit factor and
              allocate their backing stores for the final on-screen size. */}
          <div className="scorecard-zoom" style={{ zoom: stageScale }}>
            {game === "mai" ? (
              <MaiScoreCard
                song={song}
                chart={chart}
                state={state}
                maxDxScore={maxDxScore}
              />
            ) : game === "chuni" ? (
              chuniState.cardType === "musicbox" ? (
                <ChuniMusicBoxCard song={chuniSong} state={chuniState} />
              ) : (
                <ChuniScoreCard song={chuniSong} state={chuniState} />
              )
            ) : ongekiState.cardType === "musicbt" ? (
              <OngekiMusicBtCard
                song={ongekiSong}
                state={ongekiState}
                bossIconUrl={ongekiSong.bossIconUrl}
                bossIconFallbacks={ongekiSong.bossIconFallbacks}
              />
            ) : (
              <OngekiScoreCard song={ongekiSong} state={ongekiState} />
            )}
          </div>
        </ScorecardRenderScaleProvider>
      </div>
    </section>
  );
}
