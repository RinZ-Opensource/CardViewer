import type { CSSProperties } from "react";

import { fieldBool, fieldString } from "../cardData/fields";
import { formatDisplaySerial } from "../cardData/formatting";
import { officialHolo } from "../cardData/holoRules";
import {
  formatMaiEndDate,
  maiCardTypeEffects,
  maiEffectIconAsset,
  maiFrameAssets,
  maiRatingBaseAsset,
} from "../cardData/mai";
import { qrSource } from "../cardData/qr";
import {
  MAI_CHARA_NAME_RECT,
  MAI_EFFECT_ICON_RECT,
  MAI_END_DATE_RECT,
  MAI_FRIEND_CODE_BASE_RECT,
  MAI_MASTER_ICON_RECT,
  MAI_NAME_BASE_RECT,
  MAI_PERIOD_LABEL_RECT,
  MAI_PLAYER_NAME_BASE_RECT,
  MAI_QR_CODE_BASE_RECT,
  MAI_RATING_BASE_RECT,
  MAI_RATING_ICON_RECT,
  MAI_SERIAL_CODE_BASE_RECT,
  officialAsset,
} from "../constants";
import { HoloShaderLayer } from "../holo";
import { LayerDigitCounter, LayerImage, LayerQr, LayerUnityText } from "../layers";
import type { CardRecord } from "../types";

export function MaiOfficialCard({
  card,
  imageDataUrl,
  assetDataUrls,
  lightStyle,
}: {
  card: CardRecord;
  imageDataUrl: string;
  assetDataUrls: Record<string, string>;
  lightStyle: CSSProperties;
}) {
  const hasFriendCode = fieldBool(card, "hasFriendCode");
  const serial = fieldString(card, "serialId");
  const baseFallbackSrc = assetDataUrls.maiBaseFallback || imageDataUrl || officialAsset("MAI_cardbase_default");
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
          <LayerUnityText
            className="official-code mai-period-label"
            fontKey="maru32"
            fontSize={15}
            alignment={4}
            color="#5a3900"
            glyphOffsetY={8}
            {...MAI_PERIOD_LABEL_RECT}
          >
            ブースト期限
          </LayerUnityText>
          <LayerUnityText
            className="official-code mai-chara"
            fontKey="maru32"
            fontSize={15}
            alignment={4}
            color="#5a3900"
            fitHorizontal
            glyphOffsetY={5}
            {...MAI_CHARA_NAME_RECT}
          >
            {fieldString(card, "charaName") || card.displayName}
          </LayerUnityText>
          <LayerUnityText
            className="official-code mai-period"
            fontKey="maru32"
            fontSize={20}
            alignment={1}
            color="#5a3900"
            glyphOffsetY={4}
            {...MAI_END_DATE_RECT}
          >
            {formatMaiEndDate(fieldString(card, "endDate"))}
          </LayerUnityText>
        </>
      ) : null}
      {passAsset && !hideFrame ? <LayerImage src={officialAsset(passAsset)} {...passRect} /> : null}
      {effectIconAsset && !hideCardIcon ? (
        <LayerImage src={officialAsset(effectIconAsset)} {...MAI_EFFECT_ICON_RECT} />
      ) : null}
      {effects.master && !hideCardIcon ? (
        <LayerImage src={officialAsset("UI_CMA_Icon_Master_00")} {...MAI_MASTER_ICON_RECT} />
      ) : null}
      {effects.ratingMusic && !hideCardIcon ? (
        <LayerImage src={officialAsset("UI_CMA_Icon_Rating_00")} {...MAI_RATING_ICON_RECT} />
      ) : null}
      {!hidePlayerName ? (
        <>
          <LayerImage src={officialAsset("UI_CMA_PlayerName_Base_00")} {...MAI_PLAYER_NAME_BASE_RECT} />
          <LayerUnityText
            className="official-title mai-player"
            fontKey="maru32"
            fontSize={29}
            alignment={0}
            color="#000000"
            fitHorizontal
            characterSpacing={10}
            horizontalScale={0.9}
            x={180.4}
            y={387}
            w={181.2}
            h={50}
          >
            {fieldString(card, "userName") || "PLAYER"}
          </LayerUnityText>
        </>
      ) : null}
      {!hideFriendCode ? (
        <>
          <LayerImage src={officialAsset("UI_CMA_FriendCode_Base_00")} {...MAI_FRIEND_CODE_BASE_RECT} />
          {hasFriendCode ? (
            <LayerUnityText
              className="official-code mai-friend"
              fontKey="maru32"
              fontSize={16}
              alignment={4}
              color="#000000"
              fitHorizontal
              characterSpacing={1}
              fixedGlyphTop
              x={245.8}
              y={359.4}
              w={192}
              h={23.7}
            >
              {fieldString(card, "friendCode")}
            </LayerUnityText>
          ) : (
            <LayerUnityText
              className="official-code mai-friend-empty"
              fontKey="maru32"
              fontSize={16}
              alignment={4}
              color="#000000"
              characterSpacing={4}
              x={246.8}
              y={360.8}
              w={190}
              h={12}
            >
              - - - - - - - - -
            </LayerUnityText>
          )}
        </>
      ) : null}
      {!hideRating ? (
        <>
          <LayerImage src={officialAsset(ratingBase)} {...MAI_RATING_BASE_RECT} />
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
          <LayerImage src={officialAsset("UI_CMA_SerialCode_Base_00")} {...MAI_SERIAL_CODE_BASE_RECT} />
          <LayerUnityText
            className="official-serial mai-serial"
            fontKey="kaku16"
            fontSize={16}
            alignment={1}
            fitHorizontal
            characterSpacing={-1}
            x={-100.9}
            y={-488.7}
            w={266}
            h={18}
          >
            {formatDisplaySerial(serial)}
          </LayerUnityText>
          <LayerUnityText
            className="official-serial mai-version"
            fontKey="kaku16"
            fontSize={16}
            alignment={0}
            fitHorizontal
            characterSpacing={-1}
            x={171.3}
            y={-488.7}
            w={266}
            h={18}
          >
            {fieldString(card, "verCharaId") || card.id}
          </LayerUnityText>
          <LayerImage src={officialAsset("UI_CMA_QRCode_Base_00")} {...MAI_QR_CODE_BASE_RECT} />
          <LayerQr source={qrSource(card, serial)} x={249.7} y={-394.7} w={113} h={113} />
        </>
      ) : null}
      {officialHolo(card) ? (
        <HoloShaderLayer card={card} assetDataUrls={assetDataUrls} lightStyle={lightStyle} inline />
      ) : null}
    </div>
  );
}
