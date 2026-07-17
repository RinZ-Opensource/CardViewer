export function formatDisplaySerial(serialId: string) {
  const raw = serialId.replace(/[\s-]/g, "");
  if (!raw) return "";
  const paddedLength = (raw.length + 3) & -4;
  let count = 0;
  let display = "";
  for (let index = raw.length; index < paddedLength; index += 1) {
    display += " ";
    count += 1;
  }
  for (const char of raw) {
    display += char;
    count += 1;
    if ((count & 3) === 0) display += " ";
  }
  return display;
}
