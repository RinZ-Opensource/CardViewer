import type { Game } from "./config.ts";

/**
 * Current upstream files are below 3 MiB. The 8 MiB ceiling leaves room for
 * growth while bounding the stream buffer, decoded string and parsed graph.
 */
const MAX_DATA_BYTES = 8 * 1024 * 1024;

/** GitHub Raw varies these MIME types by repository object. */
const DATA_CONTENT_TYPES = new Set([
  "application/json",
  "application/octet-stream",
  "text/json",
  "text/plain",
]);

const REQUIRED_DATA_FIELDS: Record<Game, readonly string[]> = {
  maimai: ["sort", "title", "image_url"],
  chunithm: ["id", "title", "image"],
  ongeki: ["id", "title", "image_url"],
};

/**
 * Deliberately below the current 1k+ populations, but high enough that a
 * valid-looking truncated response cannot replace a complete catalog.
 */
const MIN_DATA_ROWS: Record<Game, number> = {
  maimai: 1_000,
  chunithm: 1_000,
  ongeki: 700,
};

export interface ValidatedData {
  bytes: Uint8Array;
  rowCount: number;
}

function assertDataContentType(response: Response): void {
  const rawContentType = response.headers.get("content-type");
  const contentType = rawContentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (!contentType || !DATA_CONTENT_TYPES.has(contentType)) {
    throw new Error(`unexpected origin content-type ${contentType || "(missing)"}`);
  }
}

function assertDeclaredDataSize(response: Response): void {
  const rawLength = response.headers.get("content-length");
  if (rawLength === null) return;
  if (!/^\d+$/.test(rawLength)) throw new Error("invalid origin content-length");
  const length = Number(rawLength);
  if (!Number.isSafeInteger(length)) throw new Error("invalid origin content-length");
  if (length > MAX_DATA_BYTES) {
    throw new Error(`origin body exceeds ${MAX_DATA_BYTES} bytes`);
  }
}

/** Buffer an upstream body only after applying declared and streamed limits. */
async function readDataBytes(response: Response): Promise<Uint8Array> {
  assertDataContentType(response);
  assertDeclaredDataSize(response);
  if (!response.body) throw new Error("origin body is empty");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_DATA_BYTES) {
        try {
          await reader.cancel("song metadata exceeded the size limit");
        } catch {
          // Preserve the stable size error even if stream cancellation fails.
        }
        throw new Error(`origin body exceeds ${MAX_DATA_BYTES} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Reject a syntactically valid replacement that the browser cannot consume. */
function validateData(game: Game, bytes: Uint8Array): number {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new Error("origin body is not valid UTF-8");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("origin body is not valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("origin JSON must be a non-empty top-level array");
  }

  const requiredFields = REQUIRED_DATA_FIELDS[game];
  const invalidIndex = parsed.findIndex(
    (entry) =>
      !isRecord(entry) ||
      Object.values(entry).some((value) => typeof value !== "string") ||
      requiredFields.some((field) => typeof entry[field] !== "string" || entry[field].length === 0),
  );
  if (invalidIndex !== -1) {
    throw new Error(`origin JSON has an invalid ${game} record at index ${invalidIndex}`);
  }
  if (parsed.length < MIN_DATA_ROWS[game]) {
    throw new Error(
      `origin JSON has ${parsed.length} ${game} records; expected at least ${MIN_DATA_ROWS[game]}`,
    );
  }
  return parsed.length;
}

export async function readValidatedData(game: Game, response: Response): Promise<ValidatedData> {
  const bytes = await readDataBytes(response);
  return { bytes, rowCount: validateData(game, bytes) };
}
