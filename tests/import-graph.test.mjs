import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = path.join(projectRoot, "src");

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(absolute)));
    } else if (/\.tsx?$/i.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      files.push(absolute);
    }
  }
  return files;
}

function relativeSpecifiers(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers = [];

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text.startsWith(".")
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text.startsWith(".")
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

async function resolveTypeScriptImport(importer, specifier) {
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = path.extname(base)
    ? [base]
    : [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next TypeScript resolution candidate.
    }
  }
  return null;
}

function projectPath(absolute) {
  return path.relative(projectRoot, absolute).replaceAll(path.sep, "/");
}

test("frontend relative imports resolve and remain acyclic", async () => {
  const files = await collectTypeScriptFiles(sourceRoot);
  const graph = new Map();
  const unresolved = [];
  const outOfScope = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const dependencies = [];
    for (const specifier of relativeSpecifiers(file, source)) {
      const dependency = await resolveTypeScriptImport(file, specifier);
      if (!dependency) {
        unresolved.push(`${projectPath(file)} imports ${specifier}`);
        continue;
      }
      if (!/\.tsx?$/i.test(dependency)) continue;
      const sourceRelative = path.relative(sourceRoot, dependency);
      if (
        sourceRelative === ".." ||
        sourceRelative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(sourceRelative)
      ) {
        outOfScope.push(`${projectPath(file)} imports ${projectPath(dependency)}`);
        continue;
      }
      dependencies.push(dependency);
    }
    graph.set(file, dependencies);
  }

  assert.deepEqual(unresolved, []);
  assert.deepEqual(outOfScope, []);
  assert.deepEqual(
    [...graph.entries()].flatMap(([file, dependencies]) =>
      dependencies
        .filter((dependency) => !graph.has(dependency))
        .map((dependency) => `${projectPath(file)} imports unindexed ${projectPath(dependency)}`),
    ),
    [],
  );

  const state = new Map();
  const stack = [];
  const cycles = [];

  function visit(file) {
    state.set(file, 1);
    stack.push(file);
    for (const dependency of graph.get(file) ?? []) {
      if (state.get(dependency) === 1) {
        const start = stack.indexOf(dependency);
        cycles.push([...stack.slice(start), dependency].map(projectPath).join(" -> "));
        continue;
      }
      if (state.get(dependency) !== 2) visit(dependency);
    }
    stack.pop();
    state.set(file, 2);
  }

  for (const file of files) {
    if (!state.has(file)) visit(file);
  }

  assert.deepEqual([...new Set(cycles)].sort(), []);
});
