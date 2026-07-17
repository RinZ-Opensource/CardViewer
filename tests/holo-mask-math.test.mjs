import assert from "node:assert/strict";
import test from "node:test";
import { importTypeScriptModule } from "./helpers/import-typescript.mjs";

const {
  FRONT_MASK_DILATION,
  binarizeRenderedPixels,
  dilateBinaryMask,
  normalizeMaskData,
  paintBinaryMask,
} = await importTypeScriptModule("src/holoMaskMath.ts");

function grayscalePixels(values, alphas = values.map(() => 255)) {
  const data = new Uint8ClampedArray(values.length * 4);
  values.forEach((value, pixel) => {
    const index = pixel * 4;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = alphas[pixel];
  });
  return data;
}

test("binarizeRenderedPixels treats any non-zero RGBA channel as active", () => {
  const imageData = {
    width: 4,
    height: 1,
    data: new Uint8ClampedArray([
      0, 0, 0, 0,
      1, 0, 0, 0,
      0, 2, 0, 0,
      0, 0, 0, 3,
    ]),
  };

  assert.deepEqual([...binarizeRenderedPixels(imageData)], [0, 255, 255, 255]);
});

test("paintBinaryMask writes white RGB with binary alpha", () => {
  const imageData = { data: new Uint8ClampedArray(8) };

  paintBinaryMask(imageData, new Uint8ClampedArray([0, 1]));

  assert.deepEqual(
    [...imageData.data],
    [255, 255, 255, 0, 255, 255, 255, 255],
  );
});

test("dilateBinaryMask keeps the zero-iteration input reference", () => {
  const input = new Uint8ClampedArray([0, 0, 0, 0, 255, 0, 0, 0, 0]);

  const output = dilateBinaryMask(input, 3, 3, 0);

  assert.equal(output, input);
  assert.deepEqual([...input], [0, 0, 0, 0, 255, 0, 0, 0, 0]);
  assert.equal(FRONT_MASK_DILATION, 7);
});

test("dilateBinaryMask one pass produces the current empty-center ring", () => {
  const input = new Uint8ClampedArray([0, 0, 0, 0, 255, 0, 0, 0, 0]);

  const output = dilateBinaryMask(input, 3, 3, 1);

  assert.notEqual(output, input);
  assert.deepEqual([...output], [255, 255, 255, 255, 0, 255, 255, 255, 255]);
  assert.deepEqual([...input], [0, 0, 0, 0, 255, 0, 0, 0, 0]);
});

test("dilateBinaryMask one pass preserves the current top-left edge behavior", () => {
  const input = new Uint8ClampedArray([255, 0, 0, 0, 0, 0, 0, 0, 0]);

  const output = dilateBinaryMask(input, 3, 3, 1);

  assert.deepEqual([...output], [255, 255, 0, 255, 255, 0, 0, 0, 0]);
});

test("dilateBinaryMask two passes reuse and write back the input buffer", () => {
  const input = new Uint8ClampedArray([0, 0, 0, 0, 255, 0, 0, 0, 0]);

  const output = dilateBinaryMask(input, 3, 3, 2);

  assert.equal(output, input);
  assert.deepEqual([...input], [255, 255, 255, 255, 255, 255, 255, 255, 255]);
});

test("normalizeMaskData preserves raw pixels and copies alpha in alpha mode", () => {
  const raw = new Uint8ClampedArray([10, 20, 30, 40]);
  normalizeMaskData(raw, "raw");
  assert.deepEqual([...raw], [10, 20, 30, 40]);

  const alpha = new Uint8ClampedArray([10, 20, 30, 40, 50, 60, 70, 80]);
  normalizeMaskData(alpha, "alpha");
  assert.deepEqual([...alpha], [40, 40, 40, 40, 80, 80, 80, 80]);
});

test("normalizeMaskData alpha mode preserves alpha at the red-mode epsilon", () => {
  const data = new Uint8ClampedArray([10, 20, 30, 8]);

  normalizeMaskData(data, "alpha");

  assert.deepEqual([...data], [8, 8, 8, 8]);
});

test("normalizeMaskData red mode applies both red and alpha thresholds", () => {
  const data = new Uint8ClampedArray([
    128, 0, 0, 9,
    127, 0, 0, 255,
    255, 0, 0, 8,
  ]);

  normalizeMaskData(data, "red");

  assert.deepEqual(
    [...data],
    [255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0],
  );
});

test("normalizeMaskData applies the light luminance ramp when coverage qualifies", () => {
  const data = grayscalePixels([
    ...Array(50).fill(0),
    ...Array(50).fill(224),
  ]);

  normalizeMaskData(data, "light-or-alpha");

  assert.equal(data[3], 0);
  assert.equal(data[50 * 4 + 3], 255);
});

test("normalizeMaskData keeps the light ramp midpoint and clamped-array rounding", () => {
  const data = grayscalePixels([0, 128]);

  normalizeMaskData(data, "light-or-alpha");

  assert.equal(data[3], 0);
  assert.equal(data[7], 133);
});

test("normalizeMaskData applies the bright-only branch at full light coverage", () => {
  const data = grayscalePixels(Array(100).fill(255));

  normalizeMaskData(data, "light-or-alpha");

  assert.equal(data[3], 0);
  assert.equal(data[99 * 4 + 3], 0);
});

test("normalizeMaskData prefers the dark ramp in dark-or-alpha mode", () => {
  const data = grayscalePixels([
    ...Array(50).fill(0),
    ...Array(50).fill(255),
  ]);

  normalizeMaskData(data, "dark-or-alpha");

  assert.equal(data[3], 255);
  assert.equal(data[50 * 4 + 3], 0);
});

test("normalizeMaskData uses the 0.42 dark coverage gate", () => {
  const data = grayscalePixels([0, 255, 0], [255, 255, 0]);

  normalizeMaskData(data, "dark-or-alpha");

  assert.deepEqual(
    [...data],
    [255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0],
  );
});

test("normalizeMaskData light coverage gate enables luminance and otherwise falls back", () => {
  const keyed = grayscalePixels([0, 255, 0, 255]);
  const fallback = grayscalePixels([0, 255, 0, 255], [255, 255, 0, 0]);

  normalizeMaskData(keyed, "light-or-alpha");
  normalizeMaskData(fallback, "light-or-alpha");

  assert.deepEqual(
    [...keyed],
    [0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255],
  );
  assert.deepEqual(
    [...fallback],
    [255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0],
  );
});

test("normalizeMaskData falls back to alpha for sparse keyed inputs", () => {
  const data = grayscalePixels([255, 0, 0, 0], [255, 0, 0, 0]);

  normalizeMaskData(data, "light-or-alpha");

  assert.deepEqual(
    [...data],
    [255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  );
  assert.doesNotThrow(() =>
    normalizeMaskData(new Uint8ClampedArray(), "dark-or-alpha"),
  );
});
