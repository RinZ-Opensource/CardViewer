import type { CardRecord, QrSource } from "../types";
import { fieldString, numericField, numericText } from "./fields";

const MAI_QR_GAME_ID = 5915972;
const MU3_QR_GAME_ID = 5522500;
const MAI_QR_RC4_KEY = [144, 95, 51, 167, 195, 243, 253, 226, 84, 194, 239, 80, 177, 205, 41, 78];
const MU3_QR_RC4_KEY = [38, 34, 177, 150, 54, 114, 151, 245, 80, 162, 229, 42, 75, 224, 55, 156];

export function qrSource(card: CardRecord, fallback: string): QrSource {
  const override = fieldString(card, "qrPayload");
  if (override) return override;

  const bytes = card.game === "MAI" ? maiQrBytes(card) : card.game === "MU3" ? mu3QrBytes(card) : null;
  if (bytes) {
    return [{ data: new Uint8ClampedArray(bytes), mode: "byte" }];
  }

  return [card.game, card.dataName, fieldString(card, "serialId"), fallback].filter(Boolean).join("|");
}

export function maiQrBytes(card: CardRecord) {
  const cardId = numericField(card, "cardId", numericText(card.id, Number.NaN));
  const charaId = numericField(card, "charaId", 0);
  if (!Number.isFinite(cardId) || !Number.isFinite(charaId)) return null;
  const bytes = createQrBytes(cardId, charaId, MAI_QR_GAME_ID);
  return rc4(bytes, MAI_QR_RC4_KEY);
}

export function mu3QrBytes(card: CardRecord) {
  const cardId = numericField(
    card,
    "cardId",
    numericText(fieldString(card, "cardNo") || card.id || card.dataName, Number.NaN),
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
  for (let index = 0; index < output.length; index += 1) {
    i = (i + 1) & 0xff;
    j = (j + state[i]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
    output[index] ^= state[(state[i] + state[j]) & 0xff];
  }
  return output;
}
