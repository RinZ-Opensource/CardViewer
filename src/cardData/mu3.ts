import { MU3_LEVEL_LIMITS } from "../constants";
import type { CardRecord } from "../types";
import {
  clampInt,
  fieldBool,
  fieldEdited,
  fieldString,
  numericField,
  twoDigits,
} from "./fields";

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

// Title-block names are shared by the visual card and the holo mask:
// characterName is the common-model name, baseCharacterName the non-common or asset-card name.
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
