import assert from "node:assert/strict";
import test from "node:test";
import { importTypeScriptModuleGraph } from "./helpers/import-typescript.mjs";

const {
  calcCounterFigures,
  counterFigureBackgroundPosition,
  counterFigureHeight,
  counterFigureWidth,
} = await importTypeScriptModuleGraph("src/layers/digitCounter.tsx");

test("sprite counters normalize invalid and fractional values", () => {
  assert.deepEqual(calcCounterFigures("", 0), [0]);
  assert.deepEqual(calcCounterFigures("not-a-number", 0), [0]);
  assert.deepEqual(calcCounterFigures("1.9", 0), [1]);
  assert.deepEqual(calcCounterFigures("-12.9", 0), [12, 1, 2]);
});

test("sprite counters retain plus, zero suppression, and comma flags", () => {
  assert.deepEqual(calcCounterFigures("12", 1), [10, 1, 2]);
  assert.deepEqual(calcCounterFigures("0", 1), [10, 0]);
  assert.deepEqual(calcCounterFigures("0", 1 | 128), [0]);
  assert.deepEqual(calcCounterFigures("1234567", 2), [1, 11, 2, 3, 4, 11, 5, 6, 7]);
});

test("sign and comma figures retain their authored dimensions", () => {
  for (let figure = 0; figure <= 12; figure += 1) {
    const isSign = figure === 10 || figure === 11 || figure === 12;
    assert.equal(counterFigureWidth(figure, 41, 50), isSign ? 50 : 41);
    assert.equal(counterFigureHeight(figure, 42, 51), isSign ? 51 : 42);
  }
});

test("sprite figures retain their 4 by 4 background positions", () => {
  assert.deepEqual(
    Array.from({ length: 13 }, (_, figure) => counterFigureBackgroundPosition(figure)),
    [
      "0% 0%",
      "33.33333333333333% 0%",
      "66.66666666666666% 0%",
      "100% 0%",
      "0% 33.33333333333333%",
      "33.33333333333333% 33.33333333333333%",
      "66.66666666666666% 33.33333333333333%",
      "100% 33.33333333333333%",
      "0% 66.66666666666666%",
      "33.33333333333333% 66.66666666666666%",
      "66.66666666666666% 66.66666666666666%",
      "33.33333333333333% 100%",
      "100% 66.66666666666666%",
    ],
  );
});
