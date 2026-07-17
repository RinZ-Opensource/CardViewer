import type {
  OnlineManifestIndex,
  OnlineManifestShard,
  ScanResult,
  ScanStats,
  TmpFontMetrics,
  UnityFontMetrics,
} from "./types";

export type SongDbRawEntry = Record<string, string | undefined>;
export type SongDbGameName = "maimai" | "chunithm" | "ongeki";

type JsonRecord = Record<string, unknown>;

function invalid(source: string, path: string, expected: string): never {
  throw new Error(`Invalid ${source} at ${path}: expected ${expected}`);
}

function record(value: unknown, source: string, path: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid(source, path, "an object");
  }
  return value as JsonRecord;
}

function array(value: unknown, source: string, path: string): unknown[] {
  if (!Array.isArray(value)) return invalid(source, path, "an array");
  return value;
}

function string(value: unknown, source: string, path: string, allowEmpty = true): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    return invalid(source, path, allowEmpty ? "a string" : "a non-empty string");
  }
  return value;
}

function finiteNumber(value: unknown, source: string, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return invalid(source, path, "a finite number");
  }
  return value;
}

function nonNegativeInteger(value: unknown, source: string, path: string): number {
  const parsed = finiteNumber(value, source, path);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return invalid(source, path, "a non-negative integer");
  }
  return parsed;
}

function positiveInteger(value: unknown, source: string, path: string): number {
  const parsed = finiteNumber(value, source, path);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return invalid(source, path, "a positive integer");
  }
  return parsed;
}

function stringArray(value: unknown, source: string, path: string): string[] {
  return array(value, source, path).map((entry, index) =>
    string(entry, source, `${path}[${index}]`),
  );
}

function numberTuple4(
  value: unknown,
  source: string,
  path: string,
): [number, number, number, number] {
  const values = array(value, source, path);
  if (values.length !== 4) invalid(source, path, "an array of four finite numbers");
  return values.map((entry, index) => finiteNumber(entry, source, `${path}[${index}]`)) as [
    number,
    number,
    number,
    number,
  ];
}

function safeAtlasFile(value: unknown, source: string, path: string): string {
  const file = string(value, source, path, false);
  if (!/^[A-Za-z0-9_.-]+\.(?:png|webp)$/i.test(file)) {
    invalid(source, path, "a local PNG or WebP filename");
  }
  return file;
}

/** Validate a Unity bitmap-font catalog before render code trusts its metrics. */
export function parseUnityFontMetrics(
  value: unknown,
  source = "Unity font metrics",
): UnityFontMetrics {
  const metrics = record(value, source, "$");
  string(metrics.name, source, "$.name", false);
  const lineSpacing = finiteNumber(metrics.lineSpacing, source, "$.lineSpacing");
  if (lineSpacing <= 0) invalid(source, "$.lineSpacing", "a positive finite number");
  finiteNumber(metrics.characterSpacing, source, "$.characterSpacing");
  safeAtlasFile(metrics.texture, source, "$.texture");
  positiveInteger(metrics.width, source, "$.width");
  positiveInteger(metrics.height, source, "$.height");

  const chars = record(metrics.chars, source, "$.chars");
  const glyphs = Object.entries(chars);
  if (glyphs.length === 0) invalid(source, "$.chars", "at least one glyph");
  for (const [codepoint, rawGlyph] of glyphs) {
    const path = `$.chars[${JSON.stringify(codepoint)}]`;
    if (!/^\d+$/.test(codepoint)) invalid(source, path, "a numeric codepoint key");
    const glyph = record(rawGlyph, source, path);
    const index = nonNegativeInteger(glyph.index, source, `${path}.index`);
    if (index !== Number(codepoint)) invalid(source, `${path}.index`, `codepoint ${codepoint}`);
    const uv = numberTuple4(glyph.uv, source, `${path}.uv`);
    if (uv.some((coordinate) => coordinate < 0 || coordinate > 1)) {
      invalid(source, `${path}.uv`, "normalized coordinates between 0 and 1");
    }
    numberTuple4(glyph.vert, source, `${path}.vert`);
    finiteNumber(glyph.advance, source, `${path}.advance`);
  }

  return metrics as UnityFontMetrics;
}

/** Validate a TextMeshPro bitmap-font catalog before canvas rendering. */
export function parseTmpFontMetrics(
  value: unknown,
  source = "TMP font metrics",
): TmpFontMetrics {
  const metrics = record(value, source, "$");
  string(metrics.name, source, "$.name", false);
  safeAtlasFile(metrics.texture, source, "$.texture");
  positiveInteger(metrics.width, source, "$.width");
  positiveInteger(metrics.height, source, "$.height");

  const fontInfo = record(metrics.fontInfo, source, "$.fontInfo");
  for (const key of ["PointSize", "LineHeight"] as const) {
    const number = finiteNumber(fontInfo[key], source, `$.fontInfo.${key}`);
    if (number <= 0) invalid(source, `$.fontInfo.${key}`, "a positive finite number");
  }
  finiteNumber(fontInfo.Ascender, source, "$.fontInfo.Ascender");
  finiteNumber(fontInfo.Descender, source, "$.fontInfo.Descender");
  const padding = finiteNumber(fontInfo.Padding, source, "$.fontInfo.Padding");
  if (padding < 0) invalid(source, "$.fontInfo.Padding", "a non-negative finite number");

  const glyphs = record(metrics.glyphs, source, "$.glyphs");
  const entries = Object.entries(glyphs);
  if (entries.length === 0) invalid(source, "$.glyphs", "at least one glyph");
  for (const [codepoint, rawGlyph] of entries) {
    const path = `$.glyphs[${JSON.stringify(codepoint)}]`;
    if (!/^\d+$/.test(codepoint)) invalid(source, path, "a numeric codepoint key");
    const glyph = record(rawGlyph, source, path);
    const id = nonNegativeInteger(glyph.id, source, `${path}.id`);
    if (id !== Number(codepoint)) invalid(source, `${path}.id`, `codepoint ${codepoint}`);
    for (const key of [
      "x",
      "y",
      "width",
      "height",
      "xOffset",
      "yOffset",
      "xAdvance",
      "scale",
    ] as const) {
      finiteNumber(glyph[key], source, `${path}.${key}`);
    }
    if (Number(glyph.width) < 0 || Number(glyph.height) < 0) {
      invalid(source, path, "non-negative glyph dimensions");
    }
    if (Number(glyph.scale) <= 0) invalid(source, `${path}.scale`, "a positive finite number");
  }

  return metrics as TmpFontMetrics;
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

const SONG_DB_REQUIRED_FIELDS: Record<SongDbGameName, readonly string[]> = {
  maimai: ["title", "image_url", "sort"],
  chunithm: ["title", "image", "id"],
  ongeki: ["title", "image_url", "id"],
};

/** Validate the flat otoge-db envelope without an expensive domain-field parse. */
export function parseSongDbEntries(
  value: unknown,
  game: SongDbGameName,
  source = `songdb ${game}`,
): SongDbRawEntry[] {
  const rows = array(value, source, "$");
  if (rows.length === 0) invalid(source, "$", "a non-empty song array");
  for (const [rowIndex, rawRow] of rows.entries()) {
    const path = `$[${rowIndex}]`;
    const row = record(rawRow, source, path);
    for (const [key, field] of Object.entries(row)) {
      if (typeof field !== "string") {
        invalid(source, `${path}[${JSON.stringify(key)}]`, "a string");
      }
    }
  }

  const required = SONG_DB_REQUIRED_FIELDS[game];
  const hasUsableRow = rows.some((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    const candidate = row as JsonRecord;
    return required.every(
      (field) => typeof candidate[field] === "string" && candidate[field].length > 0,
    );
  });
  if (!hasUsableRow) {
    invalid(source, "$", `at least one row with non-empty ${required.join(", ")}`);
  }
  return rows as SongDbRawEntry[];
}
