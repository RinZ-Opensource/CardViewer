import ts from "typescript";

export function importedModules(file, source) {
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

export function normalizeModule(specifier) {
  return specifier
    .replace(/\.(?:[cm]?[jt]sx?)$/i, "")
    .replace(/\/index$/i, "")
    .toLowerCase();
}
