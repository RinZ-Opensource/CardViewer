import assert from "node:assert/strict";
import test from "node:test";
import { importTypeScriptModule } from "./helpers/import-typescript.mjs";

const { sanitizeDecimal, sanitizeDigits, sanitizeLevel } = await importTypeScriptModule(
  "src/scorecard/scorecardInput.ts",
);

test("sanitizeDigits normalizes full-width input, removes non-digits, and limits length", () => {
  assert.equal(sanitizeDigits("１２a３４", 3), "123");
  assert.equal(sanitizeDigits("123456", 4), "1234");
  assert.equal(sanitizeDigits("abc", 5, 100), "");
  assert.equal(sanitizeDigits("", 5, 100), "");
});

test("sanitizeDigits clamps values without rewriting valid leading zeroes", () => {
  assert.equal(sanitizeDigits("999", 3, 120), "120");
  assert.equal(sanitizeDigits("001", 3, 120), "001");
});

test("sanitizeLevel keeps at most two digits and an entered plus suffix", () => {
  assert.equal(sanitizeLevel("１３＋"), "13+");
  assert.equal(sanitizeLevel("123+"), "12+");
  assert.equal(sanitizeLevel("level 9"), "9");
  assert.equal(sanitizeLevel("+"), "");
});

test("sanitizeDecimal accepts full-width and comma decimal input", () => {
  assert.equal(sanitizeDecimal("１００，９９５０", 3, 4), "100.9950");
  assert.equal(sanitizeDecimal("12,5", 3, 2), "12.5");
});

test("sanitizeDecimal uses the last separator and strips grouping separators", () => {
  assert.equal(sanitizeDecimal("1,234.56", 4, 2), "1234.56");
  assert.equal(sanitizeDecimal("1.234,56", 4, 2), "1234.56");
  assert.equal(sanitizeDecimal("1,234", 4, 2), "1234");
  assert.equal(sanitizeDecimal("1,234", 3, 4), "1.234");
});

test("sanitizeDecimal limits both sides while preserving partial decimal input", () => {
  assert.equal(sanitizeDecimal("12345.6789", 3, 2), "123.67");
  assert.equal(sanitizeDecimal("12.", 3, 2), "12.");
});
