interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredRecordOptions {
  allowedValues?: Readonly<Record<string, readonly unknown[]>>;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesDefaultType(value: unknown, defaultValue: unknown): boolean {
  if (typeof value !== typeof defaultValue) return false;
  return typeof value !== "number" || Number.isFinite(value);
}

/** Best-effort localStorage read. Browsers may deny access even when the API exists. */
export function readLocalStorage(
  key: string,
  storage: StorageLike | null = browserStorage(),
): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Best-effort localStorage write. Returns false for denied/quota-exceeded writes. */
export function writeLocalStorage(
  key: string,
  value: string,
  storage: StorageLike | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Serializes and stores JSON without allowing either operation to escape as an exception. */
export function writeLocalStorageJson(
  key: string,
  value: unknown,
  storage: StorageLike | null = browserStorage(),
): boolean {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? false : writeLocalStorage(key, serialized, storage);
  } catch {
    return false;
  }
}

/**
 * Parses a flat persisted state against its current defaults.
 *
 * Unknown fields and fields whose primitive type changed are discarded. Enum-like
 * fields can additionally provide an allowlist. This keeps older compatible state
 * while preventing valid-but-malformed JSON from reaching render code.
 */
export function parseStoredRecord<State extends object>(
  raw: string | null,
  fallback: () => State,
  options: StoredRecordOptions = {},
): State {
  const defaults = fallback();
  if (!raw) return defaults;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (!isRecord(parsed)) return defaults;

  const defaultRecord = defaults as Record<string, unknown>;
  const next = { ...defaultRecord };
  for (const key of Object.keys(defaultRecord)) {
    if (!Object.hasOwn(parsed, key)) continue;
    const value = parsed[key];
    if (!matchesDefaultType(value, defaultRecord[key])) continue;
    const allowed = options.allowedValues?.[key];
    if (allowed && !allowed.includes(value)) continue;
    next[key] = value;
  }
  return next as State;
}

export function loadStoredRecord<State extends object>(
  key: string,
  fallback: () => State,
  options: StoredRecordOptions = {},
  storage: StorageLike | null = browserStorage(),
): State {
  return parseStoredRecord(readLocalStorage(key, storage), fallback, options);
}
