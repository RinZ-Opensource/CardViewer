import React from "react";
import { clampInt, fieldBool, fieldNumber, fieldString, maiCardTypeEffects, maiEffectIconAsset, maiFramePattern, maiRatingPlatePattern, mu3AttributeName, mu3AwakenMarkAsset, mu3HoloBgAsset, mu3HoloFrameBaseAsset, mu3HoloFrameOverlayAsset, mu3NeedsSign, mu3RareSpriteName, mu3SkillAsset, numericField, twoDigits } from "./cardData";
import { CARD_HEIGHT, CARD_WIDTH, MAI_CHARA_NAME_RECT, MAI_END_DATE_RECT, MAI_HOLO_UI_MASKS, MAI_NAME_BASE_RECT, MAI_PASS_CROPS, MAI_PASS_RECT, MAI_PERIOD_LABEL_RECT, MU3_AWAKEN_MARK_RECT, TmpFontContext, USE_OFFICIAL_ASSETS, officialAsset } from "./constants";
import { spriteCropDisplayRect } from "./layers";
import { TMP_TEXT_PADDING, TmpHorizontalAlign, TmpTextVariant, TmpVerticalAlign, clampNumber, loadTmpAtlas, rasterizeTmpText } from "./textRendering";
import { CardRecord, TmpFontMetrics } from "./types";

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
}: {
  layerClassName: string;
  lightStyle: React.CSSProperties;
  game: string;
  maskUrl?: string;
}) {
  if (USE_OFFICIAL_ASSETS && !maskUrl) return null;
  const maskStyle = holoMaskStyle(maskUrl);
  const foilEffectGame = game === "MAI" ? "MU3" : game;
  const foilClassName = [
    "holo-foil-plane",
    `holo-foil-${foilEffectGame.toLowerCase()}`,
    !USE_OFFICIAL_ASSETS ? "holo-foil-public" : "",
  ].filter(Boolean).join(" ");
  return (
    <div className={layerClassName} style={lightStyle}>
      <div className={foilClassName} style={maskStyle}>
        <div className="holo-foil-darkgrain" />
        <div className="holo-foil-base" />
        <div className="holo-foil-flakes" />
        <div className="holo-foil-sparkles" />
        <div className="holo-foil-glints" />
        <div className="holo-foil-glare" />
      </div>
    </div>
  );
}

export type Mu3SvgImage = {
  href: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  maskMode?: HoloRootMaskMode;
};

export type Mu3SvgRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
};

export type Mu3TmpTextMask = Mu3SvgRect & {
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

export type Mu3MaskMode = "alpha" | "light-or-alpha" | "dark-or-alpha" | "raw";
export type HoloRootMaskMode = Mu3MaskMode | "red";

export type HoloCssMaskOptions = {
  fallbackAllowWhenSparse?: boolean;
  invertApplicationArea?: boolean;
};

export function pushMu3TmpTextMask(masks: Mu3TmpTextMask[], mask: Mu3TmpTextMask) {
  if (!mask.text) return;
  masks.push({
    horizontalAlign: "right",
    verticalAlign: "top",
    dilation: 1,
    ...mask,
  });
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
  const framePattern = maiFramePattern(card);
  const frameAsset = ["UI_CMA_Card_Frame_00_Gold", "UI_CMA_Card_Frame_01_Silver", "UI_CMA_Card_Frame_02_Bronze", "UI_CMA_Card_Frame_03_Freedom"][framePattern];
  const passAsset = framePattern >= 0 ? `UI_CMA_PassName_${twoDigits(framePattern)}` : null;
  const passCrop = framePattern >= 0 ? MAI_PASS_CROPS[framePattern] : null;
  const passRect = passCrop ? spriteCropDisplayRect(MAI_PASS_RECT, passCrop) : MAI_PASS_RECT;
  const ratingBase = `UI_CMA_Rating_Base_${twoDigits(maiRatingPlatePattern(fieldNumber(card, "rating", 0)))}`;
  const effects = maiCardTypeEffects(card);
  const effectIconAsset = maiEffectIconAsset(card);
  const rootImages: Mu3SvgImage[] = [];
  const frontImages: Mu3SvgImage[] = [];
  const frontRects: Mu3SvgRect[] = [];

  rootImages.push({ href: officialAsset("UI_CMA_Holo_CardBase_00"), x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw" });
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
    frontImages.push({ href: officialAsset(effectIconAsset), x: -303, y: -403, w: 112, h: 112 });
  }
  if (effects.master && !hideCardIcon) {
    frontImages.push({ href: officialAsset("UI_CMA_Icon_Master_00"), x: -193.2, y: -403, w: 112, h: 112 });
  }
  if (effects.ratingMusic && !hideCardIcon) {
    frontImages.push({ href: officialAsset("UI_CMA_Icon_Rating_00"), x: -84, y: -403, w: 112, h: 112 });
  }
  if (!hidePlayerName) {
    frontImages.push({ href: officialAsset("UI_CMA_PlayerName_Base_00"), x: 211, y: 397, w: 276, h: 48 });
    frontRects.push({ x: 180.4, y: 387, w: 181.2, h: 50 });
  }
  if (!hideFriendCode) {
    frontImages.push({ href: officialAsset("UI_CMA_FriendCode_Base_00"), x: 211, y: 360.8, w: 276, h: 40 });
    frontRects.push(
      hasFriendCode
        ? { x: 245.8, y: 359.4, w: 192, h: 23.7 }
        : { x: 246.8, y: 360.8, w: 190, h: 12 },
    );
  }
  if (!hideRating) {
    frontImages.push({ href: officialAsset(ratingBase), x: 212.4, y: 456.9, w: 280, h: 76 });
    frontRects.push({ x: 333, y: 457, w: 138, h: 94 });
  }
  if (!hideSerialAndQR) {
    frontImages.push({ href: officialAsset("UI_CMA_SerialCode_Base_00"), x: 0, y: -486.5, w: 490, h: 32 });
    frontImages.push({ href: officialAsset("UI_CMA_QRCode_Base_00"), x: 249.7, y: -394.7, w: 164, h: 164 });
    frontRects.push({ x: -100.9, y: -488.7, w: 266, h: 18 });
    frontRects.push({ x: 171.3, y: -488.7, w: 266, h: 18 });
    frontRects.push({ x: 249.7, y: -394.7, w: 113, h: 113 });
  }

  const hasHoloMaskSource = rootImages.length > 0 || frontImages.length > 0 || frontRects.length > 0;
  const cssMaskUrl = useOfficialHoloMask(rootImages, frontImages, frontRects, hasHoloMaskSource, {
    fallbackAllowWhenSparse: false,
    invertApplicationArea: true,
  });
  if (!hasHoloMaskSource) {
    return null;
  }

  return <HoloMaterialLayer layerClassName={layerClassName} lightStyle={lightStyle} game={card.game} maskUrl={cssMaskUrl} />;
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
  const showSign = mu3NeedsSign(card) && assetDataUrls.mu3Sign && assetDataUrls.mu3SignMask;
  const rightsId = numericField(card, "rightsId", -1);
  const rootImages: Mu3SvgImage[] = [];
  const frontImages: Mu3SvgImage[] = [];
  const frontRects: Mu3SvgRect[] = [];
  const frontTextMasks: Mu3TmpTextMask[] = [];
  const signMaskImages: Mu3SvgImage[] = [];
  const signClearImages: Mu3SvgImage[] = [];
  const excludeImages: Mu3SvgImage[] = [];
  const tmpFont = React.useContext(TmpFontContext);
  const isCommonModel = fieldBool(card, "isCommonModel");
  const mu3Nickname = fieldString(card, "nickName");
  const mu3CharacterName =
    fieldString(card, "nameForCommonModel") ||
    fieldString(card, "characterName") ||
    card.displayName;
  const mu3BaseCharacterName =
    fieldString(card, "baseCharacterName") ||
    fieldString(card, "characterName") ||
    card.displayName;
  const mu3IpName = fieldString(card, "ipName");

  if (assetDataUrls.mu3Holo) {
    rootImages.push({ href: assetDataUrls.mu3Holo, x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw" });
  }
  if (!assetDataUrls.mu3Holo) {
    const holoBg = mu3HoloBgAsset(card, attr);
    const holoFrameBase = mu3HoloFrameBaseAsset(card);
    const holoFrameOverlay = mu3HoloFrameOverlayAsset(card);
    if (holoBg) {
      // The extracted UI_Card_Horo_BG_* foil textures sit ~12px left / 3px up of the
      // printed UI_Card_BG_* art (a systematic registration offset, identical across
      // rarities). Nudge the holo BG right+down so the foil "ONGEKI" logo and line-art
      // line up with the printed background. (+x = right, -y = down in this coord space.)
      //
      // Backfill first: an un-nudged full-frame copy paints the whole card, so the 12px
      // left / 3px bottom margin that the nudge would otherwise leave uncovered (showing
      // up as a bare vertical strip) is filled with edge foil instead. The opaque nudged
      // copy then overwrites the interior, so only the extreme card edge keeps the
      // un-nudged pattern.
      rootImages.push({ href: officialAsset(holoBg), x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw" });
      rootImages.push({ href: officialAsset(holoBg), x: 12, y: -3, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw" });
    }
    if (holoFrameBase) {
      rootImages.push({ href: officialAsset(holoFrameBase), x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw" });
    }
    if (assetDataUrls.mu3Mask) {
      rootImages.push({ href: assetDataUrls.mu3Mask, x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw" });
      excludeImages.push({ href: assetDataUrls.mu3Mask, x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "alpha" });
    }
    if (holoFrameOverlay) {
      rootImages.push({ href: officialAsset(holoFrameOverlay), x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "raw" });
    }
  }
  if (!fieldBool(card, "hideAttrRarity")) {
    frontImages.push({ href: officialAsset(`UI_Card_Attribute_${twoDigits(attr)}_${mu3AttributeName(attr)}`), x: -297, y: 439, w: 130, h: 130 });
    frontImages.push({ href: officialAsset(mu3RareSpriteName(card)), x: -161.4, y: 442.3, w: 208, h: 118 });
  }
  if (fieldBool(card, "digitalOnly")) {
    frontImages.push({ href: officialAsset("UI_Card_DigitalMark_00"), x: 239.2, y: 477.4, w: 294, h: 102 });
  }
  if (!fieldBool(card, "hideGrade") && assetDataUrls.mu3Grade) {
    frontImages.push({ href: assetDataUrls.mu3Grade, x: 295, y: 455, w: 94, h: 142 });
  }
  if (!fieldBool(card, "hideSkill")) {
    frontImages.push({ href: officialAsset(mu3SkillAsset(card)), x: -40.3, y: -367.7, w: 628, h: 108 });
    frontRects.push({ x: -36.3, y: -381.9, w: 444, h: 66 });
  }
  if (!fieldBool(card, "hideAttackLimit")) {
    frontImages.push({ href: officialAsset("UI_Card_max_00"), x: -291, y: -228.6, w: 108, h: 34 });
    frontRects.push({ x: -291, y: -276.6, w: 132, h: 112 });
    frontRects.push({ x: -26, y: -290.1, w: 398, h: 52 });
  }
  if (!fieldBool(card, "hideAwaken") && mu3AwakenMarkAsset(card)) {
    frontImages.push({ href: officialAsset(mu3AwakenMarkAsset(card)), ...MU3_AWAKEN_MARK_RECT });
  }
  if (!fieldBool(card, "hideUserName")) {
    frontImages.push({ href: officialAsset("UI_Card_UserName_00"), x: 278, y: -291.8, w: 212, h: 56 });
    frontRects.push({ x: 267.1, y: -300.6, w: 206, h: 28 });
  }
  if (!fieldBool(card, "hideName")) {
    if (isCommonModel) {
      pushMu3TmpTextMask(frontTextMasks, { text: mu3Nickname, fontSize: 23.6, variant: "shadow", characterSpacing: -0.06, x: 42.9, y: -176.4, w: 550, h: 26.2, rotation: 6 });
      pushMu3TmpTextMask(frontTextMasks, { text: mu3Nickname, fontSize: 23.6, variant: "main", characterSpacing: -0.06, x: 40, y: -175, w: 550, h: 26.2, rotation: 6 });
      pushMu3TmpTextMask(frontTextMasks, { text: mu3CharacterName, fontSize: 43, variant: "shadow", autoSize: true, minFontSize: 24, x: 53.8, y: -199, w: 523.8, h: 26, rotation: 6 });
      pushMu3TmpTextMask(frontTextMasks, { text: mu3CharacterName, fontSize: 43, variant: "main", autoSize: true, minFontSize: 24, x: 50, y: -197, w: 523.8, h: 26, rotation: 6 });
      pushMu3TmpTextMask(frontTextMasks, { text: mu3IpName, fontSize: 14.6, variant: "shadow", autoSize: true, minFontSize: 12, x: 111.6, y: -232.1, w: 411.6, h: 19.7, rotation: 6 });
      pushMu3TmpTextMask(frontTextMasks, { text: mu3IpName, fontSize: 14.6, variant: "main", autoSize: true, minFontSize: 12, x: 110.6, y: -230.9, w: 411.6, h: 19.7, rotation: 6 });
      frontImages.push({ href: officialAsset("UI_Card_CMN_3D_Icon_00"), x: 262.8, y: -224.3, w: 146, h: 38, rotation: 6 });
    } else {
      pushMu3TmpTextMask(frontTextMasks, { text: mu3Nickname, fontSize: 23.6, variant: "shadow", characterSpacing: -0.06, x: 41.5, y: -185.3, w: 550, h: 26.2, rotation: 6 });
      pushMu3TmpTextMask(frontTextMasks, { text: mu3Nickname, fontSize: 23.6, variant: "main", characterSpacing: -0.06, x: 38.6, y: -183.9, w: 550, h: 26.2, rotation: 6 });
      pushMu3TmpTextMask(frontTextMasks, { text: mu3BaseCharacterName, fontSize: 43, variant: "shadow", autoSize: true, minFontSize: 24, x: 42.7, y: -225.7, w: 546, h: 37, rotation: 6 });
      pushMu3TmpTextMask(frontTextMasks, { text: mu3BaseCharacterName, fontSize: 43, variant: "main", autoSize: true, minFontSize: 24, x: 38.7, y: -224.5, w: 546, h: 37, rotation: 6 });
    }
  }
  if (!fieldBool(card, "hideQRCode")) {
    frontImages.push({ href: officialAsset("UI_Card_qr_base_00"), x: 251.8, y: -396.1, w: 157, h: 158 });
    frontRects.push({ x: 249.4, y: -392.3, w: 128, h: 128 });
  }
  frontImages.push({ href: officialAsset("UI_Card_rightsplate_00"), x: 0, y: -502, w: 768, h: 48 });
  frontRects.push({ x: -135, y: -495.9, w: 326, h: 30 });
  frontRects.push({ x: 132, y: -495.9, w: 326, h: 30 });
  if (assetDataUrls.mu3Rights && rightsId > 0) {
    frontImages.push({ href: assetDataUrls.mu3Rights, x: -85, y: -447, w: 520, h: 64 });
  }
  if (showSign && assetDataUrls.mu3SignMask) {
    signMaskImages.push({ href: assetDataUrls.mu3SignMask, x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "alpha" });
  }
  if (showSign && assetDataUrls.mu3Sign) {
    signClearImages.push({ href: assetDataUrls.mu3Sign, x: 0, y: 0, w: CARD_WIDTH, h: CARD_HEIGHT, maskMode: "alpha" });
  }

  const hasHoloMaskSource =
    rootImages.length > 0 ||
    frontImages.length > 0 ||
    frontRects.length > 0 ||
    frontTextMasks.length > 0 ||
    signMaskImages.length > 0;
  const cssMaskUrl = useOfficialHoloMask(
    rootImages,
    frontImages,
    frontRects,
    hasHoloMaskSource,
    { invertApplicationArea: true },
    signMaskImages,
    signClearImages,
    frontTextMasks,
    tmpFont,
    excludeImages,
  );
  if (!hasHoloMaskSource) {
    return null;
  }

  return <HoloMaterialLayer layerClassName={layerClassName} lightStyle={lightStyle} game={card.game} maskUrl={cssMaskUrl} />;
}

export function useOfficialHoloMask(
  rootImages: Mu3SvgImage[],
  frontImages: Mu3SvgImage[],
  frontRects: Mu3SvgRect[],
  enabled: boolean,
  options: HoloCssMaskOptions = {},
  signMaskImages: Mu3SvgImage[] = [],
  signClearImages: Mu3SvgImage[] = [],
  frontTextMasks: Mu3TmpTextMask[] = [],
  tmpFont: TmpFontMetrics | null = null,
  excludeImages: Mu3SvgImage[] = [],
) {
  const maskKey = JSON.stringify({
    enabled,
    fallbackAllowWhenSparse: options.fallbackAllowWhenSparse ?? true,
    invertApplicationArea: options.invertApplicationArea ?? false,
    root: rootImages.map((image) => [image.href, image.x, image.y, image.w, image.h, image.rotation ?? 0, image.maskMode ?? "alpha"]),
    front: frontImages.map((image) => [image.href, image.x, image.y, image.w, image.h, image.rotation ?? 0, image.maskMode ?? "alpha"]),
    rects: frontRects.map((rect) => [rect.x, rect.y, rect.w, rect.h, rect.rotation ?? 0]),
    text: frontTextMasks.map((mask) => [
      mask.text,
      mask.x,
      mask.y,
      mask.w,
      mask.h,
      mask.rotation ?? 0,
      mask.fontSize,
      mask.variant,
      mask.characterSpacing ?? 0,
      mask.autoSize ?? false,
      mask.minFontSize ?? mask.fontSize,
      mask.horizontalAlign ?? "right",
      mask.verticalAlign ?? "top",
      mask.dilation ?? 1,
      mask.maskIncludeUnderlay ?? false,
    ]),
    tmpFont: tmpFont ? [tmpFont.texture, tmpFont.fontInfo.PointSize, tmpFont.fontInfo.LineHeight, tmpFont.fontInfo.Ascender] : null,
    signMask: signMaskImages.map((image) => [image.href, image.x, image.y, image.w, image.h, image.rotation ?? 0, image.maskMode ?? "alpha"]),
    signClear: signClearImages.map((image) => [image.href, image.x, image.y, image.w, image.h, image.rotation ?? 0, image.maskMode ?? "alpha"]),
    exclude: excludeImages.map((image) => [image.href, image.x, image.y, image.w, image.h, image.rotation ?? 0, image.maskMode ?? "alpha"]),
  });
  const [maskUrl, setMaskUrl] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      setMaskUrl("");
      return () => {
        cancelled = true;
      };
    }
    // Keep the previous mask visible while the new one renders so toggling
    // visibility/print flags doesn't flash the holo off for a frame.
    renderOfficialHoloMask(rootImages, frontImages, frontRects, options, signMaskImages, signClearImages, frontTextMasks, tmpFont, excludeImages)
      .then((url) => {
        if (!cancelled) setMaskUrl(url);
      })
      .catch(() => {
        if (!cancelled) setMaskUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [maskKey]);

  return maskUrl;
}

export async function renderOfficialHoloMask(
  rootImages: Mu3SvgImage[],
  frontImages: Mu3SvgImage[],
  frontRects: Mu3SvgRect[],
  options: HoloCssMaskOptions = {},
  signMaskImages: Mu3SvgImage[] = [],
  signClearImages: Mu3SvgImage[] = [],
  frontTextMasks: Mu3TmpTextMask[] = [],
  tmpFont: TmpFontMetrics | null = null,
  excludeImages: Mu3SvgImage[] = [],
) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

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
  if (!rootCtx || !frontCtx || !frontTextCtx || !signMaskCtx || !signClearCtx || !excludeCtx) return "";

  rootCtx.imageSmoothingEnabled = true;
  frontCtx.imageSmoothingEnabled = true;
  frontTextCtx.imageSmoothingEnabled = true;
  signMaskCtx.imageSmoothingEnabled = true;
  signClearCtx.imageSmoothingEnabled = true;
  excludeCtx.imageSmoothingEnabled = true;

  const loadImages = (images: Mu3SvgImage[]) =>
    Promise.all(
      images.map(async (image) => {
        try {
          return { image, element: await loadMaskImage(image.href) };
        } catch {
          return null;
        }
      }),
    );

  const [loadedRootImages, loadedFrontImages, loadedSignMaskImages, loadedSignClearImages, loadedExcludeImages] = await Promise.all([
    loadImages(rootImages),
    loadImages(frontImages),
    loadImages(signMaskImages),
    loadImages(signClearImages),
    loadImages(excludeImages),
  ]);
  const tmpAtlas =
    tmpFont && frontTextMasks.length
      ? await loadTmpAtlas(tmpFont).catch(() => null)
      : null;

  for (const loaded of loadedRootImages) {
    if (!loaded) continue;
    drawMu3ImageMask(rootCtx, loaded.image, loaded.element);
  }
  for (const loaded of loadedFrontImages) {
    if (!loaded) continue;
    drawMu3ImageMask(frontCtx, loaded.image, loaded.element);
  }
  frontCtx.fillStyle = "#ffffff";
  for (const rect of frontRects) {
    drawMu3RectExclusion(frontCtx, rect);
  }
  if (tmpFont && tmpAtlas) {
    for (const mask of frontTextMasks) {
      drawMu3TmpTextMask(frontTextCtx, mask, tmpFont, tmpAtlas);
    }
  }
  for (const loaded of loadedSignMaskImages) {
    if (!loaded) continue;
    drawMu3ImageMask(signMaskCtx, loaded.image, loaded.element);
  }
  for (const loaded of loadedSignClearImages) {
    if (!loaded) continue;
    drawMu3ImageMask(signClearCtx, loaded.image, loaded.element);
  }
  for (const loaded of loadedExcludeImages) {
    if (!loaded) continue;
    drawMu3ImageMask(excludeCtx, loaded.image, loaded.element);
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
  const dilatedFrontMask = dilateBinaryMask(frontMask, CARD_WIDTH, CARD_HEIGHT, 7);
  const out = ctx.createImageData(CARD_WIDTH, CARD_HEIGHT);
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
  }

  ctx.putImageData(out, 0, 0);
  return canvas.toDataURL("image/png");
}

export function binarizeRenderedPixels(imageData: ImageData) {
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

export function paintBinaryMask(imageData: ImageData, mask: Uint8ClampedArray<ArrayBufferLike>) {
  for (let pixel = 0, index = 0; pixel < mask.length; pixel += 1, index += 4) {
    const alpha = mask[pixel] > 0 ? 255 : 0;
    imageData.data[index] = 255;
    imageData.data[index + 1] = 255;
    imageData.data[index + 2] = 255;
    imageData.data[index + 3] = alpha;
  }
}

export function dilateBinaryMask(src: Uint8ClampedArray<ArrayBufferLike>, width: number, height: number, iterations: number) {
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

export function loadMaskImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

export function drawMu3ImageMask(ctx: CanvasRenderingContext2D, image: Mu3SvgImage, element: HTMLImageElement) {
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = CARD_WIDTH;
  maskCanvas.height = CARD_HEIGHT;
  const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!maskCtx) return;

  withUnityCanvasRect(maskCtx, image, (left, top, width, height) => {
    maskCtx.drawImage(element, left, top, width, height);
  });

  const imageData = maskCtx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
  normalizeMu3MaskData(imageData.data, image.maskMode ?? "alpha");
  maskCtx.putImageData(imageData, 0, 0);

  ctx.drawImage(maskCanvas, 0, 0);
}

export function normalizeMu3MaskData(data: Uint8ClampedArray, mode: HoloRootMaskMode) {
  if (mode === "raw") {
    return;
  }

  if (mode === "red") {
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      const red = data[index];
      const maskAlpha = alpha > 8 && red > 127 ? 255 : 0;
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

  let alphaPixels = 0;
  let lightPixels = 0;
  let darkPixels = 0;
  const totalPixels = data.length / 4;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha <= 8) continue;
    alphaPixels += 1;
    const luminance = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
    if (luminance >= 128) lightPixels += 1;
    if (luminance <= 144) darkPixels += 1;
  }

  const alphaCoverage = alphaPixels / totalPixels;
  const lightCoverage = alphaPixels > 0 ? lightPixels / alphaPixels : 0;
  const darkCoverage = alphaPixels > 0 ? darkPixels / alphaPixels : 0;
  const useLightLuminance = alphaCoverage > 0.72 && lightCoverage > 0.01 && lightCoverage < 0.96;
  const useDarkLuminance = alphaCoverage > 0.72 && lightCoverage >= 0.96;
  const preferDarkLuminance = mode === "dark-or-alpha" && alphaCoverage > 0.42 && darkCoverage > 0.005 && darkCoverage < 0.98;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    const luminance = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
    let maskAlpha = alpha;
    if (preferDarkLuminance) {
      maskAlpha = alpha * clampNumber((212 - luminance) / 168, 0, 1);
    } else if (useLightLuminance) {
      maskAlpha = alpha * clampNumber((luminance - 24) / 200, 0, 1);
    } else if (useDarkLuminance) {
      maskAlpha = alpha * clampNumber((232 - luminance) / 200, 0, 1);
    }
    data[index] = maskAlpha;
    data[index + 1] = maskAlpha;
    data[index + 2] = maskAlpha;
    data[index + 3] = maskAlpha;
  }
}

export function drawMu3RectExclusion(ctx: CanvasRenderingContext2D, rect: Mu3SvgRect) {
  withUnityCanvasRect(ctx, rect, (left, top, width, height) => {
    ctx.fillRect(left, top, width, height);
  });
}

export function drawMu3TmpTextMask(
  ctx: CanvasRenderingContext2D,
  mask: Mu3TmpTextMask,
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
  if (!rasterized) return;

  const rawCanvas = document.createElement("canvas");
  rawCanvas.width = CARD_WIDTH;
  rawCanvas.height = CARD_HEIGHT;
  const rawCtx = rawCanvas.getContext("2d", { willReadFrequently: true });
  if (!rawCtx) return;
  rawCtx.imageSmoothingEnabled = true;
  const left = CARD_WIDTH / 2 + mask.x - mask.w / 2;
  const top = CARD_HEIGHT / 2 - mask.y - mask.h / 2;
  const centerX = left + mask.w / 2;
  const centerY = top + mask.h / 2;
  rawCtx.save();
  if (mask.rotation) {
    rawCtx.translate(centerX, centerY);
    rawCtx.rotate((-mask.rotation * Math.PI) / 180);
    rawCtx.translate(-centerX, -centerY);
  }
  rawCtx.drawImage(
    rasterized.maskCanvas,
    left - TMP_TEXT_PADDING,
    top - TMP_TEXT_PADDING,
    mask.w + TMP_TEXT_PADDING * 2,
    mask.h + TMP_TEXT_PADDING * 2,
  );
  rawCtx.restore();

  const rawData = rawCtx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const rawMask = binarizeRenderedPixels(rawData);
  const dilation = Math.max(0, Math.floor(mask.dilation ?? 1));
  const outputMask = dilation > 0 ? dilateBinaryMask(rawMask, CARD_WIDTH, CARD_HEIGHT, dilation) : rawMask;
  const output = rawCtx.createImageData(CARD_WIDTH, CARD_HEIGHT);
  paintBinaryMask(output, outputMask);
  rawCtx.putImageData(output, 0, 0);
  ctx.drawImage(rawCanvas, 0, 0);
}

export function withUnityCanvasRect(
  ctx: CanvasRenderingContext2D,
  rect: Mu3SvgImage | Mu3SvgRect,
  draw: (left: number, top: number, width: number, height: number) => void,
) {
  const left = CARD_WIDTH / 2 + rect.x - rect.w / 2;
  const top = CARD_HEIGHT / 2 - rect.y - rect.h / 2;
  const centerX = left + rect.w / 2;
  const centerY = top + rect.h / 2;
  ctx.save();
  if (rect.rotation) {
    ctx.translate(centerX, centerY);
    ctx.rotate((-rect.rotation * Math.PI) / 180);
    ctx.translate(-centerX, -centerY);
  }
  draw(left, top, rect.w, rect.h);
  ctx.restore();
}

export function cssImageUrl(url: string) {
  return `url("${url.replace(/"/g, '\\"')}")`;
}

export function HoloColorMask({
  className,
  maskUrl,
}: {
  className: string;
  maskUrl: string;
}) {
  return (
    <div className={`holo-color-mask ${className}`} style={holoMaskStyle(maskUrl)}>
      <div className="holo-rainbow holo-rainbow-mask" />
      <div className="holo-fixed-light holo-fixed-light-mask" />
    </div>
  );
}

export function holoMaskStyle(maskUrl: string): React.CSSProperties | undefined {
  if (!maskUrl) return undefined;
  return {
    WebkitMaskImage: `url("${maskUrl}")`,
    maskImage: `url("${maskUrl}")`,
  };
}

export function unityRect(
  x: number,
  y: number,
  w: number,
  h: number,
  transform: { rotation?: number; scale?: number } = {},
): React.CSSProperties {
  const left = CARD_WIDTH / 2 + x - w / 2;
  const top = CARD_HEIGHT / 2 - y - h / 2;
  const transforms = [
    transform.rotation ? `rotate(${-transform.rotation}deg)` : "",
    transform.scale && transform.scale !== 1 ? `scale(${transform.scale})` : "",
  ].filter(Boolean);
  return {
    left: `${(left / CARD_WIDTH) * 100}%`,
    top: `${(top / CARD_HEIGHT) * 100}%`,
    width: `${(w / CARD_WIDTH) * 100}%`,
    height: `${(h / CARD_HEIGHT) * 100}%`,
    transform: transforms.length ? transforms.join(" ") : undefined,
    transformOrigin: "50% 50%",
  };
}

