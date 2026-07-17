import { MAI_FRAME_ASSETS, MAI_PASS_CROPS, MAI_PASS_RECT } from "../constants";
import { spriteCropDisplayRect } from "../geometry";
import type { CardRecord } from "../types";
import { fieldNumber, fieldString, numericField, twoDigits } from "./fields";

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

export function formatMaiEndDate(endDate: string) {
  const value = endDate.trim();
  if (!value) return "";
  const dateOnly = value.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const parsedDate = new Date(year, month - 1, day);
    if (
      parsedDate.getFullYear() !== year ||
      parsedDate.getMonth() !== month - 1 ||
      parsedDate.getDate() !== day
    ) {
      return "0000/00/00";
    }
    return `${dateOnly[1]}/${dateOnly[2].padStart(2, "0")}/${dateOnly[3].padStart(2, "0")}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "0000/00/00";
  const displayDate = new Date(parsed);
  displayDate.setHours(0, 0, 0, 0);
  if (parsed.getHours() < 7) {
    displayDate.setDate(displayDate.getDate() - 1);
  }
  const year = displayDate.getFullYear().toString().padStart(4, "0");
  const month = (displayDate.getMonth() + 1).toString().padStart(2, "0");
  const day = displayDate.getDate().toString().padStart(2, "0");
  return `${year}/${month}/${day}`;
}

export function maiFramePattern(card: CardRecord) {
  switch (numericField(card, "typeId", -1)) {
    case 4:
      return 0;
    case 3:
      return 1;
    case 2:
      return 2;
    case 6:
      return 3;
    default:
      return -1;
  }
}

export function maiEffectIconAsset(card: CardRecord) {
  const typeId = numericField(card, "typeId", -1);
  const paramId = numericField(card, "cardTypeParamId", 0);
  const mapBonus = fieldString(card, "mapBonus");
  const effects = maiCardTypeEffects(card);

  if (typeId === 4) {
    return mapBonus === "GoldBonus" && paramId === 200
      ? "UI_CMA_Icon_LevelUp_00"
      : "UI_CMA_Icon_PowerUp_00";
  }
  if (effects.freedom) {
    return "UI_CMA_Icon_Freedom_00";
  }
  return null;
}

export function maiCardTypeEffects(card: CardRecord) {
  const flags = maiEffectFlags(card);
  return {
    master: (flags & 1) !== 0,
    ratingMusic: (flags & 2) !== 0,
    freedom: (flags & 4) !== 0,
  };
}

export function maiEffectFlags(card: CardRecord) {
  return numericField(card, "extendBitParameter", 0);
}

export function maiRatingPlatePattern(rating: number) {
  const safeRating = rating < 0 || rating > 99999 ? 0 : rating;
  const thresholds = [0, 1000, 2000, 4000, 7000, 10000, 12000, 13000, 14000, 14500, 15000];
  let pattern = 0;
  thresholds.forEach((threshold, index) => {
    if (safeRating >= threshold) pattern = index;
  });
  return pattern;
}

// Frame pattern -> frame sprite, pass-name plate, and its crop/display rect.
// Shared verbatim by the visual card renderer and the holo mask renderer.
export function maiFrameAssets(card: CardRecord) {
  const framePattern = maiFramePattern(card);
  const frameAsset = framePattern >= 0 ? MAI_FRAME_ASSETS[framePattern] : undefined;
  const passAsset = framePattern >= 0 ? `UI_CMA_PassName_${twoDigits(framePattern)}` : null;
  const passCrop = framePattern >= 0 ? MAI_PASS_CROPS[framePattern] : null;
  const passRect = passCrop ? spriteCropDisplayRect(MAI_PASS_RECT, passCrop) : MAI_PASS_RECT;
  return { framePattern, frameAsset, passAsset, passCrop, passRect };
}

export function maiRatingBaseAsset(card: CardRecord) {
  return `UI_CMA_Rating_Base_${twoDigits(maiRatingPlatePattern(fieldNumber(card, "rating", 0)))}`;
}
