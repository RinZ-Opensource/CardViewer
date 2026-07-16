import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

const boundaries = [
  { file: "src/hooks.ts", forbidden: ["./cards"] },
  { file: "src/cardData.ts", forbidden: ["./layers"] },
  {
    file: "src/cardAssets.ts",
    forbidden: ["./cards", "./hooks", "./App"],
  },
  {
    file: "src/holoMaskMath.ts",
    allowed: ["./holoMaskTypes"],
    typeOnly: true,
    forbidden: ["react", "./holo", "./constants", "./geometry", "./textRendering"],
  },
  {
    file: "src/holoMaskTypes.ts",
    allowed: ["./textRendering", "./types"],
    typeOnly: true,
    forbidden: ["react", "./holo", "./constants", "./geometry"],
  },
  {
    file: "src/scorecard/scorecardInput.ts",
    forbidden: ["react", "./ScoreCardSurface", "../persistence"],
  },
  {
    file: "src/scorecard/scorecardSurfaceConfig.ts",
    forbidden: [
      "react",
      "./ScoreCardSurface",
      "../persistence",
      "./MaiScoreCard",
      "./ChuniScoreCard",
      "./ChuniMusicBoxCard",
      "./OngekiScoreCard",
      "./OngekiMusicBtCard",
    ],
  },
  {
    file: "src/scorecard/scorecardDefaults.ts",
    allowed: [
      "./sampleSongs",
      "./types",
      "./chuniSamples",
      "./chuniTypes",
      "./ongekiSamples",
      "./ongekiTypes",
    ],
    forbidden: [
      "react",
      "./ScoreCardSurface",
      "../persistence",
      "./MaiScoreCard",
      "./ChuniScoreCard",
      "./ChuniMusicBoxCard",
      "./OngekiScoreCard",
      "./OngekiMusicBtCard",
    ],
  },
  {
    file: "src/scorecard/MaiScoreCardEditor.tsx",
    allowed: [
      "./SongPicker",
      "./maiScore",
      "./scorecardInput",
      "./scorecardSurfaceConfig",
      "./songdb",
      "./types",
    ],
  },
  {
    file: "src/scorecard/ChuniScoreCardEditor.tsx",
    allowed: [
      "./SongPicker",
      "./chuniAssets",
      "./chuniTypes",
      "./scorecardInput",
      "./scorecardSurfaceConfig",
      "./songdb",
    ],
  },
  {
    file: "src/scorecard/OngekiScoreCardEditor.tsx",
    allowed: [
      "./SongPicker",
      "./ongekiAssets",
      "./ongekiTypes",
      "./scorecardInput",
      "./scorecardSurfaceConfig",
      "./songdb",
    ],
  },
  {
    file: "src/scorecard/useScoreCardSongDb.ts",
    allowed: [
      "react",
      "./chuniTypes",
      "./ongekiTypes",
      "./scorecardSurfaceConfig",
      "./songdb",
      "./types",
    ],
  },
  {
    file: "src/scorecard/useScoreCardState.ts",
    allowed: [
      "react",
      "../persistence",
      "./chuniTypes",
      "./ongekiTypes",
      "./scorecardDefaults",
      "./scorecardSurfaceConfig",
      "./types",
    ],
    forbidden: [
      "../exportPng",
      "./MaiScoreCard",
      "./ChuniScoreCard",
      "./ChuniMusicBoxCard",
      "./OngekiScoreCard",
      "./OngekiMusicBtCard",
      "./MaiScoreCardEditor",
      "./ChuniScoreCardEditor",
      "./OngekiScoreCardEditor",
    ],
  },
];

const holoMaskTypeExports = [
  "HoloCssMaskOptions",
  "HoloMaskImage",
  "HoloMaskInput",
  "HoloMaskMode",
  "HoloMaskRect",
  "HoloMaskRenderState",
  "HoloRootMaskMode",
  "HoloTmpTextMask",
];

function importedModules(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const modules = [];

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      modules.push({
        specifier: node.moduleSpecifier.text,
        typeOnly:
          (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly === true) ||
          (ts.isExportDeclaration(node) && node.isTypeOnly),
      });
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      modules.push({ specifier: node.arguments[0].text, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return modules;
}

function normalizeModule(specifier) {
  return specifier
    .replace(/\.(?:[cm]?[jt]sx?)$/i, "")
    .replace(/\/index$/i, "")
    .toLowerCase();
}

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(absolute)));
    } else if (/\.tsx?$/i.test(entry.name)) {
      files.push(absolute);
    }
  }
  return files;
}

for (const boundary of boundaries) {
  test(`${boundary.file} respects its frontend module boundary`, async () => {
    const source = await readFile(path.join(projectRoot, boundary.file), "utf8");
    const importRecords = importedModules(boundary.file, source);
    const imported = importRecords.map(({ specifier }) => normalizeModule(specifier));

    if (boundary.typeOnly) {
      for (const importedModule of importRecords) {
        assert.equal(
          importedModule.typeOnly,
          true,
          `${boundary.file} may only type-import ${importedModule.specifier}`,
        );
      }
    }

    if (boundary.allowed) {
      const allowed = boundary.allowed.map(normalizeModule);
      for (const importedModule of imported) {
        assert.equal(
          allowed.includes(importedModule),
          true,
          `${boundary.file} may not import ${importedModule}`,
        );
      }
    }

    for (const forbidden of boundary.forbidden ?? []) {
      assert.equal(
        imported.includes(normalizeModule(forbidden)),
        false,
        `${boundary.file} must not import ${forbidden}`,
      );
    }
  });
}

test("src/holo.tsx preserves the public holo mask type exports", async () => {
  const file = "src/holo.tsx";
  const source = await readFile(path.join(projectRoot, file), "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const exported = [];

  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.isTypeOnly &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      normalizeModule(statement.moduleSpecifier.text) === normalizeModule("./holoMaskTypes") &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      exported.push(...statement.exportClause.elements.map((element) => element.name.text));
    }
  }

  assert.deepEqual(exported.sort(), [...holoMaskTypeExports].sort());
});

test("frontend source does not embed machine-specific absolute paths", async () => {
  const sourceRoot = path.join(projectRoot, "src");
  const violations = [];

  for (const absolute of await collectTypeScriptFiles(sourceRoot)) {
    const source = await readFile(absolute, "utf8");
    const relative = path.relative(projectRoot, absolute);
    const sourceFile = ts.createSourceFile(
      relative,
      source,
      ts.ScriptTarget.Latest,
      true,
      absolute.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    function visit(node) {
      if (
        (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
        /^[A-Za-z]:[\\/]/.test(node.text)
      ) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push(`${relative}:${position.line + 1} (${node.text})`);
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  assert.deepEqual(violations, []);
});

function jsxTagNames(sourceFile) {
  const names = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      names.push(node.tagName.getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return names;
}

test("ScoreCardSurface delegates each controlled game editor", async () => {
  const file = "src/scorecard/ScoreCardSurface.tsx";
  const source = await readFile(path.join(projectRoot, file), "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const tags = jsxTagNames(sourceFile);

  for (const editor of [
    "MaiScoreCardEditor",
    "ChuniScoreCardEditor",
    "OngekiScoreCardEditor",
  ]) {
    assert.equal(tags.filter((tag) => tag === editor).length, 1, `${editor} must render once`);
  }
  for (const delegated of ["SongPicker", "input", "select", "label"]) {
    assert.equal(tags.includes(delegated), false, `Surface must delegate ${delegated}`);
  }
});

test("ScoreCardSurface delegates song database loading to its hook", async () => {
  const file = "src/scorecard/ScoreCardSurface.tsx";
  const source = await readFile(path.join(projectRoot, file), "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const forbidden = new Set([
    "invalidateSongDbCache",
    "loadChuniSongs",
    "loadMaiSongs",
    "loadOngekiSongs",
  ]);
  const imported = [];

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    for (const element of statement.importClause.namedBindings.elements) {
      imported.push(element.propertyName?.text ?? element.name.text);
    }
  }

  assert.deepEqual(imported.filter((name) => forbidden.has(name)), []);
});

test("ScoreCardSurface delegates stored score-card state to its hooks", async () => {
  const file = "src/scorecard/ScoreCardSurface.tsx";
  const source = await readFile(path.join(projectRoot, file), "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const calls = [];

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      calls.push(node.expression.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.equal(calls.filter((name) => name === "useScoreCardState").length, 1);
  assert.equal(calls.filter((name) => name === "usePersistScoreCardState").length, 1);
  assert.equal(
    importedModules(file, source).some(
      ({ specifier }) => normalizeModule(specifier) === normalizeModule("../persistence"),
    ),
    false,
  );
});

for (const editor of [
  "src/scorecard/MaiScoreCardEditor.tsx",
  "src/scorecard/ChuniScoreCardEditor.tsx",
  "src/scorecard/OngekiScoreCardEditor.tsx",
]) {
  test(`${editor} remains a controlled UI leaf`, async () => {
    const source = await readFile(path.join(projectRoot, editor), "utf8");
    const sourceFile = ts.createSourceFile(
      editor,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const tags = jsxTagNames(sourceFile);
    assert.equal(tags.filter((tag) => tag === "SongPicker").length, 1);

    const forbiddenHooks = [];
    function visit(node) {
      if (ts.isCallExpression(node)) {
        const expression = node.expression;
        const name = ts.isIdentifier(expression)
          ? expression.text
          : ts.isPropertyAccessExpression(expression)
            ? expression.name.text
            : "";
        if (["useState", "useEffect", "useReducer", "useRef"].includes(name)) {
          forbiddenHooks.push(name);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    assert.deepEqual(forbiddenHooks, []);
  });
}

test("unfinished score-card actions remain disabled", async () => {
  const file = "src/scorecard/scorecardSurfaceConfig.ts";
  const source = await readFile(path.join(projectRoot, file), "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const expected = new Set([
    "SHOW_PANEL_CARDS",
    "SHOW_CHUNI_CONFIRMED_START",
    "SHOW_SCORECARD_RESET",
    "SHOW_SCORECARD_EXPORT",
  ]);
  const disabled = new Set();

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        expected.has(declaration.name.text) &&
        declaration.initializer?.kind === ts.SyntaxKind.FalseKeyword
      ) {
        disabled.add(declaration.name.text);
      }
    }
  }

  assert.deepEqual([...disabled].sort(), [...expected].sort());
});
