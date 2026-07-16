export function sanitizeDigits(value: string, maxDigits: number, maxValue?: number): string {
  const digits = value.normalize("NFKC").replace(/\D/g, "").slice(0, maxDigits);
  if (digits === "" || maxValue === undefined) return digits;
  return Number.parseInt(digits, 10) > maxValue ? String(maxValue) : digits;
}

export function sanitizeLevel(value: string): string {
  const normalized = value.normalize("NFKC");
  const digits = normalized.replace(/\D/g, "").slice(0, 2);
  return digits !== "" && normalized.includes("+") ? `${digits}+` : digits;
}

export function sanitizeDecimal(value: string, integerDigits: number, fractionDigits: number): string {
  const normalized = value.normalize("NFKC").replace(/[^\d.,]/g, "");
  const lastDot = normalized.lastIndexOf(".");
  const lastComma = normalized.lastIndexOf(",");
  let decimalIndex = lastDot;

  if (lastDot >= 0 && lastComma >= 0) {
    decimalIndex = Math.max(lastDot, lastComma);
  } else if (lastDot < 0 && lastComma >= 0) {
    const trailingDigits = normalized.length - lastComma - 1;
    decimalIndex = trailingDigits <= fractionDigits ? lastComma : -1;
  }

  if (decimalIndex < 0) {
    return normalized.replace(/[.,]/g, "").slice(0, integerDigits);
  }

  const integer = normalized
    .slice(0, decimalIndex)
    .replace(/[.,]/g, "")
    .slice(0, integerDigits);
  const fraction = normalized
    .slice(decimalIndex + 1)
    .replace(/[.,]/g, "")
    .slice(0, fractionDigits);
  return `${integer}.${fraction}`;
}
