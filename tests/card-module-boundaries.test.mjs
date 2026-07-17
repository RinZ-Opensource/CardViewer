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
    file: "src/cardData.ts",
    allowed: [
      "./cardData/fields",
      "./cardData/formatting",
      "./cardData/holoRules",
      "./cardData/mai",
      "./cardData/mu3",
      "./cardData/qr",
    ],
  },
  { file: "src/cardData/fields.ts", allowed: ["../types"], typeOnly: true },
  { file: "src/cardData/formatting.ts", allowed: [] },
  {
    file: "src/cardData/holoRules.ts",
    allowed: ["../constants", "../types", "./fields"],
    forbidden: ["react", "../layers", "../hooks", "../manifest"],
  },
  {
    file: "src/cardData/mai.ts",
    allowed: ["../constants", "../geometry", "../types", "./fields"],
    forbidden: ["react", "../layers", "../hooks", "../manifest"],
  },
  {
    file: "src/cardData/mu3.ts",
    allowed: ["../constants", "../types", "./fields"],
    forbidden: ["react", "../layers", "../hooks", "../manifest"],
  },
  {
    file: "src/cardData/qr.ts",
    allowed: ["../types", "./fields"],
    forbidden: ["react", "../layers", "../hooks", "../manifest"],
  },
  {
    file: "src/cardRender/cardLighting.ts",
    allowed: ["react", "../constants", "../numeric", "../types"],
    forbidden: ["../hooks", "../manifest", "../persistence", "../holo"],
  },
  {
    file: "src/cardRender/PreviewStage.tsx",
    allowed: [
      "react",
      "../cardData/holoRules",
      "../constants",
      "../holo",
      "../types",
      "./cardLighting",
      "./OfficialCardCanvas",
    ],
    forbidden: ["../hooks", "../manifest", "../persistence", "../EditorPanel"],
  },
  {
    file: "src/cardRender/OfficialCardCanvas.tsx",
    allowed: [
      "react",
      "../constants",
      "../types",
      "./ChuOfficialCard",
      "./MaiOfficialCard",
      "./Mu3OfficialCard",
    ],
    forbidden: ["../hooks", "../manifest", "../persistence", "../holo", "../layers"],
  },
  {
    file: "src/cardRender/ChuOfficialCard.tsx",
    allowed: [
      "../cardData/fields",
      "../cardData/formatting",
      "../constants",
      "../layers",
      "../types",
    ],
    forbidden: ["../hooks", "../manifest", "../persistence", "../holo"],
  },
  {
    file: "src/cardRender/MaiOfficialCard.tsx",
    allowed: [
      "react",
      "../cardData/fields",
      "../cardData/formatting",
      "../cardData/holoRules",
      "../cardData/mai",
      "../cardData/qr",
      "../constants",
      "../holo",
      "../layers",
      "../types",
    ],
    forbidden: ["../hooks", "../manifest", "../persistence"],
  },
  {
    file: "src/cardRender/Mu3OfficialCard.tsx",
    allowed: [
      "react",
      "../cardData/fields",
      "../cardData/holoRules",
      "../cardData/mu3",
      "../constants",
      "../holo",
      "../layers",
      "../types",
      "./Mu3SharedLayers",
    ],
    forbidden: ["../hooks", "../manifest", "../persistence"],
  },
  {
    file: "src/cardRender/Mu3SharedLayers.tsx",
    allowed: [
      "react",
      "../cardData/fields",
      "../cardData/formatting",
      "../cardData/mu3",
      "../cardData/qr",
      "../constants",
      "../layers",
      "../types",
    ],
    forbidden: ["../hooks", "../manifest", "../persistence", "../holo"],
  },
];

async function collectFeatureFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFeatureFiles(absolute)));
    } else if (/\.tsx?$/i.test(entry.name)) {
      files.push(path.relative(projectRoot, absolute).replaceAll(path.sep, "/"));
    }
  }
  return files;
}

test("every card feature module has exactly one declared boundary", async () => {
  const declared = boundaries.map(({ file }) => file);
  assert.equal(new Set(declared).size, declared.length, "card boundary entries must be unique");

  const actual = [
    "src/cardData.ts",
    ...(await collectFeatureFiles(path.join(projectRoot, "src/cardData"))),
    ...(await collectFeatureFiles(path.join(projectRoot, "src/cardRender"))),
  ];
  assert.deepEqual(declared.sort(), actual.sort());
});

for (const boundary of boundaries) {
  test(`${boundary.file} respects the card feature boundary`, async () => {
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

test("card data facade preserves its public API", async () => {
  const file = "src/cardData.ts";
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
    "MaiCharaChoice",
    "clampInt",
    "createQrBytes",
    "fieldBool",
    "fieldEdited",
    "fieldNumber",
    "fieldString",
    "formatDisplaySerial",
    "formatMaiEndDate",
    "maiCardTypeEffects",
    "maiCharaChoice",
    "maiEffectFlags",
    "maiEffectIconAsset",
    "maiFrameAssets",
    "maiFramePattern",
    "maiOfficialHolo",
    "maiQrBytes",
    "maiRatingBaseAsset",
    "maiRatingPlatePattern",
    "mu3AttackValue",
    "mu3AttributeName",
    "mu3Awaken",
    "mu3AwakenMarkAsset",
    "mu3CardNames",
    "mu3FrameAsset",
    "mu3HoloBgAsset",
    "mu3HoloFrameBaseAsset",
    "mu3HoloFrameOverlayAsset",
    "mu3LevelParams",
    "mu3LevelPower",
    "mu3MaxLevel",
    "mu3MaxOwnCount",
    "mu3NeedsSign",
    "mu3QrBytes",
    "mu3RareSpriteName",
    "mu3RarityKind",
    "mu3ShowMainFrame",
    "mu3SkillAsset",
    "numericField",
    "numericText",
    "officialHolo",
    "parseMaiCharaChoices",
    "qrSource",
    "rc4",
    "twoDigits",
    "writeLe24",
    "writeLe32",
  ].sort());
});
