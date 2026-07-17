/** Build the exact CSS font descriptions that a canvas draw will use. */
export function canvasFontLoadDescriptors(
  fontFamily: string,
  fontSize: number,
  fontWeight: number,
): string[] {
  return fontFamily
    .split(",")
    .map((family) => family.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((family) => `${fontWeight} ${fontSize}px ${family}`);
}
