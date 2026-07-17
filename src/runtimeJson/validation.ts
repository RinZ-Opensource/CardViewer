export type JsonRecord = Record<string, unknown>;

export function invalid(source: string, path: string, expected: string): never {
  throw new Error(`Invalid ${source} at ${path}: expected ${expected}`);
}

export function record(value: unknown, source: string, path: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid(source, path, "an object");
  }
  return value as JsonRecord;
}

export function array(value: unknown, source: string, path: string): unknown[] {
  if (!Array.isArray(value)) return invalid(source, path, "an array");
  return value;
}

export function string(value: unknown, source: string, path: string, allowEmpty = true): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    return invalid(source, path, allowEmpty ? "a string" : "a non-empty string");
  }
  return value;
}

export function finiteNumber(value: unknown, source: string, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return invalid(source, path, "a finite number");
  }
  return value;
}

export function nonNegativeInteger(value: unknown, source: string, path: string): number {
  const parsed = finiteNumber(value, source, path);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return invalid(source, path, "a non-negative integer");
  }
  return parsed;
}
