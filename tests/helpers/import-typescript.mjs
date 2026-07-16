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
