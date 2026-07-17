import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { importedModules, normalizeModule } from "./helpers/typescript-imports.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

const boundaries = [
  {
    file: "src/textRendering.ts",
    allowed: [
      "./numeric",
      "./textRendering/shared",
      "./textRendering/canvasText",
      "./textRendering/tmpText",
      "./textRendering/reactText",
      "./textRendering/unityText",
    ],
  },
  { file: "src/textRendering/shared.ts", allowed: [] },
  {
    file: "src/textRendering/canvasText.ts",
    allowed: ["../fontLoading", "./shared"],
  },
  {
    file: "src/textRendering/tmpText.ts",
    allowed: ["../constants", "../lru", "../numeric", "../types", "./shared"],
    typeOnly: ["../types"],
  },
  { file: "src/textRendering/reactText.ts", allowed: ["react"] },
  {
    file: "src/textRendering/unityText.ts",
    allowed: ["react", "../numeric", "../types", "./shared"],
    typeOnly: ["react", "../types"],
  },
];

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(absolute)));
    } else if (/\.tsx?$/i.test(entry.name)) {
      files.push(path.relative(projectRoot, absolute).replaceAll(path.sep, "/"));
    }
  }
  return files;
}

test("every text-rendering module has exactly one declared boundary", async () => {
  const declared = boundaries.map(({ file }) => file);
  assert.equal(new Set(declared).size, declared.length, "boundary entries must be unique");

  const actual = [
    "src/textRendering.ts",
    ...(await collectTypeScriptFiles(path.join(projectRoot, "src/textRendering"))),
  ];
  assert.deepEqual(declared.sort(), actual.sort());
});

for (const boundary of boundaries) {
  test(`${boundary.file} respects its text-rendering boundary`, async () => {
    const source = await readFile(path.join(projectRoot, boundary.file), "utf8");
    const importRecords = importedModules(boundary.file, source);
    const actual = [...new Set(importRecords.map(({ specifier }) => normalizeModule(specifier)))];
    const allowed = [...new Set(boundary.allowed.map(normalizeModule))];

    assert.deepEqual(actual.sort(), allowed.sort());

    for (const typeOnlyModule of boundary.typeOnly ?? []) {
      const normalized = normalizeModule(typeOnlyModule);
      const matches = importRecords.filter(
        ({ specifier }) => normalizeModule(specifier) === normalized,
      );
      assert.equal(matches.length, 1, `${boundary.file} must import ${typeOnlyModule} once`);
      assert.equal(matches[0].typeOnly, true, `${typeOnlyModule} must remain type-only`);
    }
  });
}

test("the stable facade preserves all value and type exports explicitly", async () => {
  const file = "src/textRendering.ts";
  const source = await readFile(path.join(projectRoot, file), "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const values = [];
  const types = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    assert.ok(statement.exportClause, "facade must not use export *");
    assert.ok(ts.isNamedExports(statement.exportClause), "facade exports must be named");
    for (const element of statement.exportClause.elements) {
      (statement.isTypeOnly || element.isTypeOnly ? types : values).push(element.name.text);
    }
  }

  assert.deepEqual(values.sort(), [
    "TMP_GLYPH_CANVAS_CACHE_MAX",
    "TMP_GLYPH_CANVAS_CACHE_MAX_BYTES",
    "TMP_TEXT_PADDING",
    "canvasAlphaBounds",
    "clampNumber",
    "clearCanvas",
    "drawCanvasLine",
    "drawTmpRun",
    "getPixelRatio",
    "layoutUnityText",
    "layoutUnityTextPixels",
    "loadTmpAtlas",
    "measureCanvasLine",
    "measureTmpLine",
    "rasterizeTmpText",
    "reactText",
    "renderCanvasText",
    "renderTmpGlyphCanvas",
    "renderTmpText",
    "smoothAlpha",
    "tmpAtlasCache",
    "tmpGlyph",
    "tmpGlyphCanvasCache",
    "tmpSdfAlpha",
    "unityGlyph",
    "waitForCanvasFont",
  ].sort());
  assert.deepEqual(types.sort(), [
    "RasterizedTextLayer",
    "TmpHorizontalAlign",
    "TmpTextRenderOptions",
    "TmpTextVariant",
    "TmpVerticalAlign",
    "UnityTextGlyphLayout",
  ].sort());
});

test("renderer consumers continue to use only the stable facade", async () => {
  const consumers = new Map([
    ["src/layers/canvasText.tsx", "../textRendering"],
    ["src/layers/unityText.tsx", "../textRendering"],
    ["src/layers/tmpText.tsx", "../textRendering"],
    ["src/holo.tsx", "./textRendering"],
    ["src/holoMaskTypes.ts", "./textRendering"],
    ["src/scorecard/MaiTmpText.tsx", "../textRendering"],
    ["src/scorecard/ScorecardBitmapText.tsx", "../textRendering"],
  ]);

  for (const [file, expected] of consumers) {
    const source = await readFile(path.join(projectRoot, file), "utf8");
    const matches = importedModules(file, source).filter(({ specifier }) =>
      normalizeModule(specifier).includes("textrendering"),
    );
    assert.deepEqual(matches.map(({ specifier }) => specifier), [expected]);
    assert.doesNotMatch(source, /(?:\.\.\/|\.\/)textRendering\//);
    if (file === "src/holoMaskTypes.ts") {
      assert.equal(matches[0].typeOnly, true, "holo mask contract must remain type-only");
    }
  }
});

test("frontend modules cannot bypass the text-rendering facade", async () => {
  const files = await collectTypeScriptFiles(path.join(projectRoot, "src"));

  for (const file of files) {
    if (file === "src/textRendering.ts" || file.startsWith("src/textRendering/")) continue;
    const source = await readFile(path.join(projectRoot, file), "utf8");
    const deepImports = importedModules(file, source).filter(({ specifier }) =>
      normalizeModule(specifier).includes("textrendering/"),
    );
    assert.deepEqual(
      deepImports,
      [],
      `${file} must import the stable textRendering facade instead of a leaf module`,
    );
  }
});

test("TMP caches remain single module-level instances", async () => {
  const files = await collectTypeScriptFiles(path.join(projectRoot, "src/textRendering"));
  const declarations = [];

  for (const file of files) {
    const source = await readFile(path.join(projectRoot, file), "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    function visit(node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        ["tmpAtlasCache", "tmpGlyphCanvasCache"].includes(node.name.text)
      ) {
        declarations.push(`${file}:${node.name.text}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }

  assert.deepEqual(declarations.sort(), [
    "src/textRendering/tmpText.ts:tmpAtlasCache",
    "src/textRendering/tmpText.ts:tmpGlyphCanvasCache",
  ]);
});
