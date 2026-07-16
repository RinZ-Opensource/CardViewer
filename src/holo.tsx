import React from "react";
import { CardRecord } from "./types";

// Public Cloudflare cards use their exported composite artwork. Keep the
// public holo container so the existing preview DOM and CSS behavior remain
// stable without reviving the private runtime mask renderer.
export function HoloMarker({
  card,
  lightStyle,
}: {
  card: CardRecord;
  lightStyle: React.CSSProperties;
}) {
  return (
    <div
      className={`holo-layer holo-public holo-${card.game.toLowerCase()}`}
      style={lightStyle}
    />
  );
}
