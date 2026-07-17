import type {
  OnlineManifestIndex,
  OnlineManifestShard,
  ScanResult,
  ScanStats,
} from "../types";
import {
  type JsonRecord,
  array,
  finiteNumber,
  invalid,
  nonNegativeInteger,
  record,
  string,
} from "./validation";

function stringArray(value: unknown, source: string, path: string): string[] {
  return array(value, source, path).map((entry, index) =>
    string(entry, source, `${path}[${index}]`),
  );
}

const STAT_KEYS = [
  "chuCards",
  "maiCards",
  "maiCardTypes",
  "maiCardCharas",
  "mu3AssetCards",
  "mu3XmlRecords",
  "pngAssets",
  "unityBundles",
  "unityBundleBytes",
] as const satisfies readonly (keyof ScanStats)[];

function validateStats(value: unknown, source: string, path: string): void {
  const stats = record(value, source, path);
  for (const key of STAT_KEYS) nonNegativeInteger(stats[key], source, `${path}.${key}`);
}

function validateCardRecord(value: unknown, source: string, path: string): void {
  const card = record(value, source, path);
  string(card.id, source, `${path}.id`, false);
  if (card.game !== "CHU" && card.game !== "MAI" && card.game !== "MU3") {
    invalid(source, `${path}.game`, 'one of "CHU", "MAI", or "MU3"');
  }
  for (const key of [
    "recordType",
    "dataName",
    "displayName",
    "characterName",
    "skillName",
    "skillText",
  ] as const) {
    string(card[key], source, `${path}.${key}`);
  }
  for (const key of ["rareType", "labelType", "difType", "miss", "combo", "chain"] as const) {
    if (card[key] !== null) finiteNumber(card[key], source, `${path}.${key}`);
  }
  for (const key of ["imagePath", "thumbnailPath"] as const) {
    if (card[key] !== null) string(card[key], source, `${path}.${key}`);
  }
  if (card.sourceXml !== undefined) string(card.sourceXml, source, `${path}.sourceXml`);

  for (const [index, rawLayer] of array(
    card.assetLayers,
    source,
    `${path}.assetLayers`,
  ).entries()) {
    const layerPath = `${path}.assetLayers[${index}]`;
    const layer = record(rawLayer, source, layerPath);
    string(layer.key, source, `${layerPath}.key`);
    string(layer.label, source, `${layerPath}.label`);
    string(layer.path, source, `${layerPath}.path`, false);
  }
  stringArray(card.editableFields, source, `${path}.editableFields`);
  if (card.editedPrintFields !== undefined) {
    stringArray(card.editedPrintFields, source, `${path}.editedPrintFields`);
  }
  for (const [index, rawField] of array(
    card.printFields,
    source,
    `${path}.printFields`,
  ).entries()) {
    const fieldPath = `${path}.printFields[${index}]`;
    const field = record(rawField, source, fieldPath);
    string(field.key, source, `${fieldPath}.key`);
    string(field.label, source, `${fieldPath}.label`);
    if (
      field.fieldType !== "text" &&
      field.fieldType !== "multiline" &&
      field.fieldType !== "number" &&
      field.fieldType !== "bool" &&
      field.fieldType !== "select" &&
      field.fieldType !== "metadata"
    ) {
      invalid(source, `${fieldPath}.fieldType`, "a supported print field type");
    }
    string(field.value, source, `${fieldPath}.value`);
    if (field.options !== undefined) {
      for (const [optionIndex, rawOption] of array(
        field.options,
        source,
        `${fieldPath}.options`,
      ).entries()) {
        const optionPath = `${fieldPath}.options[${optionIndex}]`;
        const option = record(rawOption, source, optionPath);
        string(option.value, source, `${optionPath}.value`);
        string(option.label, source, `${optionPath}.label`);
      }
    }
  }
}

function validateCards(value: unknown, source: string, path: string): void {
  for (const [index, card] of array(value, source, path).entries()) {
    validateCardRecord(card, source, `${path}[${index}]`);
  }
}

function validateManifestBase(value: JsonRecord, source: string): void {
  string(value.packageRoot, source, "$.packageRoot");
  string(value.streamingAssets, source, "$.streamingAssets");
  validateStats(value.stats, source, "$.stats");
  stringArray(value.warnings, source, "$.warnings");
}

export function parseOnlineManifestIndex(
  value: unknown,
  source = "manifest index",
): OnlineManifestIndex {
  const index = record(value, source, "$");
  validateManifestBase(index, source);
  nonNegativeInteger(index.totalCards, source, "$.totalCards");
  for (const [position, rawShard] of array(index.shards, source, "$.shards").entries()) {
    const path = `$.shards[${position}]`;
    const shard = record(rawShard, source, path);
    string(shard.key, source, `${path}.key`, false);
    string(shard.game, source, `${path}.game`, false);
    string(shard.href, source, `${path}.href`, false);
    nonNegativeInteger(shard.cardCount, source, `${path}.cardCount`);
  }
  return index as OnlineManifestIndex;
}

export function parseOnlineManifestShard(
  value: unknown,
  source = "manifest shard",
): OnlineManifestShard {
  const shard = record(value, source, "$");
  string(shard.key, source, "$.key", false);
  string(shard.game, source, "$.game", false);
  validateCards(shard.cards, source, "$.cards");
  return shard as OnlineManifestShard;
}

export function parseScanResult(value: unknown, source = "legacy manifest"): ScanResult {
  const result = record(value, source, "$");
  validateManifestBase(result, source);
  validateCards(result.cards, source, "$.cards");
  return result as ScanResult;
}
