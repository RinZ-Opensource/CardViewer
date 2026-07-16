import React from "react";
import { officialHolo } from "./cardData";
import { CARD_TILT_X_MAX, CARD_TILT_Y_MAX } from "./constants";
import { HoloMarker } from "./holo";
import { CardRecord, ViewMode } from "./types";

export function PreviewStage({
  card,
  imageDataUrl,
  mode,
}: {
  card: CardRecord | null;
  imageDataUrl: string;
  mode: ViewMode;
}) {
  const [tilt, setTilt] = React.useState({ x: 0, y: 0 });
  const [flipped, setFlipped] = React.useState(false);
  const [flipAnimating, setFlipAnimating] = React.useState(false);
  const flipTimerRef = React.useRef<number | null>(null);
  const tiltFrameRef = React.useRef<number | null>(null);
  const pendingTiltRef = React.useRef<{ x: number; y: number } | null>(null);
  const holo = card ? officialHolo(card) : false;
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
    // don't re-render + repaint the card many times per frame.
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
          <CardCanvas key={cardRenderKey} card={card} imageDataUrl={imageDataUrl} />
          {card && holo ? (
            <HoloMarker key={`holo:${cardRenderKey}`} card={card} lightStyle={lightStyle} />
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

function cardLightStyle(
  tilt: { x: number; y: number },
  mode: ViewMode,
): React.CSSProperties {
  if (mode !== "3d") {
    return {
      "--holo-light-x": "32%",
      "--holo-light-y": "22%",
      "--holo-pointer-x": "32%",
      "--holo-pointer-y": "22%",
      "--holo-pointer-from-center": "0.35",
      "--holo-pointer-from-left": "0.32",
      "--holo-pointer-from-top": "0.22",
      "--holo-bg-x": "47%",
      "--holo-bg-y": "40%",
      "--holo-bg-x-inv": "53%",
      "--holo-bg-y-inv": "60%",
      "--holo-fine-x": "56%",
      "--holo-fine-y": "43%",
      "--holo-shift-x": "-3px",
      "--holo-shift-y": "-4px",
      "--holo-shift-x-inv": "3px",
      "--holo-shift-y-inv": "4px",
      "--holo-opacity": "0.88",
      "--holo-sparkle-opacity": "0.96",
      "--holo-glare-opacity": "0.5",
      "--holo-hue": "0deg",
      "--holo-spectrum-angle": "108deg",
      "--edge-light-left": "0.22",
      "--edge-light-right": "0.18",
    } as React.CSSProperties;
  }

  const pointerX = clampNumber(50 + (tilt.y / CARD_TILT_Y_MAX) * 50, 0, 100);
  const pointerY = clampNumber(50 - (tilt.x / CARD_TILT_X_MAX) * 50, 0, 100);
  const bgX = clampNumber(37 + pointerX * 0.26, 37, 63);
  const bgY = clampNumber(33 + pointerY * 0.34, 33, 67);
  const bgXInv = 100 - bgX;
  const bgYInv = 100 - bgY;
  const distanceFromCenter = clampNumber(Math.hypot(pointerX - 50, pointerY - 50) / 50, 0, 1);
  const lightX = clampNumber(32 - tilt.y * 1.28, 6, 94);
  const lightY = clampNumber(22 + tilt.x * 1.18, 6, 86);
  const leftEdge = clampNumber(0.22 + tilt.y / 85, 0.04, 0.48);
  const rightEdge = clampNumber(0.18 - tilt.y / 85, 0.04, 0.48);
  const shiftX = clampNumber((bgX - 50) * 0.78, -14, 14);
  const shiftY = clampNumber((bgY - 50) * 0.58, -12, 12);
  // Angle-dependent hue sweep for the foil: horizontal tilt dominates, vertical
  // adds a secondary shift so the spectrum travels as the card moves.
  const holoHue = clampNumber((pointerX - 50) * 3.4 + (pointerY - 50) * 1.5, -210, 210);
  const spectrumAngle = clampNumber(
    108 + (pointerX - 50) * 0.7 - (pointerY - 50) * 0.5,
    70,
    150,
  );

  return {
    "--holo-light-x": `${lightX}%`,
    "--holo-light-y": `${lightY}%`,
    "--holo-pointer-x": `${pointerX}%`,
    "--holo-pointer-y": `${pointerY}%`,
    "--holo-pointer-from-center": `${distanceFromCenter}`,
    "--holo-pointer-from-left": `${pointerX / 100}`,
    "--holo-pointer-from-top": `${pointerY / 100}`,
    "--holo-bg-x": `${bgX}%`,
    "--holo-bg-y": `${bgY}%`,
    "--holo-bg-x-inv": `${bgXInv}%`,
    "--holo-bg-y-inv": `${bgYInv}%`,
    "--holo-fine-x": `${clampNumber(50 + (50 - bgX) * 1.35, 14, 86)}%`,
    "--holo-fine-y": `${clampNumber(50 + (bgY - 50) * 1.2, 12, 88)}%`,
    "--holo-shift-x": `${shiftX}px`,
    "--holo-shift-y": `${shiftY}px`,
    "--holo-shift-x-inv": `${-shiftX}px`,
    "--holo-shift-y-inv": `${-shiftY}px`,
    "--holo-opacity": `${0.84 + distanceFromCenter * 0.14}`,
    "--holo-sparkle-opacity": `${0.86 + distanceFromCenter * 0.12}`,
    "--holo-glare-opacity": `${0.28 + distanceFromCenter * 0.42}`,
    "--holo-hue": `${holoHue}deg`,
    "--holo-spectrum-angle": `${spectrumAngle}deg`,
    "--edge-light-left": String(leftEdge),
    "--edge-light-right": String(rightEdge),
  } as React.CSSProperties;
}

function CardCanvas({
  card,
  imageDataUrl,
}: {
  card: CardRecord | null;
  imageDataUrl: string;
}) {
  if (!card) {
    return (
      <div className="preview-placeholder">
        <strong>CARD</strong>
        <span>No selection</span>
      </div>
    );
  }

  return <PublicCompositeCard card={card} imageDataUrl={imageDataUrl} />;
}

function PublicCompositeCard({
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

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
