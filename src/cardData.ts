import { HOLO_ENABLED, MAI_FRAME_ASSETS, MAI_PASS_CROPS, MAI_PASS_RECT, MU3_LEVEL_LIMITS } from "./constants";
import { spriteCropDisplayRect } from "./geometry";
import { CardRecord } from "./types";
import type { QrSource } from "./types";

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

export function fieldString(card: CardRecord, key: string) {
  return card.printFields.find((field) => field.key === key)?.value.trim() ?? "";
}

export function fieldEdited(card: CardRecord, key: string) {
  return card.editedPrintFields?.includes(key) ?? false;
}

export function formatDisplaySerial(serialId: string) {
  const raw = serialId.replace(/[\s-]/g, "");
  if (!raw) return "";
  const paddedLength = (raw.length + 3) & -4;
  let count = 0;
  let display = "";
  for (let i = raw.length; i < paddedLength; i += 1) {
    display += " ";
    count += 1;
  }
  for (const char of raw) {
    display += char;
    count += 1;
    if ((count & 3) === 0) display += " ";
  }
  return display;
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

export function fieldBool(card: CardRecord, key: string) {
  return card.printFields.find((field) => field.key === key)?.value === "true";
}

export function officialHolo(card: CardRecord) {
  if (!HOLO_ENABLED) return false;
  if (card.game === "CHU") return false;
  if (card.game === "MAI") return maiOfficialHolo(card);
  return fieldBool(card, "holo");
}

export function maiOfficialHolo(card: CardRecord) {
  if (card.printFields.some((field) => field.key === "holo")) {
    return fieldBool(card, "holo");
  }
  return [4, 6].includes(numericField(card, "typeId", -1));
}

export function mu3NeedsSign(card: CardRecord) {
  return (
    mu3RarityKind(card) === "SSR" &&
    fieldBool(card, "hideAttrRarity") &&
    fieldBool(card, "hideAttackLimit") &&
    fieldBool(card, "hideSkill") &&
    fieldBool(card, "hideGrade") &&
    fieldBool(card, "hideName") &&
    fieldBool(card, "hideAwaken") &&
    fieldBool(card, "hideUserName") &&
    fieldBool(card, "hideQRCode")
  );
}

export function numericField(card: CardRecord, key: string, fallback: number) {
  const raw = fieldString(card, key);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function numericText(value: string, fallback: number) {
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  const match = value.match(/\d+/);
  if (!match) return fallback;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function qrSource(card: CardRecord, fallback: string): QrSource {
  const override = fieldString(card, "qrPayload");
  if (override) return override;

  const bytes = card.game === "MAI" ? maiQrBytes(card) : card.game === "MU3" ? mu3QrBytes(card) : null;
  if (bytes) {
    return [{ data: new Uint8ClampedArray(bytes), mode: "byte" }];
  }

  return [card.game, card.dataName, fieldString(card, "serialId"), fallback].filter(Boolean).join("|");
}

// Per-game QR payload constants: the in-game game id baked into each card's QR
// record and the RC4 key that scrambles it.
const MAI_QR_GAME_ID = 5915972;
const MU3_QR_GAME_ID = 5522500;
const MAI_QR_RC4_KEY = [144, 95, 51, 167, 195, 243, 253, 226, 84, 194, 239, 80, 177, 205, 41, 78];
const MU3_QR_RC4_KEY = [38, 34, 177, 150, 54, 114, 151, 245, 80, 162, 229, 42, 75, 224, 55, 156];

export function maiQrBytes(card: CardRecord) {
  const cardId = numericField(card, "cardId", numericText(card.id, NaN));
  const charaId = numericField(card, "charaId", 0);
  if (!Number.isFinite(cardId) || !Number.isFinite(charaId)) return null;
  const bytes = createQrBytes(cardId, charaId, MAI_QR_GAME_ID);
  return rc4(bytes, MAI_QR_RC4_KEY);
}

export function mu3QrBytes(card: CardRecord) {
  const cardId = numericField(
    card,
    "cardId",
    numericText(fieldString(card, "cardNo") || card.id || card.dataName, NaN),
  );
  if (!Number.isFinite(cardId)) return null;
  const bytes = createQrBytes(cardId, 0, MU3_QR_GAME_ID);
  return rc4(bytes, MU3_QR_RC4_KEY);
}

// 14-byte QR record: [0..3] zero, [4..6] cardId (LE24), [7..10] serial (LE32),
// [11..13] gameId (LE24).
export function createQrBytes(cardId: number, serial: number, gameId: number) {
  const bytes = new Uint8Array(14);
  writeLe32(bytes, 0, 0);
  writeLe24(bytes, 4, cardId);
  writeLe32(bytes, 7, serial);
  writeLe24(bytes, 11, gameId);
  return bytes;
}

export function writeLe24(bytes: Uint8Array, offset: number, value: number) {
  const number = Math.trunc(value);
  bytes[offset] = number & 0xff;
  bytes[offset + 1] = (number >> 8) & 0xff;
  bytes[offset + 2] = (number >> 16) & 0xff;
}

export function writeLe32(bytes: Uint8Array, offset: number, value: number) {
  const number = Math.trunc(value);
  bytes[offset] = number & 0xff;
  bytes[offset + 1] = (number >> 8) & 0xff;
  bytes[offset + 2] = (number >> 16) & 0xff;
  bytes[offset + 3] = (number >> 24) & 0xff;
}

export function rc4(input: Uint8Array, key: number[]) {
  const state = Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + state[i] + key[i % key.length]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
  }
  let i = 0;
  j = 0;
  const output = new Uint8Array(input);
  for (let n = 0; n < output.length; n += 1) {
    i = (i + 1) & 0xff;
    j = (j + state[i]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
    output[n] ^= state[(state[i] + state[j]) & 0xff];
  }
  return output;
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

// Frame pattern → frame sprite, pass-name plate, and its crop/display rect.
// Shared verbatim by the visual card (cards.tsx) and the holo mask (holo.tsx).
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

export function mu3AttackValue(card: CardRecord) {
  if (fieldEdited(card, "maxAttack")) {
    return fieldString(card, "maxAttack");
  }

  const params = mu3LevelParams(card);
  if (!params.length) return fieldString(card, "maxAttack");

  const ownCount = numericField(card, "ownCount", 0);
  const awaken = mu3Awaken(card);
  const level = mu3MaxLevel(card, ownCount, awaken > 0);
  return String(mu3LevelPower(params, level, awaken === 2));
}

export function mu3LevelParams(card: CardRecord) {
  return fieldString(card, "levelParams")
    .split(/[,\s]+/)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

export function mu3MaxOwnCount(card: CardRecord) {
  return mu3RarityKind(card) === "N" ? 11 : 5;
}

export function mu3MaxLevel(card: CardRecord, ownCount: number, isKaika: boolean) {
  const max = mu3MaxOwnCount(card);
  const clampedOwnCount = clampInt(ownCount, 1, max) - 1;
  return 10 + clampedOwnCount * 5 + (isKaika ? 40 : 0);
}

export function mu3LevelPower(params: number[], level: number, isChoKaika: boolean) {
  const count = Math.min(params.length, MU3_LEVEL_LIMITS.length);
  if (count <= 0) return 0;
  if (isChoKaika) return params[count - 1] ?? 0;

  let segment = -1;
  for (let index = 0; index < count - 2; index += 1) {
    if (MU3_LEVEL_LIMITS[index] <= level && level <= MU3_LEVEL_LIMITS[index + 1]) {
      segment = index;
      break;
    }
  }
  if (segment < 0) return 0;
  if (count - 2 <= segment) return params[segment] ?? 0;

  const fromLevel = MU3_LEVEL_LIMITS[segment];
  const toLevel = MU3_LEVEL_LIMITS[segment + 1];
  const t = (level - fromLevel) / (toLevel - fromLevel);
  const fromPower = params[segment] ?? 0;
  const toPower = params[segment + 1] ?? fromPower;
  return Math.trunc(fromPower + (toPower - fromPower) * t);
}

export function mu3Awaken(card: CardRecord) {
  return clampInt(numericField(card, "awaken", 1), 0, 2);
}

export function mu3AwakenMarkAsset(card: CardRecord) {
  switch (mu3Awaken(card)) {
    case 1:
      return "UI_Card_PrintMark_01_kaika";
    case 2:
      return "UI_Card_PrintMark_02_tyoukaika";
    default:
      return "";
  }
}

export function mu3RarityKind(card: CardRecord) {
  const rare = numericField(card, "rareType", card.rareType ?? 0);
  if (rare === 1) return "R";
  if (rare === 2) return "SR";
  if (rare === 3) return "SSR";
  if (rare === 12) return "SRPlus";
  return "N";
}

// Title-block names (shared by the visual card and the holo mask): characterName
// is the common-model name, baseCharacterName the non-common / asset-card name.
export function mu3CardNames(card: CardRecord) {
  const fallback = fieldString(card, "characterName") || card.displayName;
  return {
    isCommonModel: fieldBool(card, "isCommonModel"),
    nickname: fieldString(card, "nickName"),
    characterName: fieldString(card, "nameForCommonModel") || fallback,
    baseCharacterName: fieldString(card, "baseCharacterName") || fallback,
    ipName: fieldString(card, "ipName"),
  };
}

export function mu3RareSpriteName(card: CardRecord) {
  switch (mu3RarityKind(card)) {
    case "R":
      return "UI_Card_Rare_01_R";
    case "SR":
      return "UI_Card_Rare_02_SR";
    case "SSR":
      return "UI_Card_Rare_03_SSR";
    case "SRPlus":
      return "UI_Card_Rare_05_SRPlus";
    default:
      return "UI_Card_Rare_00_N";
  }
}

export function mu3SkillAsset(card: CardRecord) {
  switch (fieldString(card, "skillCategory").toLowerCase()) {
    case "attack":
      return "UI_Card_Skill_00_Attack";
    case "dangerattack":
      return "UI_Card_Skill_00_Attack_Danger";
    case "support":
      return "UI_Card_Skill_01_Assist";
    case "dangersupport":
      return "UI_Card_Skill_01_Assist_Danger";
    case "guard":
      return "UI_Card_Skill_02_Guard";
    case "dangerguard":
      return "UI_Card_Skill_02_Guard_Danger";
    case "boost":
      return "UI_Card_Skill_03_Boost";
    case "dangerboost":
      return "UI_Card_Skill_03_Boost_Danger";
    default:
      return "UI_Card_Skill_00_Attack";
  }
}

export function mu3FrameAsset(card: CardRecord, attr: number) {
  const rarity = mu3RarityKind(card);
  if (rarity === "N" || rarity === "R") return `UI_Card_frame_${rarity}_${twoDigits(attr)}`;
  if (rarity === "SR") return `UI_Card_frame_SR_${twoDigits(attr)}`;
  if (rarity === "SRPlus") return "UI_Card_frame_SRPlus_00";
  if (rarity === "SSR") return "UI_Card_frame_SSR_00";
  return "";
}

export function mu3HoloFrameBaseAsset(card: CardRecord) {
  switch (mu3RarityKind(card)) {
    case "N":
      return "UI_Card_Horo_Frame_N_00";
    case "R":
      return "UI_Card_Horo_Frame_R_00";
    case "SR":
    case "SRPlus":
      return "UI_Card_Horo_Frame_SR_00";
    default:
      return "";
  }
}

export function mu3HoloFrameOverlayAsset(card: CardRecord) {
  switch (mu3RarityKind(card)) {
    case "SR":
    case "SRPlus":
      return "UI_Card_Horo_Frame_SR_01";
    case "SSR":
      return "UI_Card_Horo_Frame_SSR_00";
    default:
      return "";
  }
}

export function mu3HoloBgAsset(card: CardRecord) {
  switch (mu3RarityKind(card)) {
    case "N":
      return "UI_Card_Horo_BG_N_00";
    case "R":
      return "UI_Card_Horo_BG_R_00";
    case "SR":
    case "SRPlus":
      return "UI_Card_Horo_BG_SR_00";
    case "SSR":
      return "UI_Card_Horo_BG_SSR_00";
    default:
      return "";
  }
}

export function mu3ShowMainFrame(card: CardRecord) {
  return !fieldBool(card, "hideFrame");
}

export function mu3AttributeName(attr: number) {
  return ["Red", "Bule", "Green"][attr] ?? "Red";
}

export function fieldNumber(card: CardRecord, key: string, fallback: number) {
  const value = Number(fieldString(card, key));
  return Number.isFinite(value) ? value : fallback;
}

export function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function twoDigits(value: number) {
  return String(value).padStart(2, "0");
}
