import React from "react";
import { Mu3LimitBreakStars, clampInt, fieldBool, fieldNumber, fieldString, formatDisplaySerial, formatMaiEndDate, maiCardTypeEffects, maiEffectIconAsset, maiFrameAssets, maiOfficialHolo, maiRatingBaseAsset, mu3AttackValue, mu3AttributeName, mu3AwakenMarkAsset, mu3CardNames, mu3FrameAsset, mu3NeedsSign, mu3RareSpriteName, mu3RarityKind, mu3ShowMainFrame, mu3SkillAsset, numericField, officialHolo, qrSource, twoDigits } from "./cardData";
import { CANVAS_FONT_SEGA_MARU_DB, CARD_TILT_X_MAX, CARD_TILT_Y_MAX, MAI_CHARA_NAME_RECT, MAI_END_DATE_RECT, MAI_NAME_BASE_RECT, MAI_PERIOD_LABEL_RECT, MU3_AWAKEN_MARK_RECT, USE_OFFICIAL_ASSETS, officialAsset } from "./constants";
import { HoloShaderLayer } from "./holo";
import { ImageLoadPriority, isStaticAssetPath } from "./imageLoader";
import { LayerCanvasText, LayerChuCounter, LayerDigitCounter, LayerImage, LayerQr, LayerTmpText, LayerUnityText } from "./layers";
import { clampNumber } from "./textRendering";
import { AssetLayer, CardRecord, ViewMode } from "./types";

export function PreviewStage({
  card,
  imageDataUrl,
  assetDataUrls,
  mode,
  captureRef,
}: {
  card: CardRecord | null;
  imageDataUrl: string;
  assetDataUrls: Record<string, string>;
  mode: ViewMode;
  captureRef?: React.Ref<HTMLDivElement>;
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
        style={{
          transform: previewTransform,
        }}
      >
        <div className="card-face" ref={captureRef}>
          <OfficialCardCanvas
            key={cardRenderKey}
            card={card}
            imageDataUrl={imageDataUrl}
            assetDataUrls={assetDataUrls}
            lightStyle={lightStyle}
          />
          {renderStageHolo ? <HoloShaderLayer key={`holo:${cardRenderKey}`} card={card} assetDataUrls={assetDataUrls} lightStyle={lightStyle} /> : null}
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

export function cardLightStyle(tilt: { x: number; y: number }, mode: ViewMode): React.CSSProperties {
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
  // Drive a strong, angle-dependent hue sweep for the holographic foil.
  // Horizontal tilt does most of the work; vertical adds a secondary shift so
  // the spectrum visibly travels as the card is moved in any direction.
  const holoHue = clampNumber((pointerX - 50) * 3.4 + (pointerY - 50) * 1.5, -210, 210);
  const spectrumAngle = clampNumber(108 + (pointerX - 50) * 0.7 - (pointerY - 50) * 0.5, 70, 150);

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

export function visibleAssetLayers(card: CardRecord | null, streamingAssets?: string) {
  if (!card) return [];
  const layers = card.assetLayers ?? [];
  if (card.game === "MAI") {
    const dynamicLayers = streamingAssets ? dynamicMaiAssetLayers(card, streamingAssets) : [];
    const dynamicKeys = new Set(dynamicLayers.map((layer) => layer.key));
    const fallbackLayers = layers
      .filter((layer) => dynamicKeys.has(layer.key))
      .map(maiFallbackAssetLayer);
    const mergedLayers = [
      ...dynamicLayers,
      ...fallbackLayers,
      ...layers.filter((layer) => !dynamicKeys.has(layer.key)),
    ];
    return mergedLayers.filter((layer) => !isMaiMaskLayer(layer.key) || maiOfficialHolo(card));
  }
  if (card.game === "MU3") {
    return layers.filter((layer) => {
      if (layer.key === "mu3Mask" || layer.key === "mu3Holo") return officialHolo(card);
      if (layer.key === "mu3Sign" || layer.key === "mu3SignMask") {
        return officialHolo(card) && mu3NeedsSign(card);
      }
      if (layer.key === "mu3Grade") return !fieldBool(card, "hideGrade");
      if (layer.key === "mu3Rights") return numericField(card, "rightsId", 0) > 0;
      return true;
    });
  }
  return layers;
}

export function maiFallbackAssetLayer(layer: AssetLayer): AssetLayer {
  const fallbackKey =
    layer.key === "maiBase"
      ? "maiBaseFallback"
      : layer.key === "maiChara"
        ? "maiCharaFallback"
        : layer.key === "maiMask"
          ? "maiMaskFallback"
          : `${layer.key}Fallback`;
  return {
    ...layer,
    key: fallbackKey,
    label: `${layer.label} fallback`,
  };
}

export function isMaiMaskLayer(key: string) {
  return key === "maiMask" || key === "maiMaskFallback";
}

export function selectedAssetSignature(card: CardRecord | null, streamingAssets?: string) {
  return visibleAssetLayers(card, streamingAssets)
    .map((layer) => `${layer.key}:${layer.path}`)
    .join("|");
}

export function assetLayerLoadPriority(layer: AssetLayer): ImageLoadPriority {
  return ["mu3Mask", "mu3Holo", "mu3Sign", "mu3SignMask"].includes(layer.key) ? "normal" : "high";
}

export function joinAssetPath(root: string, stem: string) {
  if (isStaticAssetPath(root)) {
    const normalizedRoot = root.replace(/\/+$/, "");
    const fileName = stem.match(/\.(png|jpg|jpeg|webp)$/i) ? stem : `${stem}.png`;
    return `${normalizedRoot}/${fileName}`;
  }
  return `${root}\\${stem}`;
}

export function dynamicMaiAssetLayers(card: CardRecord, streamingAssets: string): AssetLayer[] {
  const typeId = numericField(card, "typeId", -1);
  const charaId = numericField(card, "charaId", -1);
  const choice = maiCharaChoice(card, charaId);
  const mapId = choice?.mapId ?? numericField(card, "mapId", -1);
  const root = fieldString(card, "maiAssetRoot") || `${streamingAssets}\\assets_mai`;
  const layers: AssetLayer[] = [];
  if (typeId >= 0 && mapId >= 0) {
    layers.push({
      key: "maiBase",
      label: "MAI card base",
      path: joinAssetPath(
        root,
        `ui_cardbase_${String(typeId).padStart(7, "0")}_${String(mapId).padStart(6, "0")}`,
      ),
    });
  }
  if (charaId > 0) {
    layers.push({
      key: "maiChara",
      label: "MAI character layer",
      path: joinAssetPath(root, `ui_cardchara_${String(charaId).padStart(6, "0")}`),
    });
    layers.push({
      key: "maiMask",
      label: "MAI holo character mask",
      path: joinAssetPath(root, `ui_cardcharamask_${String(charaId).padStart(6, "0")}`),
    });
  }
  return layers;
}

export type MaiCharaChoice = {
  id: number;
  mapId: number;
  uniqueId: number;
  name: string;
};

export function maiCharaChoice(card: CardRecord, charaId: number): MaiCharaChoice | null {
  return parseMaiCharaChoices(fieldString(card, "charaChoices")).find((choice) => choice.id === charaId) ?? null;
}

export function parseMaiCharaChoices(value: string): MaiCharaChoice[] {
  return value
    .split(/\r?\n/)
    .map((line) => {
      const [idText, mapText, uniqueText, ...nameParts] = line.split("|");
      const id = Number(idText);
      const mapId = Number(mapText);
      const uniqueId = Number(uniqueText);
      if (!Number.isFinite(id) || !Number.isFinite(mapId) || !Number.isFinite(uniqueId)) return null;
      return {
        id,
        mapId,
        uniqueId,
        name: nameParts.join("|") || String(id),
      };
    })
    .filter((choice): choice is MaiCharaChoice => choice !== null);
}

export function OfficialCardCanvas({
  card,
  imageDataUrl,
  assetDataUrls,
  lightStyle,
}: {
  card: CardRecord | null;
  imageDataUrl: string;
  assetDataUrls: Record<string, string>;
  lightStyle: React.CSSProperties;
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
    return <MaiOfficialCard card={card} imageDataUrl={imageDataUrl} assetDataUrls={assetDataUrls} lightStyle={lightStyle} />;
  }

  return <Mu3OfficialCard card={card} imageDataUrl={imageDataUrl} assetDataUrls={assetDataUrls} lightStyle={lightStyle} />;
}

export function usesPrimaryImageDataUrl(card: CardRecord) {
  return !(USE_OFFICIAL_ASSETS && card.game === "MU3" && card.recordType === "Card");
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
        <img className="public-card-art" src={imageDataUrl} alt="" />
      ) : (
        <div className="public-card-emblem">{card.game}</div>
      )}
    </div>
  );
}

export function ChuOfficialCard({
  card,
  imageDataUrl,
}: {
  card: CardRecord;
  imageDataUrl: string;
}) {
  const labelType = clampInt(fieldNumber(card, "labelType", card.labelType ?? 0), 0, 7);
  const difType = clampInt(fieldNumber(card, "difType", card.difType ?? 3), 0, 3);
  const difficultyBase = ["Basic", "Advanced", "Expert", "Master"][difType] ?? "Master";
  const label = twoDigits(labelType);

  return (
    <div className="official-card official-chu">
      {!fieldBool(card, "hideBackGround") ? (
        <LayerImage src={officialAsset(`UI_CCH_Card_BG_${label}`)} x={0} y={0} w={768} h={1052} />
      ) : null}
      {imageDataUrl && !fieldBool(card, "hideChara") ? (
        <LayerImage src={imageDataUrl} x={0} y={0} w={768} h={1052} />
      ) : null}
      {!fieldBool(card, "hideParam") ? (
        <LayerImage
          src={officialAsset(`UI_CCH_Card_Parameter_Base_${difficultyBase}`)}
          x={0}
          y={0}
          w={768}
          h={1052}
        />
      ) : null}
      {!fieldBool(card, "hideParam") ? (
        <>
          <LayerImage src={officialAsset(`UI_CCH_Card_Label_${label}`)} x={-335} y={-40.8} w={125} h={36} rotation={-90} />
          <LayerImage src={officialAsset(`UI_CCH_Card_Label_${label}`)} x={-100} y={-476} w={125} h={36} />
          <LayerImage src={officialAsset(`UI_CCH_Card_Label_${label}`)} x={334} y={-241.6} w={125} h={36} rotation={90} />
          <LayerImage src={officialAsset(`UI_CCH_Card_LabelLogo_${label}`)} x={210.3} y={353.4} w={341} h={176} />
        </>
      ) : null}
      {!fieldBool(card, "hideSerialId") && !fieldBool(card, "hideParam") ? (
        <LayerUnityText className="official-serial chu-serial" fontKey="kaku40" fontSize={16} alignment={1} fitHorizontal x={0} y={485.9} w={258.9} h={18}>
          {formatDisplaySerial(fieldString(card, "serialId"))}
        </LayerUnityText>
      ) : null}
      {!fieldBool(card, "hideParam") ? (
        <LayerUnityText className="official-title chu-title" fontKey="kaku40" fontSize={24} alignment={1} fitHorizontal x={0} y={460.7} w={688} h={27}>
          {fieldString(card, "characterName") || card.displayName}
        </LayerUnityText>
      ) : null}
      {!fieldBool(card, "hideParam") ? (
        <>
          <LayerUnityText className="official-skill-name chu-skill-name" fontKey="kaku40" fontSize={24} alignment={1} fitHorizontal x={0} y={-351} w={590} h={27}>
            {fieldString(card, "skillName")}
          </LayerUnityText>
          <LayerUnityText className="official-skill-body chu-skill-body" fontKey="kaku40" fontSize={24} alignment={0} lineSpacing={1.2} fitHorizontal x={0} y={-402.7} w={590} h={53.2}>
            {fieldString(card, "skillText")}
          </LayerUnityText>
          <LayerChuCounter value={fieldString(card, "miss") || "0"} x={-330} y={-383} rotation={-90} />
          <LayerChuCounter value={fieldString(card, "combo") || "0"} x={240} y={-471} />
          <LayerChuCounter value={fieldString(card, "chain") || "0"} x={329} y={100} rotation={90} />
        </>
      ) : null}
    </div>
  );
}

export function MaiOfficialCard({
  card,
  imageDataUrl,
  assetDataUrls,
  lightStyle,
}: {
  card: CardRecord;
  imageDataUrl: string;
  assetDataUrls: Record<string, string>;
  lightStyle: React.CSSProperties;
}) {
  const hasFriendCode = fieldBool(card, "hasFriendCode");
  const serial = fieldString(card, "serialId");
  const baseFallbackSrc = assetDataUrls.maiBaseFallback || imageDataUrl || "/official/MAI_cardbase_default.png";
  const baseSrc = assetDataUrls.maiBase || baseFallbackSrc;
  const charaFallbackSrc = assetDataUrls.maiCharaFallback;
  const charaSrc = assetDataUrls.maiChara || charaFallbackSrc;
  const hideSerialAndQR = fieldBool(card, "hideSerialAndQR");
  const hidePlayerName = fieldBool(card, "hidePlayerName");
  const hideRating = fieldBool(card, "hideRating");
  const hideFrame = fieldBool(card, "hideFrame");
  const hideCardIcon = fieldBool(card, "hideCardIcon");
  const hideCharaNameAndPeriod = fieldBool(card, "hideCharaNameAndPeriod");
  const hideFriendCode = fieldBool(card, "hideFriendCode");
  const hideChara = fieldBool(card, "hideChara");
  const { frameAsset, passAsset, passRect } = maiFrameAssets(card);
  const ratingBase = maiRatingBaseAsset(card);
  const effects = maiCardTypeEffects(card);
  const effectIconAsset = maiEffectIconAsset(card);

  return (
    <div className="official-card official-mai">
      <LayerImage src={baseSrc} fallbackSrc={baseFallbackSrc} x={0} y={0} w={768} h={1052} />
      {charaSrc && !hideChara ? (
        <LayerImage src={charaSrc} fallbackSrc={charaFallbackSrc} x={0} y={0} w={768} h={1052} />
      ) : null}
      {frameAsset && !hideFrame ? (
        <LayerImage src={officialAsset(frameAsset)} x={0} y={0} w={768} h={1052} />
      ) : null}
      {!hideCharaNameAndPeriod ? (
        <>
          <LayerImage src={officialAsset("UI_CMA_Name_Base_00")} {...MAI_NAME_BASE_RECT} />
          <LayerUnityText className="official-code mai-period-label" fontKey="maru32" fontSize={15} alignment={4} color="#5a3900" glyphOffsetY={8} {...MAI_PERIOD_LABEL_RECT}>
            ブースト期限
          </LayerUnityText>
          <LayerUnityText className="official-code mai-chara" fontKey="maru32" fontSize={15} alignment={4} color="#5a3900" fitHorizontal glyphOffsetY={5} {...MAI_CHARA_NAME_RECT}>
            {fieldString(card, "charaName") || card.displayName}
          </LayerUnityText>
          <LayerUnityText className="official-code mai-period" fontKey="maru32" fontSize={20} alignment={1} color="#5a3900" glyphOffsetY={4} {...MAI_END_DATE_RECT}>
            {formatMaiEndDate(fieldString(card, "endDate"))}
          </LayerUnityText>
        </>
      ) : null}
      {passAsset && !hideFrame ? (
        <LayerImage src={officialAsset(passAsset)} {...passRect} />
      ) : null}
      {effectIconAsset && !hideCardIcon ? (
        <LayerImage src={officialAsset(effectIconAsset)} x={-303} y={-403} w={112} h={112} />
      ) : null}
      {effects.master && !hideCardIcon ? (
        <LayerImage src={officialAsset("UI_CMA_Icon_Master_00")} x={-193.2} y={-403} w={112} h={112} />
      ) : null}
      {effects.ratingMusic && !hideCardIcon ? (
        <LayerImage src={officialAsset("UI_CMA_Icon_Rating_00")} x={-84} y={-403} w={112} h={112} />
      ) : null}
      {!hidePlayerName ? (
        <>
          <LayerImage src={officialAsset("UI_CMA_PlayerName_Base_00")} x={211} y={397} w={276} h={48} />
          <LayerUnityText className="official-title mai-player" fontKey="maru32" fontSize={29} alignment={0} color="#000000" fitHorizontal characterSpacing={10} horizontalScale={0.9} x={180.4} y={387} w={181.2} h={50}>
            {fieldString(card, "userName") || "PLAYER"}
          </LayerUnityText>
        </>
      ) : null}
      {!hideFriendCode ? (
        <>
          <LayerImage src={officialAsset("UI_CMA_FriendCode_Base_00")} x={211} y={360.8} w={276} h={40} />
          {hasFriendCode ? (
            <LayerUnityText className="official-code mai-friend" fontKey="maru32" fontSize={16} alignment={4} color="#000000" fitHorizontal characterSpacing={1} fixedGlyphTop x={245.8} y={359.4} w={192} h={23.7}>
              {fieldString(card, "friendCode")}
            </LayerUnityText>
          ) : (
            <LayerUnityText className="official-code mai-friend-empty" fontKey="maru32" fontSize={16} alignment={4} color="#000000" characterSpacing={4} x={246.8} y={360.8} w={190} h={12}>
              - - - - - - - - -
            </LayerUnityText>
          )}
        </>
      ) : null}
      {!hideRating ? (
        <>
          <LayerImage src={officialAsset(ratingBase)} x={212.4} y={456.9} w={280} h={76} />
          <LayerDigitCounter
            className="official-rating mai-rating-counter"
            value={fieldString(card, "rating") || "0"}
            sprite={officialAsset("NUM_MAI_Rating_sheet")}
            x={337.1}
            y={457}
            w={120}
            h={128}
            scale={0.7}
            align="right"
            digitWidth={41}
            digitHeight={41}
            signWidth={50}
            signHeight={50}
            charSpacing={0.9}
            flags={128}
          />
        </>
      ) : null}
      {!hideSerialAndQR ? (
        <>
          <LayerImage src={officialAsset("UI_CMA_SerialCode_Base_00")} x={0} y={-486.5} w={490} h={32} />
          <LayerUnityText className="official-serial mai-serial" fontKey="kaku16" fontSize={16} alignment={1} fitHorizontal characterSpacing={-1} x={-100.9} y={-488.7} w={266} h={18}>
            {formatDisplaySerial(serial)}
          </LayerUnityText>
          <LayerUnityText className="official-serial mai-version" fontKey="kaku16" fontSize={16} alignment={0} fitHorizontal characterSpacing={-1} x={171.3} y={-488.7} w={266} h={18}>
            {fieldString(card, "verCharaId") || card.id}
          </LayerUnityText>
          <LayerImage src={officialAsset("UI_CMA_QRCode_Base_00")} x={249.7} y={-394.7} w={164} h={164} />
          <LayerQr source={qrSource(card, serial)} x={249.7} y={-394.7} w={113} h={113} />
        </>
      ) : null}
      {officialHolo(card) ? (
        <HoloShaderLayer card={card} assetDataUrls={assetDataUrls} lightStyle={lightStyle} inline />
      ) : null}
    </div>
  );
}

export function Mu3OfficialCard({
  card,
  imageDataUrl,
  assetDataUrls,
  lightStyle,
}: {
  card: CardRecord;
  imageDataUrl: string;
  assetDataUrls: Record<string, string>;
  lightStyle: React.CSSProperties;
}) {
  if (card.recordType === "AssetCard") {
    return <Mu3AssetCard card={card} imageDataUrl={imageDataUrl} assetDataUrls={assetDataUrls} />;
  }

  const attr = clampInt(fieldNumber(card, "attribute", 0), 0, 2);
  const rarity = mu3RarityKind(card);
  const rareSprite = mu3RareSpriteName(card);
  const bgAsset =
    rarity === "N" || rarity === "R"
      ? `UI_Card_BG_${rarity}_${twoDigits(attr)}`
      : null;
  const frameAsset = mu3FrameAsset(card, attr);
  const showFrame = mu3ShowMainFrame(card);
  const charaSrc = assetDataUrls.mu3Chara;
  const cardBgSrc = assetDataUrls.mu3CardBg;
  const gradeId = numericField(card, "gradeId", -1);
  const rightsId = numericField(card, "rightsId", -1);
  const attackValue = mu3AttackValue(card);
  const awakenMark = mu3AwakenMarkAsset(card);
  const {
    isCommonModel,
    nickname: mu3Nickname,
    characterName: mu3CharacterName,
    baseCharacterName: mu3BaseCharacterName,
    ipName: mu3IpName,
  } = mu3CardNames(card);

  return (
    <div className="official-card official-mu3">
      {cardBgSrc ? (
        <LayerImage src={cardBgSrc} x={0} y={0} w={768} h={1052} />
      ) : bgAsset ? (
        <LayerImage src={officialAsset(bgAsset)} x={0} y={0} w={768} h={1052} />
      ) : null}
      {charaSrc ? <LayerImage src={charaSrc} x={0} y={0} w={768} h={1052} /> : null}
      {showFrame && frameAsset ? <LayerImage src={officialAsset(frameAsset)} x={0} y={0} w={768} h={1052} /> : null}
      {!fieldBool(card, "hideAttrRarity") ? (
        <>
          <LayerImage src={officialAsset(`UI_Card_Attribute_${twoDigits(attr)}_${mu3AttributeName(attr)}`)} x={-297} y={439} w={130} h={130} />
          <LayerImage src={officialAsset(rareSprite)} x={-161.4} y={442.3} w={208} h={118} />
        </>
      ) : null}
      {fieldBool(card, "digitalOnly") ? (
        <LayerImage src={officialAsset("UI_Card_DigitalMark_00")} x={239.2} y={477.4} w={294} h={102} />
      ) : null}
      {!fieldBool(card, "hideGrade") && assetDataUrls.mu3Grade && gradeId >= 0 ? (
        <LayerImage src={assetDataUrls.mu3Grade} x={295} y={455} w={94} h={142} />
      ) : null}
      {!fieldBool(card, "hideSkill") ? (
        <>
          <LayerImage src={officialAsset(mu3SkillAsset(card))} x={-40.3} y={-367.7} w={628} h={108} />
          <LayerCanvasText
            className="official-skill-name mu3-skill-name"
            fontFamily={CANVAS_FONT_SEGA_MARU_DB}
            fontSize={19}
            alignment={0}
            color="#ffffff"
            x={-35.1}
            y={-333.7}
            w={424}
            h={20}
            fitHorizontal
          >
            {fieldString(card, "skillName")}
          </LayerCanvasText>
          <LayerCanvasText
            className="official-skill-body mu3-skill-body"
            fontFamily={CANVAS_FONT_SEGA_MARU_DB}
            fontSize={14}
            alignment={0}
            color="#000000"
            lineSpacing={1.08}
            x={-36.3}
            y={-381.9}
            w={424}
            h={59.7}
            fitHorizontal
          >
            {fieldString(card, "skillText")}
          </LayerCanvasText>
        </>
      ) : null}
      {!fieldBool(card, "hideAttackLimit") ? (
        <>
          <LayerImage src={officialAsset("UI_Card_max_00")} x={-291} y={-228.6} w={108} h={34} />
          <Mu3LimitBreakStars card={card} />
          <LayerDigitCounter
            className="official-counter mu3-max-attack"
            value={attackValue || "0"}
            sprite={officialAsset("UI_Card_NUM_attack")}
            x={-291}
            y={-276.6}
            w={100}
            h={100}
            align="center"
            digitWidth={70}
            digitHeight={70}
            signWidth={70}
            signHeight={70}
            charSpacing={-29.9}
            flags={0}
          />
        </>
      ) : null}
      {!fieldBool(card, "hideAwaken") && awakenMark ? (
        <LayerImage src={officialAsset(awakenMark)} {...MU3_AWAKEN_MARK_RECT} />
      ) : null}
      {!fieldBool(card, "hideUserName") ? (
        <>
          <LayerImage src={officialAsset("UI_Card_UserName_00")} x={278} y={-291.8} w={212} h={56} />
          <LayerCanvasText className="official-title mu3-user" fontFamily={CANVAS_FONT_SEGA_MARU_DB} fontSize={22} fontWeight={550} alignment={4} color="#000000" characterSpacing={6} x={267.1} y={-300.6} w={190} h={19.2} fitHorizontal>
            {fieldString(card, "userName") || "USER"}
          </LayerCanvasText>
        </>
      ) : null}
      {!fieldBool(card, "hideName") ? (
        isCommonModel ? (
          <>
            <LayerTmpText className="official-title mu3-nickname-shadow" fontSize={23.6} variant="shadow" characterSpacing={-0.06} x={42.9} y={-176.4} w={550} h={26.2} rotation={6}>
              {mu3Nickname}
            </LayerTmpText>
            <LayerTmpText className="official-title mu3-nickname" fontSize={23.6} variant="main" characterSpacing={-0.06} x={40} y={-175} w={550} h={26.2} rotation={6}>
              {mu3Nickname}
            </LayerTmpText>
            <LayerTmpText className="official-title mu3-character-name-shadow" fontSize={43} variant="shadow" autoSize minFontSize={24} x={53.8} y={-199} w={523.8} h={26} rotation={6}>
              {mu3CharacterName}
            </LayerTmpText>
            <LayerTmpText className="official-title mu3-character-name" fontSize={43} variant="main" autoSize minFontSize={24} x={50} y={-197} w={523.8} h={26} rotation={6}>
              {mu3CharacterName}
            </LayerTmpText>
            <LayerTmpText className="official-title mu3-ip-title-shadow" fontSize={14.6} variant="shadow" autoSize minFontSize={12} x={111.6} y={-232.1} w={411.6} h={19.7} rotation={6}>
              {mu3IpName}
            </LayerTmpText>
            <LayerTmpText className="official-title mu3-ip-title" fontSize={14.6} variant="main" autoSize minFontSize={12} x={110.6} y={-230.9} w={411.6} h={19.7} rotation={6}>
              {mu3IpName}
            </LayerTmpText>
            <LayerImage src={officialAsset("UI_Card_CMN_3D_Icon_00")} x={262.8} y={-224.3} w={146} h={38} rotation={6} />
          </>
        ) : (
          <>
            <LayerTmpText className="official-title mu3-nickname-shadow" fontSize={23.6} variant="shadow" characterSpacing={-0.06} x={41.5} y={-185.3} w={550} h={26.2} rotation={6}>
              {mu3Nickname}
            </LayerTmpText>
            <LayerTmpText className="official-title mu3-nickname" fontSize={23.6} variant="main" characterSpacing={-0.06} x={38.6} y={-183.9} w={550} h={26.2} rotation={6}>
              {mu3Nickname}
            </LayerTmpText>
            <LayerTmpText className="official-title mu3-character-name-shadow" fontSize={43} variant="shadow" autoSize minFontSize={24} x={42.7} y={-225.7} w={546} h={37} rotation={6}>
              {mu3BaseCharacterName}
            </LayerTmpText>
            <LayerTmpText className="official-title mu3-character-name" fontSize={43} variant="main" autoSize minFontSize={24} x={38.7} y={-224.5} w={546} h={37} rotation={6}>
              {mu3BaseCharacterName}
            </LayerTmpText>
          </>
        )
      ) : null}
      {!fieldBool(card, "hideQRCode") ? (
        <>
          <LayerImage src={officialAsset("UI_Card_qr_base_00")} x={251.8} y={-396.1} w={157} h={158} />
          <LayerQr source={qrSource(card, fieldString(card, "serialId") || fieldString(card, "cardNo"))} x={249.4} y={-392.3} w={113} h={113} />
        </>
      ) : null}
      <LayerImage src={officialAsset("UI_Card_rightsplate_00")} x={0} y={-502} w={768} h={48} />
      <LayerCanvasText className="official-serial mu3-serial" fontFamily={CANVAS_FONT_SEGA_MARU_DB} fontSize={19} characterSpacing={2} alignment={1} color="#ffffff" x={-135} y={-495.9} w={311} h={21} fitHorizontal>
        {formatDisplaySerial(fieldString(card, "serialId"))}
      </LayerCanvasText>
      <LayerCanvasText className="official-serial mu3-cardno" fontFamily={CANVAS_FONT_SEGA_MARU_DB} fontSize={19} characterSpacing={1} alignment={1} color="#ffffff" x={132} y={-495.9} w={311} h={21} fitHorizontal>
        {fieldString(card, "cardNo") || "CARD NO."}
      </LayerCanvasText>
      {assetDataUrls.mu3Rights && rightsId > 0 ? (
        <LayerImage src={assetDataUrls.mu3Rights} x={-85} y={-447} w={520} h={64} />
      ) : null}
      {officialHolo(card) ? <HoloShaderLayer card={card} assetDataUrls={assetDataUrls} lightStyle={lightStyle} inline /> : null}
    </div>
  );
}

export function Mu3AssetCard({
  card,
  imageDataUrl,
  assetDataUrls,
}: {
  card: CardRecord;
  imageDataUrl: string;
  assetDataUrls: Record<string, string>;
}) {
  const gradeId = numericField(card, "gradeId", -1);
  const rightsId = numericField(card, "rightsId", -1);
  const attackValue = mu3AttackValue(card);
  const awakenMark = mu3AwakenMarkAsset(card);
  const { nickname: mu3Nickname, baseCharacterName: mu3CharacterName } = mu3CardNames(card);
  return (
    <div className="official-card official-mu3 official-mu3-asset">
      {imageDataUrl ? (
        <LayerImage src={imageDataUrl} x={0} y={0} w={768} h={1052} />
      ) : (
        <LayerImage src={officialAsset("UI_Card_BG_N_00")} x={0} y={0} w={768} h={1052} />
      )}
      {!fieldBool(card, "hideGrade") && assetDataUrls.mu3Grade && gradeId >= 0 ? (
        <LayerImage src={assetDataUrls.mu3Grade} x={295} y={455} w={94} h={142} />
      ) : null}
      {!fieldBool(card, "hideAttackLimit") ? (
        <>
          <LayerImage src={officialAsset("UI_Card_max_00")} x={-291} y={-228.6} w={108} h={34} />
          <Mu3LimitBreakStars card={card} />
          <LayerDigitCounter
            className="official-counter mu3-max-attack"
            value={attackValue || "0"}
            sprite={officialAsset("UI_Card_NUM_attack")}
            x={-291}
            y={-276.6}
            w={100}
            h={100}
            align="center"
            digitWidth={70}
            digitHeight={70}
            signWidth={70}
            signHeight={70}
            charSpacing={-29.9}
            flags={0}
          />
        </>
      ) : null}
      {!fieldBool(card, "hideAwaken") && awakenMark ? (
        <LayerImage src={officialAsset(awakenMark)} {...MU3_AWAKEN_MARK_RECT} />
      ) : null}
      {!fieldBool(card, "hideUserName") ? (
        <>
          <LayerImage src={officialAsset("UI_Card_UserName_00")} x={278} y={-291.8} w={212} h={56} />
          <LayerCanvasText className="official-title mu3-user" fontFamily={CANVAS_FONT_SEGA_MARU_DB} fontSize={19} fontWeight={550} alignment={4} color="#000000" characterSpacing={3} x={267.1} y={-300.6} w={190} h={19.2} fitHorizontal>
            {fieldString(card, "userName") || "USER"}
          </LayerCanvasText>
        </>
      ) : null}
      {!fieldBool(card, "hideName") ? (
        <>
          {mu3Nickname ? (
            <>
              <LayerTmpText className="official-title mu3-nickname-shadow" fontSize={23.6} variant="shadow" characterSpacing={-0.06} x={41.5} y={-185.3} w={550} h={26.2} rotation={6}>
                {mu3Nickname}
              </LayerTmpText>
              <LayerTmpText className="official-title mu3-nickname" fontSize={23.6} variant="main" characterSpacing={-0.06} x={38.6} y={-183.9} w={550} h={26.2} rotation={6}>
                {mu3Nickname}
              </LayerTmpText>
            </>
          ) : null}
          <LayerTmpText className="official-title mu3-character-name-shadow" fontSize={43} variant="shadow" autoSize minFontSize={24} x={42.7} y={-225.7} w={546} h={37} rotation={6}>
            {mu3CharacterName}
          </LayerTmpText>
          <LayerTmpText className="official-title mu3-character-name" fontSize={43} variant="main" autoSize minFontSize={24} x={38.7} y={-224.5} w={546} h={37} rotation={6}>
            {mu3CharacterName}
          </LayerTmpText>
        </>
      ) : null}
      {!fieldBool(card, "hideQRCode") ? (
        <>
          <LayerImage src={officialAsset("UI_Card_qr_base_00")} x={251.8} y={-396.1} w={157} h={158} />
          <LayerQr source={qrSource(card, fieldString(card, "cardNo"))} x={249.4} y={-392.3} w={113} h={113} />
        </>
      ) : null}
      <LayerImage src={officialAsset("UI_Card_rightsplate_00")} x={0} y={-502} w={768} h={48} />
      <LayerCanvasText className="official-serial mu3-serial" fontFamily={CANVAS_FONT_SEGA_MARU_DB} fontSize={19} characterSpacing={2} alignment={1} color="#ffffff" x={-135} y={-495.9} w={311} h={21} fitHorizontal>
        {formatDisplaySerial(fieldString(card, "serialId"))}
      </LayerCanvasText>
      <LayerCanvasText className="official-serial mu3-cardno" fontFamily={CANVAS_FONT_SEGA_MARU_DB} fontSize={19} characterSpacing={2} alignment={1} color="#ffffff" x={132} y={-495.9} w={311} h={21} fitHorizontal>
        {fieldString(card, "cardNo") || card.id}
      </LayerCanvasText>
      {assetDataUrls.mu3Rights && rightsId > 0 ? (
        <LayerImage src={assetDataUrls.mu3Rights} x={-85} y={-447} w={520} h={64} />
      ) : null}
    </div>
  );
}

