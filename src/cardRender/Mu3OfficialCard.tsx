import type { CSSProperties } from "react";

import {
  clampInt,
  fieldBool,
  fieldNumber,
  fieldString,
  twoDigits,
} from "../cardData/fields";
import { officialHolo } from "../cardData/holoRules";
import {
  mu3AttributeName,
  mu3CardNames,
  mu3FrameAsset,
  mu3RareSpriteName,
  mu3RarityKind,
  mu3ShowMainFrame,
  mu3SkillAsset,
} from "../cardData/mu3";
import {
  CANVAS_FONT_SEGA_MARU_DB,
  MU3_ATTRIBUTE_RECT,
  MU3_CMN_ICON_RECT,
  MU3_DIGITAL_MARK_RECT,
  MU3_RARE_SPRITE_RECT,
  MU3_SKILL_BASE_RECT,
  officialAsset,
} from "../constants";
import { HoloShaderLayer } from "../holo";
import { LayerCanvasText, LayerImage } from "../layers";
import type { CardRecord } from "../types";
import {
  Mu3AttackLimit,
  Mu3AwakenMark,
  Mu3Footer,
  Mu3Grade,
  Mu3Qr,
  Mu3ShadowedTitle,
  Mu3UserName,
} from "./Mu3SharedLayers";

export function Mu3OfficialCard({
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
  if (card.recordType === "AssetCard") {
    return <Mu3AssetCard card={card} imageDataUrl={imageDataUrl} assetDataUrls={assetDataUrls} />;
  }

  const attr = clampInt(fieldNumber(card, "attribute", 0), 0, 2);
  const rarity = mu3RarityKind(card);
  const rareSprite = mu3RareSpriteName(card);
  const bgAsset = rarity === "N" || rarity === "R" ? `UI_Card_BG_${rarity}_${twoDigits(attr)}` : null;
  const frameAsset = mu3FrameAsset(card, attr);
  const showFrame = mu3ShowMainFrame(card);
  const charaSrc = assetDataUrls.mu3Chara;
  const cardBgSrc = assetDataUrls.mu3CardBg;
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
      {showFrame && frameAsset ? (
        <LayerImage src={officialAsset(frameAsset)} x={0} y={0} w={768} h={1052} />
      ) : null}
      {!fieldBool(card, "hideAttrRarity") ? (
        <>
          <LayerImage
            src={officialAsset(`UI_Card_Attribute_${twoDigits(attr)}_${mu3AttributeName(attr)}`)}
            {...MU3_ATTRIBUTE_RECT}
          />
          <LayerImage src={officialAsset(rareSprite)} {...MU3_RARE_SPRITE_RECT} />
        </>
      ) : null}
      {fieldBool(card, "digitalOnly") ? (
        <LayerImage src={officialAsset("UI_Card_DigitalMark_00")} {...MU3_DIGITAL_MARK_RECT} />
      ) : null}
      <Mu3Grade card={card} assetDataUrls={assetDataUrls} />
      {!fieldBool(card, "hideSkill") ? (
        <>
          <LayerImage src={officialAsset(mu3SkillAsset(card))} {...MU3_SKILL_BASE_RECT} />
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
      <Mu3AttackLimit card={card} />
      <Mu3AwakenMark card={card} />
      <Mu3UserName card={card} fontSize={22} characterSpacing={6} />
      {!fieldBool(card, "hideName") ? (
        isCommonModel ? (
          <>
            <Mu3ShadowedTitle
              name="nickname"
              fontSize={23.6}
              characterSpacing={-0.06}
              x={40}
              y={-175}
              shadowX={42.9}
              shadowY={-176.4}
              w={550}
              h={26.2}
              rotation={6}
            >
              {mu3Nickname}
            </Mu3ShadowedTitle>
            <Mu3ShadowedTitle
              name="character-name"
              fontSize={43}
              autoSize
              minFontSize={24}
              x={50}
              y={-197}
              shadowX={53.8}
              shadowY={-199}
              w={523.8}
              h={26}
              rotation={6}
            >
              {mu3CharacterName}
            </Mu3ShadowedTitle>
            <Mu3ShadowedTitle
              name="ip-title"
              fontSize={14.6}
              autoSize
              minFontSize={12}
              x={110.6}
              y={-230.9}
              shadowX={111.6}
              shadowY={-232.1}
              w={411.6}
              h={19.7}
              rotation={6}
            >
              {mu3IpName}
            </Mu3ShadowedTitle>
            <LayerImage src={officialAsset("UI_Card_CMN_3D_Icon_00")} {...MU3_CMN_ICON_RECT} />
          </>
        ) : (
          <>
            <Mu3ShadowedTitle
              name="nickname"
              fontSize={23.6}
              characterSpacing={-0.06}
              x={38.6}
              y={-183.9}
              shadowX={41.5}
              shadowY={-185.3}
              w={550}
              h={26.2}
              rotation={6}
            >
              {mu3Nickname}
            </Mu3ShadowedTitle>
            <Mu3ShadowedTitle
              name="character-name"
              fontSize={43}
              autoSize
              minFontSize={24}
              x={38.7}
              y={-224.5}
              shadowX={42.7}
              shadowY={-225.7}
              w={546}
              h={37}
              rotation={6}
            >
              {mu3BaseCharacterName}
            </Mu3ShadowedTitle>
          </>
        )
      ) : null}
      <Mu3Qr card={card} serialFallback={fieldString(card, "serialId") || fieldString(card, "cardNo")} />
      <Mu3Footer
        card={card}
        assetDataUrls={assetDataUrls}
        cardNoText={fieldString(card, "cardNo") || "CARD NO."}
        cardNoCharSpacing={1}
      />
      {officialHolo(card) ? (
        <HoloShaderLayer card={card} assetDataUrls={assetDataUrls} lightStyle={lightStyle} inline />
      ) : null}
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
  const { nickname: mu3Nickname, baseCharacterName: mu3CharacterName } = mu3CardNames(card);
  return (
    <div className="official-card official-mu3 official-mu3-asset">
      {imageDataUrl ? (
        <LayerImage src={imageDataUrl} x={0} y={0} w={768} h={1052} />
      ) : (
        <LayerImage src={officialAsset("UI_Card_BG_N_00")} x={0} y={0} w={768} h={1052} />
      )}
      <Mu3Grade card={card} assetDataUrls={assetDataUrls} />
      <Mu3AttackLimit card={card} />
      <Mu3AwakenMark card={card} />
      <Mu3UserName card={card} fontSize={19} characterSpacing={3} />
      {!fieldBool(card, "hideName") ? (
        <>
          {mu3Nickname ? (
            <Mu3ShadowedTitle
              name="nickname"
              fontSize={23.6}
              characterSpacing={-0.06}
              x={38.6}
              y={-183.9}
              shadowX={41.5}
              shadowY={-185.3}
              w={550}
              h={26.2}
              rotation={6}
            >
              {mu3Nickname}
            </Mu3ShadowedTitle>
          ) : null}
          <Mu3ShadowedTitle
            name="character-name"
            fontSize={43}
            autoSize
            minFontSize={24}
            x={38.7}
            y={-224.5}
            shadowX={42.7}
            shadowY={-225.7}
            w={546}
            h={37}
            rotation={6}
          >
            {mu3CharacterName}
          </Mu3ShadowedTitle>
        </>
      ) : null}
      <Mu3Qr card={card} serialFallback={fieldString(card, "cardNo")} />
      <Mu3Footer
        card={card}
        assetDataUrls={assetDataUrls}
        cardNoText={fieldString(card, "cardNo") || card.id}
        cardNoCharSpacing={2}
      />
    </div>
  );
}
