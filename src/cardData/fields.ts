import type { CardRecord } from "../types";

export function fieldString(card: CardRecord, key: string) {
  return card.printFields.find((field) => field.key === key)?.value.trim() ?? "";
}

export function fieldEdited(card: CardRecord, key: string) {
  return card.editedPrintFields?.includes(key) ?? false;
}

export function fieldBool(card: CardRecord, key: string) {
  return card.printFields.find((field) => field.key === key)?.value === "true";
}

export function fieldNumber(card: CardRecord, key: string, fallback: number) {
  const value = Number(fieldString(card, key));
  return Number.isFinite(value) ? value : fallback;
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

export function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function twoDigits(value: number) {
  return String(value).padStart(2, "0");
}
