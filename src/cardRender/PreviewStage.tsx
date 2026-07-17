import React from "react";

import { officialHolo } from "../cardData/holoRules";
import { CARD_TILT_X_MAX, CARD_TILT_Y_MAX, USE_OFFICIAL_ASSETS } from "../constants";
import { HoloShaderLayer } from "../holo";
import type { CardRecord, ViewMode } from "../types";
import { cardLightStyle } from "./cardLighting";
import { OfficialCardCanvas } from "./OfficialCardCanvas";

export function PreviewStage({
  card,
  imageDataUrl,
  assetDataUrls,
  mode,
}: {
  card: CardRecord | null;
  imageDataUrl: string;
  assetDataUrls: Record<string, string>;
  mode: ViewMode;
}) {
  const [tilt, setTilt] = React.useState({ x: 0, y: 0 });
  const [flipped, setFlipped] = React.useState(false);
  const [flipAnimating, setFlipAnimating] = React.useState(false);
  const flipTimerRef = React.useRef<number | null>(null);
  const tiltFrameRef = React.useRef<number | null>(null);
  const pendingTiltRef = React.useRef<{ x: number; y: number } | null>(null);
  const holo = card ? officialHolo(card) : false;
  // Official MU3 and MAI cards paint their holo inline (inside .official-card);
  // the stage overlay only handles the remaining cases (e.g. public mode).
  const renderStageHolo =
    !!card &&
    holo &&
    !(USE_OFFICIAL_ASSETS && ((card.game === "MU3" && card.recordType === "Card") || card.game === "MAI"));
  const cardRenderKey = card ? `${card.game}:${card.recordType}:${card.dataName}` : "empty";
  const lightStyle = cardLightStyle(tilt, mode);
  const previewTransform =
    mode === "3d"
      ? `rotateX(${tilt.x}deg) rotateY(${tilt.y + (flipped ? 180 : 0)}deg) translateZ(0)`
      : flipped
        ? "rotateY(180deg) translateZ(0)"
        : "none";

  React.useEffect(() => {
    setFlipped(false);
    setFlipAnimating(false);
    if (flipTimerRef.current !== null) {
      window.clearTimeout(flipTimerRef.current);
      flipTimerRef.current = null;
    }
  }, [cardRenderKey]);

  React.useEffect(() => {
    return () => {
      if (flipTimerRef.current !== null) {
        window.clearTimeout(flipTimerRef.current);
      }
    };
  }, []);

  function onMove(event: React.MouseEvent<HTMLDivElement>) {
    if (mode !== "3d") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    // Coalesce rapid mousemove events into one tilt update per frame so we
    // don't re-render + repaint the card (and its holo) many times per frame.
    pendingTiltRef.current = { x: y * -CARD_TILT_X_MAX * 2, y: x * CARD_TILT_Y_MAX * 2 };
    if (tiltFrameRef.current === null) {
      tiltFrameRef.current = window.requestAnimationFrame(() => {
        tiltFrameRef.current = null;
        if (pendingTiltRef.current) setTilt(pendingTiltRef.current);
      });
    }
  }

  function resetTilt() {
    if (tiltFrameRef.current !== null) {
      window.cancelAnimationFrame(tiltFrameRef.current);
      tiltFrameRef.current = null;
    }
    pendingTiltRef.current = null;
    setTilt({ x: 0, y: 0 });
  }

  React.useEffect(() => {
    return () => {
      if (tiltFrameRef.current !== null) window.cancelAnimationFrame(tiltFrameRef.current);
    };
  }, []);

  function toggleFlip() {
    if (!card) return;
    if (flipTimerRef.current !== null) {
      window.clearTimeout(flipTimerRef.current);
    }
    setFlipAnimating(true);
    setFlipped((value) => !value);
    flipTimerRef.current = window.setTimeout(() => {
      setFlipAnimating(false);
      flipTimerRef.current = null;
    }, 460);
  }

  function onPreviewKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleFlip();
  }

  function onPreviewMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
  }

  return (
    <section className="preview-stage" onMouseMove={onMove} onMouseLeave={resetTilt}>
      <div
        className={`card-preview ${mode} ${flipped ? "flipped" : ""} ${flipAnimating ? "is-flipping" : ""}`}
        role="button"
        tabIndex={card ? 0 : -1}
        aria-label={flipped ? "Flip card to front" : "Flip card to back"}
        aria-pressed={flipped}
        onMouseDown={onPreviewMouseDown}
        onClick={toggleFlip}
        onKeyDown={onPreviewKeyDown}
        style={{ transform: previewTransform }}
      >
        <div className="card-face">
          <OfficialCardCanvas
            key={cardRenderKey}
            card={card}
            imageDataUrl={imageDataUrl}
            assetDataUrls={assetDataUrls}
            lightStyle={lightStyle}
          />
          {renderStageHolo ? (
            <HoloShaderLayer
              key={`holo:${cardRenderKey}`}
              card={card}
              assetDataUrls={assetDataUrls}
              lightStyle={lightStyle}
            />
          ) : null}
          <div className="edge-light" style={lightStyle} />
        </div>
        <div className="card-back-face" aria-hidden="true" />
      </div>

      {card ? (
        <div className="preview-meta">
          <span>{card.game}</span>
          <span>{card.printFields.length} print fields</span>
          <span>{holo ? "Holo" : "Normal"}</span>
        </div>
      ) : null}
    </section>
  );
}
