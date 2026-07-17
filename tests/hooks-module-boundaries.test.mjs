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
    file: "src/hooks.ts",
    allowed: [
      "./hooks/useCardListViewport",
      "./hooks/useOfficialFonts",
      "./hooks/useScanResult",
      "./hooks/useSelectedCardAssets",
      "./hooks/useThumbnailLoader",
    ],
  },
  { file: "src/hooks/useCardListViewport.ts", allowed: ["react"] },
  {
    file: "src/hooks/useOfficialFonts.ts",
    allowed: ["react", "../constants", "../fonts", "../types"],
    typeOnly: ["../types"],
  },
  {
    file: "src/hooks/useScanResult.ts",
    allowed: ["react", "../cardSupport", "../manifest", "../mockData", "../types"],
    typeOnly: ["../types"],
  },
  {
    file: "src/hooks/useSelectedCardAssets.ts",
    allowed: ["react", "../assetLoading", "../cardAssets", "../imageLoader", "../types"],
    typeOnly: ["../types"],
  },
  {
    file: "src/hooks/useThumbnailLoader.ts",
    allowed: ["react", "../imageLoader", "../types"],
    typeOnly: ["../types"],
  },
];

async function collectHookFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectHookFiles(absolute)));
    } else if (/\.tsx?$/i.test(entry.name)) {
      files.push(path.relative(projectRoot, absolute).replaceAll(path.sep, "/"));
    }
  }
  return files;
}

test("every shared hook module has exactly one declared boundary", async () => {
  const declared = boundaries.map(({ file }) => file);
  assert.equal(new Set(declared).size, declared.length, "hook boundary entries must be unique");

  const actual = [
    "src/hooks.ts",
    ...(await collectHookFiles(path.join(projectRoot, "src/hooks"))),
  ];
  assert.deepEqual(declared.sort(), actual.sort());
});

for (const boundary of boundaries) {
  test(`${boundary.file} respects the shared-hook boundary`, async () => {
    const source = await readFile(path.join(projectRoot, boundary.file), "utf8");
    const importRecords = importedModules(boundary.file, source);
    const imported = importRecords.map(({ specifier }) =>
      normalizeModule(specifier),
    );
    const allowed = boundary.allowed.map(normalizeModule);

    for (const importedModule of imported) {
      assert.equal(
        allowed.includes(importedModule),
        true,
        `${boundary.file} may not import ${importedModule}`,
      );
    }

    for (const typeOnlyModule of boundary.typeOnly ?? []) {
      const normalizedTypeOnlyModule = normalizeModule(typeOnlyModule);
      const matches = importRecords.filter(
        ({ specifier }) => normalizeModule(specifier) === normalizedTypeOnlyModule,
      );
      assert.equal(matches.length, 1, `${boundary.file} must import ${typeOnlyModule} once`);
      assert.equal(
        matches[0].typeOnly,
        true,
        `${boundary.file} must type-import ${typeOnlyModule}`,
      );
    }
  });
}

test("shared hook facade preserves its public API", async () => {
  const file = "src/hooks.ts";
  const source = await readFile(path.join(projectRoot, file), "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const exported = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause) continue;
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      exported.push(element.name.text);
    }
  }

  assert.deepEqual(exported.sort(), [
    "useCardListViewport",
    "useOfficialFonts",
    "useScanResult",
    "useSelectedAssetDataUrls",
    "useSelectedImageDataUrl",
    "useThumbnailLoader",
  ].sort());
});

test("async hook modules retain their race-guard implementation markers", async () => {
  const scan = await readFile(
    path.join(projectRoot, "src/hooks/useScanResult.ts"),
    "utf8",
  );
  const selectedAssets = await readFile(
    path.join(projectRoot, "src/hooks/useSelectedCardAssets.ts"),
    "utf8",
  );
  const thumbnails = await readFile(
    path.join(projectRoot, "src/hooks/useThumbnailLoader.ts"),
    "utf8",
  );

  assert.match(scan, /loadSequenceRef/);
  assert.match(scan, /isCurrentLoad\(\)/);
  assert.match(scan, /\[reloadToken, setSelectedId\]/);

  assert.equal((selectedAssets.match(/new AbortController\(\)/g) ?? []).length, 2);
  assert.equal((selectedAssets.match(/controller\.abort\(\)/g) ?? []).length, 2);
  assert.match(selectedAssets, /\[selectedImagePath\]/);
  assert.match(selectedAssets, /\[selected\?\.dataName, selectedAssetsSignature\]/);

  assert.match(thumbnails, /THUMB_CACHE_MAX_ENTRIES = 2048/);
  assert.match(thumbnails, /React\.useLayoutEffect/);
  assert.match(thumbnails, /window\.requestAnimationFrame/);
  assert.match(thumbnails, /window\.cancelAnimationFrame/);
  assert.match(thumbnails, /mountedRef\.current = false/);
});
