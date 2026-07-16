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
      modules.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      modules.push(node.arguments[0].text);
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
    const imported = importedModules(boundary.file, source).map(normalizeModule);

    for (const forbidden of boundary.forbidden) {
      assert.equal(
        imported.includes(normalizeModule(forbidden)),
        false,
        `${boundary.file} must not import ${forbidden}`,
      );
    }
  });
}
