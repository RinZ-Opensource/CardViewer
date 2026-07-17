import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { importTypeScriptModuleGraph } from "./helpers/import-typescript.mjs";

const rendering = await importTypeScriptModuleGraph("src/textRendering.ts");

function restoreGlobal(name, descriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    delete globalThis[name];
  }
}

test("canvas backing scale uses the stable SSR default and browser clamps", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    delete globalThis.window;
    assert.equal(rendering.getPixelRatio(), 2);

    for (const [devicePixelRatio, expected] of [
      [0, 1],
      [1.5, 1.5],
      [4, 2.5],
    ]) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: { devicePixelRatio },
      });
      assert.equal(rendering.getPixelRatio(), expected);
    }
  } finally {
    restoreGlobal("window", originalWindow);
  }
});

test("canvas line measurement and drawing preserve character spacing", () => {
  const fills = [];
  const context = {
    measureText: (text) => ({ width: Array.from(text).length * 10 }),
    fillText: (text, x, y) => fills.push([text, x, y]),
  };

  assert.equal(rendering.measureCanvasLine(context, "AB", 0), 20);
  assert.equal(rendering.measureCanvasLine(context, "AB", 2), 22);
  assert.equal(rendering.measureCanvasLine(context, "", 2), 0);

  rendering.drawCanvasLine(context, "AB", 0);
  assert.deepEqual(fills, [["AB", 0, 0]]);
  fills.length = 0;
  rendering.drawCanvasLine(context, "AB", 2);
  assert.deepEqual(fills, [["A", 0, 0], ["B", 12, 0]]);
});

test("canvas orchestration keeps Unity-style center anchoring", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events = [];
  const context = {
    clearRect: (...args) => events.push(["clearRect", ...args]),
    save: () => events.push(["save"]),
    restore: () => events.push(["restore"]),
    scale: (...args) => events.push(["scale", ...args]),
    translate: (...args) => events.push(["translate", ...args]),
    fillText: (...args) => events.push(["fillText", ...args]),
    measureText: (text) => ({ width: Array.from(text).length * 10 }),
  };
  const canvas = { width: 0, height: 0, getContext: () => context };

  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { devicePixelRatio: 1 },
    });
    rendering.renderCanvasText(canvas, "AB", {
      w: 100,
      h: 20,
      fontFamily: "sans-serif",
      fontSize: 10,
      fontWeight: 400,
      alignment: 4,
      color: "#fff",
      lineSpacing: 1,
      fitHorizontal: false,
      characterSpacing: 0,
    });
  } finally {
    restoreGlobal("window", originalWindow);
  }

  assert.deepEqual([canvas.width, canvas.height], [100, 20]);
  assert.ok(events.some((event) => event[0] === "translate" && event[1] === 40 && event[2] === 5));
  assert.ok(events.some((event) => event[0] === "fillText" && event[1] === "AB"));
});

test("clearCanvas and alpha bounds preserve logical pixel coordinates", () => {
  const clears = [];
  rendering.clearCanvas({
    width: 7,
    height: 9,
    getContext: () => ({ clearRect: (...args) => clears.push(args) }),
  });
  assert.deepEqual(clears, [[0, 0, 7, 9]]);

  const transparent = new Uint8ClampedArray(4 * 4 * 4);
  const emptyContext = { getImageData: () => ({ data: transparent }) };
  assert.deepEqual(rendering.canvasAlphaBounds(emptyContext, 4, 4, 2), {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  });

  const pixels = new Uint8ClampedArray(4 * 4 * 4);
  pixels[(1 * 4 + 1) * 4 + 3] = 255;
  pixels[(3 * 4 + 2) * 4 + 3] = 128;
  const context = { getImageData: () => ({ data: pixels }) };
  assert.deepEqual(rendering.canvasAlphaBounds(context, 4, 4, 2), {
    x: 0.5,
    y: 0.5,
    w: 1,
    h: 1.5,
  });
});

function tmpGlyph(id, xAdvance) {
  return {
    id,
    x: 0,
    y: 0,
    width: 8,
    height: 12,
    xOffset: 0,
    yOffset: 10,
    xAdvance,
    scale: 1,
  };
}

function tmpFont(glyphs) {
  return {
    name: "fixture",
    fontInfo: {
      PointSize: 20,
      LineHeight: 24,
      Ascender: 16,
      Descender: -4,
      Padding: 0,
    },
    texture: "fixture.png",
    width: 64,
    height: 64,
    glyphs,
  };
}

test("TMP line measurement handles spacing, surrogate pairs, and fallback advance", () => {
  const font = tmpFont({
    65: tmpGlyph(65, 10),
    128512: tmpGlyph(128512, 20),
  });

  assert.equal(rendering.measureTmpLine(font, "A😀", 20, 2), 32);
  assert.equal(rendering.measureTmpLine(font, "A😀", 10, 2), 16);
  assert.equal(rendering.measureTmpLine(font, "AZ", 20, 2), 22);
});

test("TMP and Unity glyph lookup preserve square then question-mark fallback", () => {
  const exact = tmpGlyph(65, 10);
  const square = tmpGlyph(9633, 11);
  const question = tmpGlyph(63, 12);

  assert.strictEqual(rendering.tmpGlyph(tmpFont({ 65: exact, 9633: square, 63: question }), "A"), exact);
  assert.strictEqual(rendering.tmpGlyph(tmpFont({ 9633: square, 63: question }), "A"), square);
  assert.strictEqual(rendering.tmpGlyph(tmpFont({ 63: question }), "A"), question);
  assert.equal(rendering.tmpGlyph(tmpFont({}), "A"), undefined);

  const unityExact = { index: 65, uv: [0, 0, 1, 1], vert: [0, 0, 1, -1], advance: 1 };
  const unitySquare = { ...unityExact, index: 9633 };
  const unityQuestion = { ...unityExact, index: 63 };
  const unityFont = (chars) => ({
    name: "fixture",
    lineSpacing: 10,
    characterSpacing: 0,
    texture: "fixture.png",
    width: 10,
    height: 10,
    chars,
  });

  assert.strictEqual(rendering.unityGlyph(unityFont({ 65: unityExact, 9633: unitySquare, 63: unityQuestion }), "A"), unityExact);
  assert.strictEqual(rendering.unityGlyph(unityFont({ 9633: unitySquare, 63: unityQuestion }), "A"), unitySquare);
  assert.strictEqual(rendering.unityGlyph(unityFont({ 63: unityQuestion }), "A"), unityQuestion);
  assert.equal(rendering.unityGlyph(unityFont({}), "A"), undefined);
});

test("TMP SDF thresholds and cache budgets remain stable", () => {
  assert.equal(rendering.smoothAlpha(130, 152, 22), 0);
  assert.equal(rendering.smoothAlpha(152, 152, 22), 0.5);
  assert.equal(rendering.smoothAlpha(174, 152, 22), 1);
  assert.equal(rendering.tmpSdfAlpha(152, "face"), 0.5);
  assert.equal(rendering.tmpSdfAlpha(88, "outline"), 0.5);
  assert.equal(rendering.tmpSdfAlpha(74, "underlay"), 0.5);
  assert.equal(rendering.TMP_TEXT_PADDING, 36);
  assert.equal(rendering.TMP_GLYPH_CANVAS_CACHE_MAX, 4096);
  assert.equal(rendering.TMP_GLYPH_CANVAS_CACHE_MAX_BYTES, 128 * 1024 * 1024);
});

function unityFixture() {
  return {
    name: "fixture",
    lineSpacing: 10,
    characterSpacing: 0,
    texture: "fixture.png",
    width: 100,
    height: 50,
    chars: {
      65: {
        index: 65,
        uv: [0.1, 0.2, 0.3, 0.4],
        vert: [2, -8, 6, -10],
        advance: 8,
      },
    },
  };
}

function layoutUnity(overrides = {}) {
  return rendering.layoutUnityTextPixels(
    unityFixture(),
    overrides.text ?? "A",
    10,
    overrides.width ?? 30,
    overrides.height ?? 30,
    overrides.alignment ?? 0,
    overrides.lineSpacing ?? 1,
    "#fff",
    overrides.fitHorizontal ?? false,
    0,
    overrides.horizontalScale ?? 1,
    overrides.glyphOffsetY ?? 0,
    overrides.fixedGlyphTop ?? false,
  );
}

test("Unity nine-grid anchors preserve negative-height bearings and atlas coordinates", () => {
  const expected = [
    [2, 8], [13, 8], [24, 8],
    [2, 18], [13, 18], [24, 18],
    [2, 28], [13, 28], [24, 28],
  ];

  for (let alignment = 0; alignment < 9; alignment += 1) {
    const [glyph] = layoutUnity({ alignment });
    assert.deepEqual([glyph.x, glyph.y], expected[alignment]);
    assert.deepEqual(
      [glyph.width, glyph.height, glyph.sourceX, glyph.sourceY, glyph.sourceW, glyph.sourceH],
      [6, 10, 10, 20, 30, 20],
    );
  }
});

test("Unity layout keeps fixed tops, line spacing, X fit, and scale clamps", () => {
  assert.equal(layoutUnity({ fixedGlyphTop: true, glyphOffsetY: 3 })[0].y, 3);

  const twoLines = layoutUnity({ text: "A\nA", lineSpacing: 1.5 });
  assert.equal(twoLines[1].y - twoLines[0].y, 15);

  const fitted = layoutUnity({ width: 4, fitHorizontal: true })[0];
  assert.equal(fitted.width, 3);
  assert.equal(fitted.height, 10);

  assert.ok(Math.abs(layoutUnity({ horizontalScale: 0.01 })[0].width - 0.6) < 1e-12);
  assert.equal(layoutUnity({ horizontalScale: 10 })[0].width, 12);
});

test("Unity percentage adapter is derived directly from pixel layout", () => {
  const [pixel] = layoutUnity({ alignment: 4 });
  const [percentage] = rendering.layoutUnityText(
    unityFixture(),
    "A",
    10,
    30,
    30,
    4,
    1,
    "#fff",
    false,
    0,
    1,
    0,
    false,
  );

  assert.equal(percentage.key, pixel.key);
  assert.deepEqual(percentage.style, {
    left: `${(pixel.x / 30) * 100}%`,
    top: `${(pixel.y / 30) * 100}%`,
    width: `${(pixel.width / 30) * 100}%`,
    height: `${(pixel.height / 30) * 100}%`,
  });
  assert.deepEqual(
    [percentage.sourceX, percentage.sourceY, percentage.sourceW, percentage.sourceH, percentage.color],
    [pixel.sourceX, pixel.sourceY, pixel.sourceW, pixel.sourceH, pixel.color],
  );
});

test("React text extraction keeps only direct string and number children", () => {
  const children = ["title", 7, null, React.createElement("span", null, "nested")];
  assert.equal(rendering.reactText(children), "title7");
});
