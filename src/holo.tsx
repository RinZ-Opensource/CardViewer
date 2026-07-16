import React from "react";
import { clampInt, fieldBool, fieldNumber, maiCardTypeEffects, maiEffectIconAsset, maiFrameAssets, maiRatingBaseAsset, mu3AttributeName, mu3AwakenMarkAsset, mu3CardNames, mu3HoloBgAsset, mu3HoloFrameBaseAsset, mu3HoloFrameOverlayAsset, mu3NeedsSign, mu3RareSpriteName, mu3SkillAsset, numericField, twoDigits } from "./cardData";
import { CARD_HEIGHT, CARD_WIDTH, MAI_CHARA_NAME_RECT, MAI_EFFECT_ICON_RECT, MAI_END_DATE_RECT, MAI_FRIEND_CODE_BASE_RECT, MAI_HOLO_UI_MASKS, MAI_MASTER_ICON_RECT, MAI_NAME_BASE_RECT, MAI_PERIOD_LABEL_RECT, MAI_PLAYER_NAME_BASE_RECT, MAI_QR_CODE_BASE_RECT, MAI_RATING_BASE_RECT, MAI_RATING_ICON_RECT, MAI_SERIAL_CODE_BASE_RECT, MU3_ATTRIBUTE_RECT, MU3_AWAKEN_MARK_RECT, MU3_CMN_ICON_RECT, MU3_DIGITAL_MARK_RECT, MU3_GRADE_RECT, MU3_MAX_LABEL_RECT, MU3_QR_BASE_RECT, MU3_RARE_SPRITE_RECT, MU3_RIGHTS_PLATE_RECT, MU3_RIGHTS_RECT, MU3_SKILL_BASE_RECT, MU3_USER_NAME_BASE_RECT, TmpFontContext, USE_OFFICIAL_ASSETS, officialAsset } from "./constants";
import { withUnityCanvasRect } from "./geometry";
import { TMP_TEXT_PADDING, TmpHorizontalAlign, TmpTextVariant, TmpVerticalAlign, clampNumber, loadTmpAtlas, rasterizeTmpText } from "./textRendering";
import { CardRecord, TmpFontMetrics } from "./types";

// Alpha below this (0-255) is treated as fully transparent when deriving masks.
const MASK_ALPHA_EPSILON = 8;
// Grow the front-element mask outward by this many 1px passes so the foil is
// reliably cleared around printed art/text edges.
const FRONT_MASK_DILATION = 7;
const HOLO_IMAGE_LOAD_TIMEOUT_MS = 5_000;
const HOLO_IMAGE_LOAD_ATTEMPTS = 2;
const HOLO_IMAGE_RETRY_DELAY_MS = 150;

// Tuning for the luminance-keyed mask modes ("light-or-alpha"/"dark-or-alpha").
// Per-image coverage gates decide whether to key off luminance at all; the
// chosen ramp then maps luminance (0-255) to mask alpha via clamp((edge±lum)/span).
const MASK_LUMINANCE = {
  lightPivot: 128, // luminance at/above which a pixel counts as "light"
  darkPivot: 144, // luminance at/below which a pixel counts as "dark"
  coverageGate: 0.72, // min alpha coverage before luminance keying applies
  darkModeCoverageGate: 0.42, // looser gate for the explicit dark-or-alpha mode
  lightBand: { min: 0.01, max: 0.96 }, // light-coverage band selecting the light ramp
  darkBand: { min: 0.005, max: 0.98 }, // dark-coverage band selecting the dark ramp
  darkRamp: { edge: 212, span: 168 },
  lightRamp: { edge: 24, span: 200 },
  brightRamp: { edge: 232, span: 200 },
};

export function HoloShaderLayer({
  card,
  assetDataUrls,
  lightStyle,
  inline = false,
}: {
  card: CardRecord;
  assetDataUrls: Record<string, string>;
  lightStyle: React.CSSProperties;
  inline?: boolean;
}) {
  const maskUrl =
    card.game === "MU3"
      ? assetDataUrls.mu3Mask
      : card.game === "MAI"
        ? assetDataUrls.maiMask || assetDataUrls.maiMaskFallback
        : "";
  const layerClassName = [
    "holo-layer",
    !USE_OFFICIAL_ASSETS ? "holo-public" : "",
    `holo-${card.game.toLowerCase()}`,
    inline ? "holo-inline" : "",
  ].filter(Boolean).join(" ");

  if (!USE_OFFICIAL_ASSETS) {
    return <HoloMaterialLayer layerClassName={layerClassName} lightStyle={lightStyle} game={card.game} />;
  }

  if (card.game === "MAI") {
    return (
      <MaiOfficialHoloLayer
        card={card}
        assetDataUrls={assetDataUrls}
        layerClassName={layerClassName}
        lightStyle={lightStyle}
      />
    );
  }

  if (card.game !== "MU3") {
    return <HoloMaterialLayer layerClassName={layerClassName} lightStyle={lightStyle} game={card.game} maskUrl={maskUrl} />;
  }

  return (
    <Mu3OfficialHoloLayer
      card={card}
      assetDataUrls={assetDataUrls}
      layerClassName={layerClassName}
      lightStyle={lightStyle}
    />
  );
}

export function HoloMaterialLayer({
  layerClassName,
  lightStyle,
  game,
  maskUrl = "",
  maskState,
}: {
  layerClassName: string;
  lightStyle: React.CSSProperties;
  game: string;
  maskUrl?: string;
  maskState?: HoloMaskRenderState;
}) {
  if (USE_OFFICIAL_ASSETS && !maskUrl && !maskState) return null;
  const maskStyle = holoMaskStyle(maskUrl);
  const foilEffectGame = game === "MAI" ? "MU3" : game;
  const foilClassName = [
    "holo-foil-plane",
    `holo-foil-${foilEffectGame.toLowerCase()}`,
    !USE_OFFICIAL_ASSETS ? "holo-foil-public" : "",
  ].filter(Boolean).join(" ");
  return (
    <div
      className={layerClassName}
      style={lightStyle}
      data-export-state={maskState?.status}
      data-export-error={maskState?.status === "error" ? maskState.error : undefined}
      data-holo-degraded={maskState?.warnings.length ? "true" : undefined}
      data-holo-warning={maskState?.warnings.length ? maskState.warnings.join("; ") : undefined}
    >
      {maskUrl ? (
        <div className={foilClassName} style={maskStyle}>
          <div className="holo-foil-darkgrain" />
          <div className="holo-foil-base" />
          <div className="holo-foil-flakes" />
          <div className="holo-foil-sparkles" />
          <div className="holo-foil-glints" />
          <div className="holo-foil-glare" />
        </div>
      ) : null}
    </div>
  );
}

export type HoloMaskRenderState = {
  url: string;
  status: "pending" | "ready" | "error";
  error: string;
  warnings: string[];
};

export type HoloMaskImage = {
  href: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  maskMode?: HoloRootMaskMode;
  /** A failed critical source invalidates the generated mask. */
  required?: boolean;
};

export type HoloMaskRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
};

export type HoloTmpTextMask = HoloMaskRect & {
  text: string;
  fontSize: number;
  variant: TmpTextVariant;
  characterSpacing?: number;
  autoSize?: boolean;
  minFontSize?: number;
  horizontalAlign?: TmpHorizontalAlign;
  verticalAlign?: TmpVerticalAlign;
  dilation?: number;
  maskIncludeUnderlay?: boolean;
};

export type HoloMaskMode = "alpha" | "light-or-alpha" | "dark-or-alpha" | "raw";
export type HoloRootMaskMode = HoloMaskMode | "red";

export type HoloCssMaskOptions = {
  fallbackAllowWhenSparse?: boolean;
  invertApplicationArea?: boolean;
};

// Named inputs for the holo mask builder — grouping them (vs ~10 positional args)
// self-documents call sites and removes the signMask/signClear transpose risk.
export type HoloMaskInput = {
  rootImages: HoloMaskImage[];
  frontImages: HoloMaskImage[];
  frontRects: HoloMaskRect[];
  signMaskImages?: HoloMaskImage[];
  signClearImages?: HoloMaskImage[];
  frontTextMasks?: HoloTmpTextMask[];
  excludeImages?: HoloMaskImage[];
  tmpFont?: TmpFontMetrics | null;
  waitingForRequiredResources?: boolean;
  options?: HoloCssMaskOptions;
};

function pushHoloTmpTextMask(masks: HoloTmpTextMask[], mask: HoloTmpTextMask) {
  if (!mask.text) return;
  masks.push({
    horizontalAlign: "right",
    verticalAlign: "top",
    dilation: 1,
    ...mask,
  });
}

// Mask twin of the visual Mu3ShadowedTitle: push the shadow and main passes of
// one MU3 title from a single set of params (only the two positions differ).
function pushShadowedTitleMask(
  masks: HoloTmpTextMask[],
  title: {
    text: string;
    fontSize: number;
    characterSpacing?: number;
    autoSize?: boolean;
    minFontSize?: number;
    x: number;
    y: number;
    shadowX: number;
    shadowY: number;
    w: number;
    h: number;
    rotation?: number;
  },
) {
  const { x, y, shadowX, shadowY, ...shared } = title;
  pushHoloTmpTextMask(masks, { ...shared, variant: "shadow", x: shadowX, y: shadowY });
  pushHoloTmpTextMask(masks, { ...shared, variant: "main", x, y });
}

export function MaiOfficialHoloLayer({
  card,
  assetDataUrls,
  layerClassName,
  lightStyle,
}: {
  card: CardRecord;
  assetDataUrls: Record<string, string>;
  layerClassName: string;
  lightStyle: React.CSSProperties;
}) {
  const hasFriendCode = fieldBool(card, "hasFriendCode");
  const hideSerialAndQR = fieldBool(card, "hideSerialAndQR");
  const hidePlayerName = fieldBool(card, "hidePlayerName");
  const hideRating = fieldBool(card, "hideRating");
  const hideFrame = fieldBool(card, "hideFrame");
  const hideCardIcon = fieldBool(card, "hideCardIcon");
  const hideCharaNameAndPeriod = fieldBool(card, "hideCharaNameAndPeriod");
  const hideFriendCode = fieldBool(card, "hideFriendCode");
  const hideChara = fieldBool(card, "hideChara");
  const maskSrc = assetDataUrls.maiMask || assetDataUrls.maiMaskFallback;
  const charaSrc = assetDataUrls.maiChara || assetDataUrls.maiCharaFallback;
  const { frameAsset, passAsset, passRect } = maiFrameAssets(card);
  const ratingBase = maiRatingBaseAsset(card);
  const effects = maiCardTypeEffects(card);
  const effectIconAsset = maiEffectIconAsset(card);
  const rootImages: HoloMaskImage[] = [];
  const frontImages: HoloMaskImage[] = [];
  const frontRects: HoloMaskRect[] = [];

  rootImages.push({
    href: officialAsset("UI_CMA_Holo_CardBase_00"),
    x: 0,
    y: 0,
    w: CARD_WIDTH,
    h: CARD_HEIGHT,
    maskMode: "raw",
    required: true,
  });
  if (maskSrc) {
    rootImages.push({ href: maskSrc, x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw" });
  } else if (charaSrc && !hideChara) {
    rootImages.push({ href: charaSrc, x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "alpha" });
  }
  if (frameAsset && !hideFrame) {
    rootImages.push({ href: officialAsset("UI_CMA_Holo_Frame_00"), x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw" });
  }
  MAI_HOLO_UI_MASKS.forEach(({ asset, rect }) => {
    rootImages.push({ href: officialAsset(asset), ...rect, maskMode: "alpha" });
  });
  if (passAsset && !hideFrame) {
    frontImages.push({ href: officialAsset(passAsset), ...passRect, maskMode: "alpha" });
  }
  if (!hideCharaNameAndPeriod) {
    frontImages.push({ href: officialAsset("UI_CMA_Name_Base_00"), ...MAI_NAME_BASE_RECT, maskMode: "alpha" });
    frontRects.push({ ...MAI_PERIOD_LABEL_RECT });
    frontRects.push({ ...MAI_CHARA_NAME_RECT });
    frontRects.push({ ...MAI_END_DATE_RECT });
  }
  if (effectIconAsset && !hideCardIcon) {
    frontImages.push({ href: officialAsset(effectIconAsset), ...MAI_EFFECT_ICON_RECT });
  }
  if (effects.master && !hideCardIcon) {
    frontImages.push({ href: officialAsset("UI_CMA_Icon_Master_00"), ...MAI_MASTER_ICON_RECT });
  }
  if (effects.ratingMusic && !hideCardIcon) {
    frontImages.push({ href: officialAsset("UI_CMA_Icon_Rating_00"), ...MAI_RATING_ICON_RECT });
  }
  if (!hidePlayerName) {
    frontImages.push({ href: officialAsset("UI_CMA_PlayerName_Base_00"), ...MAI_PLAYER_NAME_BASE_RECT });
    frontRects.push({ x: 180.4, y: 387, w: 181.2, h: 50 });
  }
  if (!hideFriendCode) {
    frontImages.push({ href: officialAsset("UI_CMA_FriendCode_Base_00"), ...MAI_FRIEND_CODE_BASE_RECT });
    frontRects.push(
      hasFriendCode
        ? { x: 245.8, y: 359.4, w: 192, h: 23.7 }
        : { x: 246.8, y: 360.8, w: 190, h: 12 },
    );
  }
  if (!hideRating) {
    frontImages.push({ href: officialAsset(ratingBase), ...MAI_RATING_BASE_RECT });
    frontRects.push({ x: 333, y: 457, w: 138, h: 94 });
  }
  if (!hideSerialAndQR) {
    frontImages.push({ href: officialAsset("UI_CMA_SerialCode_Base_00"), ...MAI_SERIAL_CODE_BASE_RECT });
    frontImages.push({ href: officialAsset("UI_CMA_QRCode_Base_00"), ...MAI_QR_CODE_BASE_RECT });
    frontRects.push({ x: -100.9, y: -488.7, w: 266, h: 18 });
    frontRects.push({ x: 171.3, y: -488.7, w: 266, h: 18 });
    frontRects.push({ x: 249.7, y: -394.7, w: 113, h: 113 });
  }

  const hasHoloMaskSource = rootImages.length > 0 || frontImages.length > 0 || frontRects.length > 0;
  const maskState = useOfficialHoloMask(
    {
      rootImages,
      frontImages,
      frontRects,
      options: { fallbackAllowWhenSparse: false, invertApplicationArea: true },
    },
    hasHoloMaskSource,
  );
  if (!hasHoloMaskSource) {
    return null;
  }

  return (
    <HoloMaterialLayer
      layerClassName={layerClassName}
      lightStyle={lightStyle}
      game={card.game}
      maskUrl={maskState.url}
      maskState={maskState}
    />
  );
}

export function Mu3OfficialHoloLayer({
  card,
  assetDataUrls,
  layerClassName,
  lightStyle,
}: {
  card: CardRecord;
  assetDataUrls: Record<string, string>;
  layerClassName: string;
  lightStyle: React.CSSProperties;
}) {
  const attr = clampInt(fieldNumber(card, "attribute", 0), 0, 2);
  const needsSign = mu3NeedsSign(card);
  const showSign = needsSign && Boolean(assetDataUrls.mu3Sign && assetDataUrls.mu3SignMask);
  const waitingForSignResources = needsSign && !showSign;
  const rightsId = numericField(card, "rightsId", -1);
  const rootImages: HoloMaskImage[] = [];
  const frontImages: HoloMaskImage[] = [];
  const frontRects: HoloMaskRect[] = [];
  const frontTextMasks: HoloTmpTextMask[] = [];
  const signMaskImages: HoloMaskImage[] = [];
  const signClearImages: HoloMaskImage[] = [];
  const excludeImages: HoloMaskImage[] = [];
  const tmpFont = React.useContext(TmpFontContext);
  const {
    isCommonModel,
    nickname: mu3Nickname,
    characterName: mu3CharacterName,
    baseCharacterName: mu3BaseCharacterName,
    ipName: mu3IpName,
  } = mu3CardNames(card);

  if (assetDataUrls.mu3Holo) {
    rootImages.push({
      href: assetDataUrls.mu3Holo,
      x: 0,
      y: 0,
      w: CARD_WIDTH,
      h: CARD_HEIGHT,
      maskMode: "raw",
      required: true,
    });
  }
  if (!assetDataUrls.mu3Holo) {
    const holoBg = mu3HoloBgAsset(card);
    const holoFrameBase = mu3HoloFrameBaseAsset(card);
    const holoFrameOverlay = mu3HoloFrameOverlayAsset(card);
    if (holoBg) {
      // The extracted Horo_BG_* foil sits ~12px left / 3px up of the printed BG.
      // Paint an un-nudged full-frame copy first (fills the edge the nudge would
      // leave bare), then an opaque nudged copy to register the interior.
      rootImages.push({ href: officialAsset(holoBg), x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw", required: true });
      rootImages.push({ href: officialAsset(holoBg), x: 12, y: -3, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw" });
    }
    if (holoFrameBase) {
      rootImages.push({ href: officialAsset(holoFrameBase), x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw", required: !holoBg });
    }
    if (assetDataUrls.mu3Mask) {
      rootImages.push({ href: assetDataUrls.mu3Mask, x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw", required: !holoBg && !holoFrameBase });
      excludeImages.push({ href: assetDataUrls.mu3Mask, x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "alpha" });
    }
    if (holoFrameOverlay) {
      rootImages.push({
        href: officialAsset(holoFrameOverlay),
        x: 0,
        y: 0,
        w: CARD_WIDTH,
        h: CARD_HEIGHT,
        maskMode: "raw",
        required: !holoBg && !holoFrameBase && !assetDataUrls.mu3Mask,
      });
    }
  }
  if (!fieldBool(card, "hideAttrRarity")) {
    frontImages.push({ href: officialAsset(`UI_Card_Attribute_${twoDigits(attr)}_${mu3AttributeName(attr)}`), ...MU3_ATTRIBUTE_RECT });
    frontImages.push({ href: officialAsset(mu3RareSpriteName(card)), ...MU3_RARE_SPRITE_RECT });
  }
  if (fieldBool(card, "digitalOnly")) {
    frontImages.push({ href: officialAsset("UI_Card_DigitalMark_00"), ...MU3_DIGITAL_MARK_RECT });
  }
  if (!fieldBool(card, "hideGrade") && assetDataUrls.mu3Grade) {
    frontImages.push({ href: assetDataUrls.mu3Grade, ...MU3_GRADE_RECT });
  }
  if (!fieldBool(card, "hideSkill")) {
    frontImages.push({ href: officialAsset(mu3SkillAsset(card)), ...MU3_SKILL_BASE_RECT });
    frontRects.push({ x: -36.3, y: -381.9, w: 444, h: 66 });
  }
  if (!fieldBool(card, "hideAttackLimit")) {
    frontImages.push({ href: officialAsset("UI_Card_max_00"), ...MU3_MAX_LABEL_RECT });
    frontRects.push({ x: -291, y: -276.6, w: 132, h: 112 });
    frontRects.push({ x: -26, y: -290.1, w: 398, h: 52 });
  }
  if (!fieldBool(card, "hideAwaken") && mu3AwakenMarkAsset(card)) {
    frontImages.push({ href: officialAsset(mu3AwakenMarkAsset(card)), ...MU3_AWAKEN_MARK_RECT });
  }
  if (!fieldBool(card, "hideUserName")) {
    frontImages.push({ href: officialAsset("UI_Card_UserName_00"), ...MU3_USER_NAME_BASE_RECT });
    frontRects.push({ x: 267.1, y: -300.6, w: 206, h: 28 });
  }
  if (!fieldBool(card, "hideName")) {
    if (isCommonModel) {
      pushShadowedTitleMask(frontTextMasks, { text: mu3Nickname, fontSize: 23.6, characterSpacing: -0.06, x: 40, y: -175, shadowX: 42.9, shadowY: -176.4, w: 550, h: 26.2, rotation: 6 });
      pushShadowedTitleMask(frontTextMasks, { text: mu3CharacterName, fontSize: 43, autoSize: true, minFontSize: 24, x: 50, y: -197, shadowX: 53.8, shadowY: -199, w: 523.8, h: 26, rotation: 6 });
      pushShadowedTitleMask(frontTextMasks, { text: mu3IpName, fontSize: 14.6, autoSize: true, minFontSize: 12, x: 110.6, y: -230.9, shadowX: 111.6, shadowY: -232.1, w: 411.6, h: 19.7, rotation: 6 });
      frontImages.push({ href: officialAsset("UI_Card_CMN_3D_Icon_00"), ...MU3_CMN_ICON_RECT });
    } else {
      pushShadowedTitleMask(frontTextMasks, { text: mu3Nickname, fontSize: 23.6, characterSpacing: -0.06, x: 38.6, y: -183.9, shadowX: 41.5, shadowY: -185.3, w: 550, h: 26.2, rotation: 6 });
      pushShadowedTitleMask(frontTextMasks, { text: mu3BaseCharacterName, fontSize: 43, autoSize: true, minFontSize: 24, x: 38.7, y: -224.5, shadowX: 42.7, shadowY: -225.7, w: 546, h: 37, rotation: 6 });
    }
  }
  if (!fieldBool(card, "hideQRCode")) {
    frontImages.push({ href: officialAsset("UI_Card_qr_base_00"), ...MU3_QR_BASE_RECT });
    frontRects.push({ x: 249.4, y: -392.3, w: 128, h: 128 });
  }
  frontImages.push({ href: officialAsset("UI_Card_rightsplate_00"), ...MU3_RIGHTS_PLATE_RECT });
  frontRects.push({ x: -135, y: -495.9, w: 326, h: 30 });
  frontRects.push({ x: 132, y: -495.9, w: 326, h: 30 });
  if (assetDataUrls.mu3Rights && rightsId > 0) {
    frontImages.push({ href: assetDataUrls.mu3Rights, ...MU3_RIGHTS_RECT });
  }
  if (showSign && assetDataUrls.mu3SignMask) {
    signMaskImages.push({ href: assetDataUrls.mu3SignMask, x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "alpha", required: true });
  }
  if (showSign && assetDataUrls.mu3Sign) {
    signClearImages.push({ href: assetDataUrls.mu3Sign, x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "alpha", required: true });
  }

  const hasHoloMaskSource =
    rootImages.length > 0 ||
    frontImages.length > 0 ||
    frontRects.length > 0 ||
    frontTextMasks.length > 0 ||
    signMaskImages.length > 0;
  const maskState = useOfficialHoloMask(
    {
      rootImages,
      frontImages,
      frontRects,
      signMaskImages,
      signClearImages,
      frontTextMasks,
      excludeImages,
      tmpFont,
      waitingForRequiredResources: waitingForSignResources,
      options: { invertApplicationArea: true },
    },
    hasHoloMaskSource,
  );
  if (!hasHoloMaskSource) {
    return null;
  }

  return (
    <HoloMaterialLayer
      layerClassName={layerClassName}
      lightStyle={lightStyle}
      game={card.game}
      maskUrl={maskState.url}
      maskState={maskState}
    />
  );
}

export function useOfficialHoloMask(input: HoloMaskInput, enabled: boolean) {
  const {
    rootImages,
    frontImages,
    frontRects,
    signMaskImages = [],
    signClearImages = [],
    frontTextMasks = [],
    excludeImages = [],
    tmpFont = null,
    waitingForRequiredResources = false,
    options = {},
  } = input;
  // Serialize the raw inputs so any new mask field auto-participates in the memo
  // key (no hand-kept list to drift). tmpFont reduced to an identity tuple.
  const maskKey = JSON.stringify({
    enabled,
    options,
    rootImages,
    frontImages,
    frontRects,
    frontTextMasks,
    signMaskImages,
    signClearImages,
    excludeImages,
    waitingForRequiredResources,
    tmpFont: tmpFont ? [tmpFont.texture, tmpFont.fontInfo.PointSize, tmpFont.fontInfo.LineHeight, tmpFont.fontInfo.Ascender] : null,
  });
  const waitingForResources = waitingForRequiredResources || (frontTextMasks.length > 0 && !tmpFont);
  const [renderState, setRenderState] = React.useState<
    HoloMaskRenderState & { key: string }
  >({
    key: "",
    url: "",
    status: enabled ? "pending" : "ready",
    error: "",
    warnings: [],
  });

  React.useEffect(() => {
    const controller = new AbortController();
    if (!enabled) {
      setRenderState({ key: maskKey, url: "", status: "ready", error: "", warnings: [] });
      return () => controller.abort();
    }
    setRenderState({ key: maskKey, url: "", status: "pending", error: "", warnings: [] });
    // MU3 text exclusions depend on the TMP atlas metadata loaded by context.
    // Treat the initial null context as waiting, not as a successful partial mask.
    if (waitingForResources) {
      return () => controller.abort();
    }
    renderOfficialHoloMask(input, controller.signal)
      .then(({ url, warnings }) => {
        if (!controller.signal.aborted) {
          setRenderState({ key: maskKey, url, status: "ready", error: "", warnings });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setRenderState({
            key: maskKey,
            url: "",
            status: "error",
            error: holoErrorMessage(error),
            warnings: [],
          });
        }
      });
    return () => controller.abort();
  }, [maskKey]);

  // State from the previous key must never make a newly selected card look
  // export-ready. The effect will install the matching pending state next.
  if (renderState.key !== maskKey) {
    return {
      url: "",
      status: enabled ? "pending" : "ready",
      error: "",
      warnings: [],
    } satisfies HoloMaskRenderState;
  }
  return renderState;
}

async function renderOfficialHoloMask(input: HoloMaskInput, signal: AbortSignal) {
  const {
    rootImages,
    frontImages,
    frontRects,
    signMaskImages = [],
    signClearImages = [],
    frontTextMasks = [],
    excludeImages = [],
    tmpFont = null,
    options = {},
  } = input;
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The browser could not create the holo output canvas.");

  const rootCanvas = document.createElement("canvas");
  rootCanvas.width = CARD_WIDTH;
  rootCanvas.height = CARD_HEIGHT;
  const rootCtx = rootCanvas.getContext("2d", { willReadFrequently: true });
  const frontCanvas = document.createElement("canvas");
  frontCanvas.width = CARD_WIDTH;
  frontCanvas.height = CARD_HEIGHT;
  const frontCtx = frontCanvas.getContext("2d", { willReadFrequently: true });
  const frontTextCanvas = document.createElement("canvas");
  frontTextCanvas.width = CARD_WIDTH;
  frontTextCanvas.height = CARD_HEIGHT;
  const frontTextCtx = frontTextCanvas.getContext("2d", { willReadFrequently: true });
  const signMaskCanvas = document.createElement("canvas");
  signMaskCanvas.width = CARD_WIDTH;
  signMaskCanvas.height = CARD_HEIGHT;
  const signMaskCtx = signMaskCanvas.getContext("2d", { willReadFrequently: true });
  const signClearCanvas = document.createElement("canvas");
  signClearCanvas.width = CARD_WIDTH;
  signClearCanvas.height = CARD_HEIGHT;
  const signClearCtx = signClearCanvas.getContext("2d", { willReadFrequently: true });
  const excludeCanvas = document.createElement("canvas");
  excludeCanvas.width = CARD_WIDTH;
  excludeCanvas.height = CARD_HEIGHT;
  const excludeCtx = excludeCanvas.getContext("2d", { willReadFrequently: true });
  if (!rootCtx || !frontCtx || !frontTextCtx || !signMaskCtx || !signClearCtx || !excludeCtx) {
    throw new Error("The browser could not create a holo mask canvas.");
  }

  rootCtx.imageSmoothingEnabled = true;
  frontCtx.imageSmoothingEnabled = true;
  frontTextCtx.imageSmoothingEnabled = true;
  signMaskCtx.imageSmoothingEnabled = true;
  signClearCtx.imageSmoothingEnabled = true;
  excludeCtx.imageSmoothingEnabled = true;

  const warnings = new Set<string>();
  const imageLoads = new Map<string, Promise<HTMLImageElement>>();
  const loadImage = (src: string) => {
    const cached = imageLoads.get(src);
    if (cached) return cached;
    const request = loadMaskImage(src, signal);
    imageLoads.set(src, request);
    return request;
  };
  const loadImages = (images: HoloMaskImage[], group: string) =>
    Promise.all(
      images.map(async (image) => {
        try {
          return { image, element: await loadImage(image.href) };
        } catch (error) {
          signal.throwIfAborted();
          const label = holoImageLabel(image.href);
          if (image.required) {
            throw new Error(`A required ${group} holo image failed to load: ${label}.`, {
              cause: error,
            });
          }
          warnings.add(`Skipped optional ${group} image ${label}`);
          return null;
        }
      }),
    );

  const [loadedRootImages, loadedFrontImages, loadedSignMaskImages, loadedSignClearImages, loadedExcludeImages] = await Promise.all([
    loadImages(rootImages, "root"),
    loadImages(frontImages, "front"),
    loadImages(signMaskImages, "sign-mask"),
    loadImages(signClearImages, "sign-clear"),
    loadImages(excludeImages, "exclusion"),
  ]);
  signal.throwIfAborted();
  const tmpAtlas =
    tmpFont && frontTextMasks.length
      ? await loadTmpAtlas(tmpFont)
      : null;
  signal.throwIfAborted();

  const loadedImageCount = [
    ...loadedRootImages,
    ...loadedFrontImages,
    ...loadedSignMaskImages,
    ...loadedSignClearImages,
    ...loadedExcludeImages,
  ].filter(Boolean).length;
  if (loadedImageCount === 0 && frontRects.length === 0 && frontTextMasks.length === 0) {
    throw new Error("No holo mask resources could be loaded.");
  }

  for (const loaded of loadedRootImages) {
    if (!loaded) continue;
    drawMaskImage(rootCtx, loaded.image, loaded.element);
  }
  for (const loaded of loadedFrontImages) {
    if (!loaded) continue;
    drawMaskImage(frontCtx, loaded.image, loaded.element);
  }
  frontCtx.fillStyle = "#ffffff";
  for (const rect of frontRects) {
    drawMaskRect(frontCtx, rect);
  }
  if (tmpFont && tmpAtlas) {
    for (const mask of frontTextMasks) {
      if (!drawHoloTmpTextMask(frontTextCtx, mask, tmpFont, tmpAtlas)) {
        throw new Error("A holo text exclusion failed to render.");
      }
    }
  }
  for (const loaded of loadedSignMaskImages) {
    if (!loaded) continue;
    drawMaskImage(signMaskCtx, loaded.image, loaded.element);
  }
  for (const loaded of loadedSignClearImages) {
    if (!loaded) continue;
    drawMaskImage(signClearCtx, loaded.image, loaded.element);
  }
  for (const loaded of loadedExcludeImages) {
    if (!loaded) continue;
    drawMaskImage(excludeCtx, loaded.image, loaded.element);
  }

  const rootData = rootCtx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const frontData = frontCtx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const frontTextData = frontTextCtx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const signMaskData = signMaskCtx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const signClearData = signClearCtx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const excludeData = excludeCtx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const frontMask = binarizeRenderedPixels(frontData);
  const frontTextMask = binarizeRenderedPixels(frontTextData);
  for (let pixel = 0; pixel < frontMask.length; pixel += 1) {
    if (frontTextMask[pixel] > 127) frontMask[pixel] = 255;
  }
  const dilatedFrontMask = dilateBinaryMask(frontMask, CARD_WIDTH, CARD_HEIGHT, FRONT_MASK_DILATION);
  const out = ctx.createImageData(CARD_WIDTH, CARD_HEIGHT);
  let activePixels = 0;
  for (let pixel = 0, index = 0; pixel < dilatedFrontMask.length; pixel += 1, index += 4) {
    const rootAdds = rootData.data[index] > 127;
    const frontAdds = dilatedFrontMask[pixel] > 127;
    const signAdds = signMaskData.data[index + 3] > 127;
    const signClears = signClearData.data[index + 3] > 127;
    const excluded = excludeData.data[index + 3] > 127;
    const baseActive = !signClears && (rootAdds || frontAdds || signAdds);
    const alpha = options.invertApplicationArea
      ? !signClears && !baseActive && !excluded
        ? 255
        : 0
      : baseActive
        ? 255
        : 0;
    out.data[index] = 255;
    out.data[index + 1] = 255;
    out.data[index + 2] = 255;
    out.data[index + 3] = alpha;
    if (alpha > 0) activePixels += 1;
  }

  if (activePixels === 0) warnings.add("Generated holo mask has no active pixels");
  ctx.putImageData(out, 0, 0);
  return { url: canvas.toDataURL("image/png"), warnings: [...warnings] };
}

function binarizeRenderedPixels(imageData: ImageData) {
  const mask = new Uint8ClampedArray(imageData.width * imageData.height);
  for (let src = 0, dst = 0; src < imageData.data.length; src += 4, dst += 1) {
    mask[dst] =
      imageData.data[src] > 0 ||
      imageData.data[src + 1] > 0 ||
      imageData.data[src + 2] > 0 ||
      imageData.data[src + 3] > 0
        ? 255
        : 0;
  }
  return mask;
}

function paintBinaryMask(imageData: ImageData, mask: Uint8ClampedArray<ArrayBufferLike>) {
  for (let pixel = 0, index = 0; pixel < mask.length; pixel += 1, index += 4) {
    const alpha = mask[pixel] > 0 ? 255 : 0;
    imageData.data[index] = 255;
    imageData.data[index + 1] = 255;
    imageData.data[index + 2] = 255;
    imageData.data[index + 3] = alpha;
  }
}

function dilateBinaryMask(src: Uint8ClampedArray<ArrayBufferLike>, width: number, height: number, iterations: number) {
  let current: Uint8ClampedArray<ArrayBufferLike> = src;
  let next: Uint8ClampedArray<ArrayBufferLike> = new Uint8ClampedArray(src.length);
  for (let pass = 0; pass < iterations; pass += 1) {
    for (let y = 0; y < height; y += 1) {
      const y0 = Math.max(y - 1, 0) * width;
      const y1 = y * width;
      const y2 = Math.min(y + 1, height - 1) * width;
      for (let x = 0; x < width; x += 1) {
        const x0 = Math.max(x - 1, 0);
        const x1 = x;
        const x2 = Math.min(x + 1, width - 1);
        next[y1 + x1] =
          current[y0 + x0] > 0 ||
          current[y0 + x1] > 0 ||
          current[y0 + x2] > 0 ||
          current[y1 + x0] > 0 ||
          current[y1 + x2] > 0 ||
          current[y2 + x0] > 0 ||
          current[y2 + x1] > 0 ||
          current[y2 + x2] > 0
            ? 255
            : 0;
      }
    }
    const tmp = current;
    current = next;
    next = tmp;
  }
  return current;
}

async function loadMaskImage(src: string, signal: AbortSignal) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= HOLO_IMAGE_LOAD_ATTEMPTS; attempt += 1) {
    signal.throwIfAborted();
    try {
      return await loadMaskImageOnce(src, signal);
    } catch (error) {
      signal.throwIfAborted();
      lastError = error;
      if (attempt < HOLO_IMAGE_LOAD_ATTEMPTS) {
        await waitForHoloRetry(signal);
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to load holo image ${holoImageLabel(src)}.`);
}

function loadMaskImageOnce(src: string, signal: AbortSignal) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", onAbort);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => {
      finish(() => {
        image.removeAttribute("src");
        reject(signal.reason);
      });
    };
    const timeout = window.setTimeout(() => {
      finish(() => {
        image.removeAttribute("src");
        reject(new Error(`Timed out while loading holo image ${holoImageLabel(src)}.`));
      });
    }, HOLO_IMAGE_LOAD_TIMEOUT_MS);
    image.onload = () => finish(() => resolve(image));
    image.onerror = () =>
      finish(() => reject(new Error(`Failed to load holo image ${holoImageLabel(src)}.`)));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    image.src = src;
  });
}

function waitForHoloRetry(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => reject(signal.reason));
    const timeout = window.setTimeout(
      () => finish(resolve),
      HOLO_IMAGE_RETRY_DELAY_MS,
    );
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function holoImageLabel(src: string) {
  if (src.startsWith("data:") || src.startsWith("blob:")) return "embedded image";
  try {
    const pathname = new URL(src, window.location.href).pathname;
    return pathname.split("/").filter(Boolean).pop() || "image";
  } catch {
    return "image";
  }
}

function holoErrorMessage(error: unknown) {
  const detail = error instanceof Error && error.message
    ? error.message
    : "Unknown holo renderer failure.";
  return `The holographic layer failed to render. ${detail}`;
}

function drawMaskImage(ctx: CanvasRenderingContext2D, image: HoloMaskImage, element: HTMLImageElement) {
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = CARD_WIDTH;
  maskCanvas.height = CARD_HEIGHT;
  const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!maskCtx) throw new Error("The browser could not create a holo image canvas.");

  withUnityCanvasRect(maskCtx, image, (left, top, width, height) => {
    maskCtx.drawImage(element, left, top, width, height);
  });

  const imageData = maskCtx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
  normalizeMaskData(imageData.data, image.maskMode ?? "alpha");
  maskCtx.putImageData(imageData, 0, 0);

  ctx.drawImage(maskCanvas, 0, 0);
}

function normalizeMaskData(data: Uint8ClampedArray, mode: HoloRootMaskMode) {
  if (mode === "raw") {
    return;
  }

  if (mode === "red") {
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      const red = data[index];
      const maskAlpha = alpha > MASK_ALPHA_EPSILON && red > 127 ? 255 : 0;
      data[index] = maskAlpha;
      data[index + 1] = maskAlpha;
      data[index + 2] = maskAlpha;
      data[index + 3] = maskAlpha;
    }
    return;
  }

  if (mode === "alpha") {
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      data[index] = alpha;
      data[index + 1] = alpha;
      data[index + 2] = alpha;
      data[index + 3] = alpha;
    }
    return;
  }

  // "light-or-alpha" / "dark-or-alpha": key off luminance (bright- or dark-only)
  // when coverage warrants, else fall back to plain alpha. See MASK_LUMINANCE.
  let alphaPixels = 0;
  let lightPixels = 0;
  let darkPixels = 0;
  const totalPixels = data.length / 4;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha <= MASK_ALPHA_EPSILON) continue;
    alphaPixels += 1;
    const luminance = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
    if (luminance >= MASK_LUMINANCE.lightPivot) lightPixels += 1;
    if (luminance <= MASK_LUMINANCE.darkPivot) darkPixels += 1;
  }

  const alphaCoverage = alphaPixels / totalPixels;
  const lightCoverage = alphaPixels > 0 ? lightPixels / alphaPixels : 0;
  const darkCoverage = alphaPixels > 0 ? darkPixels / alphaPixels : 0;
  const useLightLuminance = alphaCoverage > MASK_LUMINANCE.coverageGate && lightCoverage > MASK_LUMINANCE.lightBand.min && lightCoverage < MASK_LUMINANCE.lightBand.max;
  const useDarkLuminance = alphaCoverage > MASK_LUMINANCE.coverageGate && lightCoverage >= MASK_LUMINANCE.lightBand.max;
  const preferDarkLuminance = mode === "dark-or-alpha" && alphaCoverage > MASK_LUMINANCE.darkModeCoverageGate && darkCoverage > MASK_LUMINANCE.darkBand.min && darkCoverage < MASK_LUMINANCE.darkBand.max;

  const { darkRamp, lightRamp, brightRamp } = MASK_LUMINANCE;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    const luminance = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
    let maskAlpha = alpha;
    if (preferDarkLuminance) {
      maskAlpha = alpha * clampNumber((darkRamp.edge - luminance) / darkRamp.span, 0, 1);
    } else if (useLightLuminance) {
      maskAlpha = alpha * clampNumber((luminance - lightRamp.edge) / lightRamp.span, 0, 1);
    } else if (useDarkLuminance) {
      maskAlpha = alpha * clampNumber((brightRamp.edge - luminance) / brightRamp.span, 0, 1);
    }
    data[index] = maskAlpha;
    data[index + 1] = maskAlpha;
    data[index + 2] = maskAlpha;
    data[index + 3] = maskAlpha;
  }
}

function drawMaskRect(ctx: CanvasRenderingContext2D, rect: HoloMaskRect) {
  withUnityCanvasRect(ctx, rect, (left, top, width, height) => {
    ctx.fillRect(left, top, width, height);
  });
}

function drawHoloTmpTextMask(
  ctx: CanvasRenderingContext2D,
  mask: HoloTmpTextMask,
  font: TmpFontMetrics,
  atlas: HTMLImageElement,
) {
  const rasterized = rasterizeTmpText(atlas, font, mask.text, {
    w: mask.w,
    h: mask.h,
    padding: TMP_TEXT_PADDING,
    fontSize: mask.fontSize,
    variant: mask.variant,
    characterSpacing: mask.characterSpacing ?? 0,
    autoSize: mask.autoSize ?? false,
    minFontSize: mask.minFontSize ?? mask.fontSize,
    horizontalAlign: mask.horizontalAlign ?? "right",
    verticalAlign: mask.verticalAlign ?? "top",
    maskIncludeUnderlay: mask.maskIncludeUnderlay ?? false,
  });
  if (!rasterized) return false;

  const rawCanvas = document.createElement("canvas");
  rawCanvas.width = CARD_WIDTH;
  rawCanvas.height = CARD_HEIGHT;
  const rawCtx = rawCanvas.getContext("2d", { willReadFrequently: true });
  if (!rawCtx) return false;
  rawCtx.imageSmoothingEnabled = true;
  withUnityCanvasRect(rawCtx, mask, (left, top, width, height) => {
    rawCtx.drawImage(
      rasterized.maskCanvas,
      left - TMP_TEXT_PADDING,
      top - TMP_TEXT_PADDING,
      width + TMP_TEXT_PADDING * 2,
      height + TMP_TEXT_PADDING * 2,
    );
  });

  const rawData = rawCtx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const rawMask = binarizeRenderedPixels(rawData);
  const dilation = Math.max(0, Math.floor(mask.dilation ?? 1));
  const outputMask = dilation > 0 ? dilateBinaryMask(rawMask, CARD_WIDTH, CARD_HEIGHT, dilation) : rawMask;
  const output = rawCtx.createImageData(CARD_WIDTH, CARD_HEIGHT);
  paintBinaryMask(output, outputMask);
  rawCtx.putImageData(output, 0, 0);
  ctx.drawImage(rawCanvas, 0, 0);
  return true;
}

function holoMaskStyle(maskUrl: string): React.CSSProperties | undefined {
  if (!maskUrl) return undefined;
  return {
    WebkitMaskImage: `url("${maskUrl}")`,
    maskImage: `url("${maskUrl}")`,
  };
}
