import type { CSSProperties } from "react";

import { USE_OFFICIAL_ASSETS } from "../constants";
import type { CardRecord } from "../types";
import { ChuOfficialCard } from "./ChuOfficialCard";
import { MaiOfficialCard } from "./MaiOfficialCard";
import { Mu3OfficialCard } from "./Mu3OfficialCard";

export function OfficialCardCanvas({
  card,
  imageDataUrl,
  assetDataUrls,
  lightStyle,
}: {
  card: CardRecord | null;
  imageDataUrl: string;
  assetDataUrls: Record<string, string>;
  lightStyle: CSSProperties;
}) {
  if (!card) {
    return (
      <div className="preview-placeholder">
        <strong>CARD</strong>
        <span>No selection</span>
      </div>
    );
  }

  if (!USE_OFFICIAL_ASSETS) {
    return <PublicCardCanvas card={card} imageDataUrl={imageDataUrl} />;
  }

  if (card.game === "CHU") {
    return <ChuOfficialCard card={card} imageDataUrl={imageDataUrl} />;
  }

  if (card.game === "MAI") {
    return (
      <MaiOfficialCard
        card={card}
        imageDataUrl={imageDataUrl}
        assetDataUrls={assetDataUrls}
        lightStyle={lightStyle}
      />
    );
  }

  return (
    <Mu3OfficialCard
      card={card}
      imageDataUrl={imageDataUrl}
      assetDataUrls={assetDataUrls}
      lightStyle={lightStyle}
    />
  );
}

export function PublicCardCanvas({
  card,
  imageDataUrl,
}: {
  card: CardRecord;
  imageDataUrl: string;
}) {
  return (
    <div className={`official-card public-card public-card-${card.game.toLowerCase()}`}>
      <div className="public-card-bg" />
      {imageDataUrl ? (
        <img className="public-card-art" src={imageDataUrl} alt="" decoding="async" fetchPriority="high" />
      ) : (
        <div className="public-card-emblem">{card.game}</div>
      )}
    </div>
  );
}
