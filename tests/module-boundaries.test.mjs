import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

    for (const forbidden of boundary.forbidden) {
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
