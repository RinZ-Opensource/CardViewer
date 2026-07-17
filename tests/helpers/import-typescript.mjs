import { readFile } from "node:fs/promises";
import ts from "typescript";

const repositoryRoot = new URL("../../", import.meta.url);

/**
 * Import a self-contained TypeScript source file on every supported Node 22
 * release without relying on Node's evolving built-in type stripping.
 */
export async function importTypeScriptModule(relativePath) {
  const source = await readFile(new URL(relativePath, repositoryRoot), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: relativePath,
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

/**
 * Import a TypeScript module together with its acyclic static runtime imports.
 *
 * The lightweight helper above remains preferable for self-contained modules.
 * This variant rewrites emitted ESM specifiers to data/file URLs so pure
 * functions can also be tested after they move behind local module boundaries.
 */
export async function importTypeScriptModuleGraph(relativePath) {
  const cache = new Map();
  const active = new Set();

  async function resolveLocalModule(importerUrl, specifier) {
    const base = new URL(specifier, importerUrl);
    const candidates = [base, ...[".ts", ".tsx", "/index.ts", "/index.tsx"].map(
      (suffix) => new URL(`${base.href}${suffix}`),
    )];

    for (const candidate of candidates) {
      try {
        await readFile(candidate, "utf8");
        return candidate;
      } catch (error) {
        if (error?.code !== "ENOENT" && error?.code !== "EISDIR") throw error;
      }
    }
    throw new Error(`Unable to resolve ${specifier} from ${importerUrl.href}`);
  }

  async function compile(moduleUrl) {
    const cacheKey = moduleUrl.href;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    if (active.has(cacheKey)) {
      throw new Error(`Circular test-module dependency at ${cacheKey}`);
    }

    active.add(cacheKey);
    try {
      const source = await readFile(moduleUrl, "utf8");
      const { outputText } = ts.transpileModule(source, {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
        fileName: moduleUrl.pathname,
      });
      const emitted = ts.createSourceFile(
        moduleUrl.pathname,
        outputText,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS,
      );
      const replacements = [];

      for (const statement of emitted.statements) {
        if (
          (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) ||
          !statement.moduleSpecifier ||
          !ts.isStringLiteral(statement.moduleSpecifier)
        ) {
          continue;
        }

        const specifier = statement.moduleSpecifier.text;
        const target = specifier.startsWith(".")
          ? await compile(await resolveLocalModule(moduleUrl, specifier))
          : import.meta.resolve(specifier);
        replacements.push({
          start: statement.moduleSpecifier.getStart(emitted) + 1,
          end: statement.moduleSpecifier.getEnd() - 1,
          target,
        });
      }

      let rewritten = outputText;
      for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
        rewritten =
          rewritten.slice(0, replacement.start) +
          replacement.target +
          rewritten.slice(replacement.end);
      }
      const dataUrl = `data:text/javascript;base64,${Buffer.from(rewritten).toString("base64")}`;
      cache.set(cacheKey, dataUrl);
      return dataUrl;
    } finally {
      active.delete(cacheKey);
    }
  }

  const entryUrl = new URL(relativePath, repositoryRoot);
  return import(await compile(entryUrl));
}
