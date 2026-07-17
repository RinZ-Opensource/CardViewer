import type { JsonRecord } from "./validation";
import { array, invalid, record } from "./validation";

export type SongDbRawEntry = Record<string, string | undefined>;
export type SongDbGameName = "maimai" | "chunithm" | "ongeki";

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
