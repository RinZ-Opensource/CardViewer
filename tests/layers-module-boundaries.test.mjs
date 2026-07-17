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
    file: "src/layers.tsx",
    allowed: [
      "./layers/primitives",
      "./layers/canvasText",
      "./layers/unityText",
      "./layers/tmpText",
      "./layers/digitCounter",
      "./layers/qr",
    ],
  },
  { file: "src/layers/primitives.tsx", allowed: ["react", "../geometry"] },
  {
    file: "src/layers/canvasText.tsx",
    allowed: ["react", "../geometry", "../textRendering"],
  },
  {
    file: "src/layers/unityText.tsx",
    allowed: [
      "react",
      "../constants",
      "../geometry",
      "../textRendering",
      "../types",
      "./primitives",
    ],
    typeOnly: ["../types"],
  },
  {
    file: "src/layers/tmpText.tsx",
    allowed: ["react", "../constants", "../geometry", "../textRendering", "./primitives"],
  },
  {
    file: "src/layers/digitCounter.tsx",
    allowed: ["react", "../constants", "../geometry"],
    typeOnly: ["react"],
  },
  {
    file: "src/layers/qr.tsx",
    allowed: ["react", "qrcode", "../geometry", "../types"],
    typeOnly: ["../types"],
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

test("every visual-layer module has exactly one declared boundary", async () => {
  const declared = boundaries.map(({ file }) => file);
  assert.equal(new Set(declared).size, declared.length, "boundary entries must be unique");
  const actual = [
    "src/layers.tsx",
    ...(await collectTypeScriptFiles(path.join(projectRoot, "src/layers"))),
  ];
  assert.deepEqual(declared.sort(), actual.sort());
});

for (const boundary of boundaries) {
  test(`${boundary.file} respects its visual-layer boundary`, async () => {
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

test("the stable visual-layer facade preserves its public API", async () => {
  const file = "src/layers.tsx";
  const source = await readFile(path.join(projectRoot, file), "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
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
    "LayerCanvasText",
    "LayerChuCounter",
    "LayerDigitCounter",
    "LayerImage",
    "LayerQr",
    "LayerText",
    "LayerTmpText",
    "LayerUnityText",
    "calcCounterFigures",
    "counterFigureBackgroundPosition",
    "counterFigureHeight",
    "counterFigureWidth",
  ].sort());
  assert.deepEqual(types, ["CounterAlign"]);
});

test("card renderers continue to import only the stable visual-layer facade", async () => {
  const consumers = [
    "src/cardRender/ChuOfficialCard.tsx",
    "src/cardRender/MaiOfficialCard.tsx",
    "src/cardRender/Mu3OfficialCard.tsx",
    "src/cardRender/Mu3SharedLayers.tsx",
  ];

  for (const file of consumers) {
    const source = await readFile(path.join(projectRoot, file), "utf8");
    const matches = importedModules(file, source).filter(
      ({ specifier }) => normalizeModule(specifier) === normalizeModule("../layers"),
    );
    assert.deepEqual(matches.map(({ specifier }) => specifier), ["../layers"]);
  }
});

test("frontend modules cannot bypass the visual-layer facade", async () => {
  const files = await collectTypeScriptFiles(path.join(projectRoot, "src"));
  for (const file of files) {
    if (file === "src/layers.tsx" || file.startsWith("src/layers/")) continue;
    const source = await readFile(path.join(projectRoot, file), "utf8");
    const deepImports = importedModules(file, source).filter(({ specifier }) =>
      normalizeModule(specifier).includes("layers/"),
    );
    assert.deepEqual(
      deepImports,
      [],
      `${file} must import the stable layers facade instead of a leaf module`,
    );
  }
});
