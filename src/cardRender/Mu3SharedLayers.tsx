import type { ReactNode } from "react";

import {
  clampInt,
  fieldBool,
  fieldString,
  numericField,
} from "../cardData/fields";
import { formatDisplaySerial } from "../cardData/formatting";
import {
  mu3AttackValue,
  mu3AwakenMarkAsset,
  mu3MaxOwnCount,
} from "../cardData/mu3";
import { qrSource } from "../cardData/qr";
import {
  CANVAS_FONT_SEGA_MARU_DB,
  MU3_AWAKEN_MARK_RECT,
  MU3_GRADE_RECT,
  MU3_LIMIT_BREAK_STAR_POSITIONS,
  MU3_LIMIT_BREAK_STAR_Y,
  MU3_MAX_LABEL_RECT,
  MU3_QR_BASE_RECT,
  MU3_RIGHTS_PLATE_RECT,
  MU3_RIGHTS_RECT,
  MU3_USER_NAME_BASE_RECT,
  officialAsset,
} from "../constants";
import { LayerCanvasText, LayerDigitCounter, LayerImage, LayerQr, LayerTmpText } from "../layers";
import type { CardRecord } from "../types";

export function Mu3LimitBreakStars({ card }: { card: CardRecord }) {
  const maxStars = mu3MaxOwnCount(card);
  const activeStars = clampInt(numericField(card, "ownCount", 0), 0, maxStars);
  return (
    <>
      {MU3_LIMIT_BREAK_STAR_POSITIONS.slice(0, maxStars).map((x, index) => (
        <LayerImage
          src={officialAsset(index < activeStars ? "UI_Card_star_01" : "UI_Card_star_00")}
          x={x}
          y={MU3_LIMIT_BREAK_STAR_Y}
          w={50}
          h={50}
          key={index}
        />
      ))}
    </>
  );
}

export function Mu3AttackLimit({ card }: { card: CardRecord }) {
  if (fieldBool(card, "hideAttackLimit")) return null;
  const attackValue = mu3AttackValue(card);
  return (
    <>
      <LayerImage src={officialAsset("UI_Card_max_00")} {...MU3_MAX_LABEL_RECT} />
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
  );
}

export function Mu3AwakenMark({ card }: { card: CardRecord }) {
  const awakenMark = mu3AwakenMarkAsset(card);
  if (fieldBool(card, "hideAwaken") || !awakenMark) return null;
  return <LayerImage src={officialAsset(awakenMark)} {...MU3_AWAKEN_MARK_RECT} />;
}

export function Mu3Grade({
  card,
  assetDataUrls,
}: {
  card: CardRecord;
  assetDataUrls: Record<string, string>;
}) {
  if (
    fieldBool(card, "hideGrade") ||
    !assetDataUrls.mu3Grade ||
    numericField(card, "gradeId", -1) < 0
  ) {
    return null;
  }
  return <LayerImage src={assetDataUrls.mu3Grade} {...MU3_GRADE_RECT} />;
}

export function Mu3UserName({
  card,
  fontSize,
  characterSpacing,
}: {
  card: CardRecord;
  fontSize: number;
  characterSpacing: number;
}) {
  if (fieldBool(card, "hideUserName")) return null;
  return (
    <>
      <LayerImage src={officialAsset("UI_Card_UserName_00")} {...MU3_USER_NAME_BASE_RECT} />
      <LayerCanvasText
        className="official-title mu3-user"
        fontFamily={CANVAS_FONT_SEGA_MARU_DB}
        fontSize={fontSize}
        fontWeight={550}
        alignment={4}
        color="#000000"
        characterSpacing={characterSpacing}
        x={267.1}
        y={-300.6}
        w={190}
        h={19.2}
        fitHorizontal
      >
        {fieldString(card, "userName") || "USER"}
      </LayerCanvasText>
    </>
  );
}

export function Mu3Qr({ card, serialFallback }: { card: CardRecord; serialFallback: string }) {
  if (fieldBool(card, "hideQRCode")) return null;
  return (
    <>
      <LayerImage src={officialAsset("UI_Card_qr_base_00")} {...MU3_QR_BASE_RECT} />
      <LayerQr source={qrSource(card, serialFallback)} x={249.4} y={-392.3} w={113} h={113} />
    </>
  );
}

export function Mu3Footer({
  card,
  assetDataUrls,
  cardNoText,
  cardNoCharSpacing,
}: {
  card: CardRecord;
  assetDataUrls: Record<string, string>;
  cardNoText: string;
  cardNoCharSpacing: number;
}) {
  return (
    <>
      <LayerImage src={officialAsset("UI_Card_rightsplate_00")} {...MU3_RIGHTS_PLATE_RECT} />
      <LayerCanvasText
        className="official-serial mu3-serial"
        fontFamily={CANVAS_FONT_SEGA_MARU_DB}
        fontSize={19}
        characterSpacing={2}
        alignment={1}
        color="#ffffff"
        x={-135}
        y={-495.9}
        w={311}
        h={21}
        fitHorizontal
      >
        {formatDisplaySerial(fieldString(card, "serialId"))}
      </LayerCanvasText>
      <LayerCanvasText
        className="official-serial mu3-cardno"
        fontFamily={CANVAS_FONT_SEGA_MARU_DB}
        fontSize={19}
        characterSpacing={cardNoCharSpacing}
        alignment={1}
        color="#ffffff"
        x={132}
        y={-495.9}
        w={311}
        h={21}
        fitHorizontal
      >
        {cardNoText}
      </LayerCanvasText>
      {assetDataUrls.mu3Rights && numericField(card, "rightsId", -1) > 0 ? (
        <LayerImage src={assetDataUrls.mu3Rights} {...MU3_RIGHTS_RECT} />
      ) : null}
    </>
  );
}

export function Mu3ShadowedTitle({
  name,
  fontSize,
  characterSpacing,
  autoSize,
  minFontSize,
  x,
  y,
  shadowX,
  shadowY,
  w,
  h,
  rotation,
  children,
}: {
  name: string;
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
  children: ReactNode;
}) {
  const shared = { fontSize, characterSpacing, autoSize, minFontSize, w, h, rotation };
  return (
    <>
      <LayerTmpText
        className={`official-title mu3-${name}-shadow`}
        variant="shadow"
        x={shadowX}
        y={shadowY}
        {...shared}
      >
        {children}
      </LayerTmpText>
      <LayerTmpText
        className={`official-title mu3-${name}`}
        variant="main"
        x={x}
        y={y}
        {...shared}
      >
        {children}
      </LayerTmpText>
    </>
  );
}
