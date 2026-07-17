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
    file: "src/runtimeJson.ts",
    allowed: [
      "./runtimeJson/fontMetrics",
      "./runtimeJson/manifest",
      "./runtimeJson/songDb",
    ],
  },
  { file: "src/runtimeJson/validation.ts", allowed: [] },
  {
    file: "src/runtimeJson/fontMetrics.ts",
    allowed: ["../types", "./validation"],
    typeOnly: ["../types"],
  },
  {
    file: "src/runtimeJson/manifest.ts",
    allowed: ["../types", "./validation"],
    typeOnly: ["../types"],
  },
  { file: "src/runtimeJson/songDb.ts", allowed: ["./validation"] },
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

test("every runtime JSON module has exactly one declared boundary", async () => {
  const declared = boundaries.map(({ file }) => file);
  assert.equal(
    new Set(declared).size,
    declared.length,
    "runtime JSON boundary entries must be unique",
  );

  const actual = [
    "src/runtimeJson.ts",
    ...(await collectTypeScriptFiles(path.join(projectRoot, "src/runtimeJson"))),
  ];
  assert.deepEqual(declared.sort(), actual.sort());
});

for (const boundary of boundaries) {
  test(`${boundary.file} respects its runtime JSON boundary`, async () => {
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
      assert.equal(
        matches[0].typeOnly,
        true,
        `${boundary.file} must keep ${typeOnlyModule} type-only`,
      );
    }
  });
}

test("the stable runtime JSON facade preserves its explicit public API", async () => {
  const file = "src/runtimeJson.ts";
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
    assert.ok(ts.isExportDeclaration(statement), "runtime JSON facade may contain only re-exports");
    assert.ok(statement.exportClause, "facade must not use export *");
    assert.ok(ts.isNamedExports(statement.exportClause), "facade exports must be named");

    for (const element of statement.exportClause.elements) {
      (statement.isTypeOnly || element.isTypeOnly ? types : values).push(element.name.text);
    }
  }

  assert.equal(
    new Set([...values, ...types]).size,
    values.length + types.length,
    "facade exports must be unique",
  );
  assert.deepEqual(values.sort(), [
    "parseOnlineManifestIndex",
    "parseOnlineManifestShard",
    "parseScanResult",
    "parseSongDbEntries",
    "parseTmpFontMetrics",
    "parseUnityFontMetrics",
  ].sort());
  assert.deepEqual(types.sort(), ["SongDbGameName", "SongDbRawEntry"].sort());
});

test("SongDB keeps its shared record contract type-only", async () => {
  const file = "src/runtimeJson/songDb.ts";
  const source = await readFile(path.join(projectRoot, file), "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const matches = [];

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      normalizeModule(statement.moduleSpecifier.text) !== normalizeModule("./validation")
    ) {
      continue;
    }

    const clause = statement.importClause;
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    for (const element of clause.namedBindings.elements) {
      const importedName = (element.propertyName ?? element.name).text;
      if (importedName === "JsonRecord") {
        matches.push(clause.isTypeOnly || element.isTypeOnly);
      }
    }
  }

  assert.deepEqual(matches, [true], "JsonRecord must be imported exactly once and remain type-only");
});

test("known consumers continue to use the stable runtime JSON facade", async () => {
  const consumers = new Map([
    ["src/fonts.ts", "./runtimeJson"],
    ["src/manifest.ts", "./runtimeJson"],
    ["src/scorecard/MaiTmpText.tsx", "../runtimeJson"],
    ["src/scorecard/songdb/loader.ts", "../../runtimeJson"],
    ["src/scorecard/songdb/models.ts", "../../runtimeJson"],
    ["src/scorecard/songdb/normalizeChuni.ts", "../../runtimeJson"],
    ["src/scorecard/songdb/normalizeMai.ts", "../../runtimeJson"],
    ["src/scorecard/songdb/normalizeOngeki.ts", "../../runtimeJson"],
  ]);

  for (const [file, expected] of consumers) {
    const source = await readFile(path.join(projectRoot, file), "utf8");
    const facade = normalizeModule(expected);
    const matches = importedModules(file, source).filter(
      ({ specifier }) => normalizeModule(specifier) === facade,
    );
    assert.deepEqual([...new Set(matches.map(({ specifier }) => specifier))], [expected]);
  }
});

test("frontend modules cannot bypass the runtime JSON facade", async () => {
  const files = await collectTypeScriptFiles(path.join(projectRoot, "src"));

  for (const file of files) {
    if (file === "src/runtimeJson.ts" || file.startsWith("src/runtimeJson/")) continue;
    const source = await readFile(path.join(projectRoot, file), "utf8");
    const deepImports = importedModules(file, source).filter(({ specifier }) =>
      /(?:^|\/)runtimejson\//.test(normalizeModule(specifier)),
    );
    assert.deepEqual(
      deepImports,
      [],
      `${file} must import the stable runtimeJson facade instead of a leaf module`,
    );
  }
});
