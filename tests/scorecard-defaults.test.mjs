import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const factoryNames = ["defaultState", "defaultChuniState", "defaultOngekiState"];
const sourcePath = new URL("../src/scorecard/scorecardDefaults.ts", import.meta.url);
const source = await readFile(sourcePath, "utf8");
const sourceFile = ts.createSourceFile(
  "scorecardDefaults.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

const declarations = new Map();
for (const statement of sourceFile.statements) {
  if (
    ts.isFunctionDeclaration(statement) &&
    statement.name &&
    factoryNames.includes(statement.name.text)
  ) {
    declarations.set(statement.name.text, statement.getText(sourceFile));
  }
}
assert.deepEqual([...declarations.keys()].sort(), [...factoryNames].sort());

const samples = {
  mai: [{ id: 91_001 }, { id: 91_002 }],
  chuni: [{ id: 92_001 }, { id: 92_002 }],
  ongeki: [{ id: "sentinel-93001" }, { id: "sentinel-93002" }],
};
const testModule = `
const MAI_SAMPLE_SONGS = samples.mai;
const CHUNI_SAMPLE_SONGS = samples.chuni;
const ONGEKI_SAMPLE_SONGS = samples.ongeki;
${factoryNames.map((name) => declarations.get(name)).join("\n")}
`;
const { outputText } = ts.transpileModule(testModule, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: "scorecardDefaults.test.ts",
});
function evaluateFactories(sampleSet) {
  const moduleExports = {};
  new Function("samples", "exports", outputText)(sampleSet, moduleExports);
  return moduleExports;
}

const moduleExports = evaluateFactories(samples);
const { defaultState, defaultChuniState, defaultOngekiState } = moduleExports;

test("default factories return a fresh state object", () => {
  for (const factory of [defaultState, defaultChuniState, defaultOngekiState]) {
    assert.notStrictEqual(factory(), factory());
  }
});

test("default factories bind songId to the first bundled sample", () => {
  assert.equal(defaultState().songId, samples.mai[0].id);
  assert.equal(defaultChuniState().songId, samples.chuni[0].id);
  assert.equal(defaultOngekiState().songId, samples.ongeki[0].id);
});

test("default factories retain their songId fallbacks when samples are empty", () => {
  const emptyFactories = evaluateFactories({ mai: [], chuni: [], ongeki: [] });
  assert.equal(emptyFactories.defaultState().songId, 0);
  assert.equal(emptyFactories.defaultChuniState().songId, 0);
  assert.equal(emptyFactories.defaultOngekiState().songId, "0001");
});

test("defaultState returns the maimai defaults", () => {
  assert.deepEqual(defaultState(), {
    songId: samples.mai[0].id,
    songDbBacked: false,
    difficulty: "expert",
    achievement: "100.9950",
    dxScore: "2589",
    dxScoreMax: "",
    comboBadge: "ap",
    syncBadge: "fsdp",
  });
});

test("defaultChuniState returns the CHUNITHM defaults", () => {
  assert.deepEqual(defaultChuniState(), {
    songId: samples.chuni[0].id,
    songDbBacked: false,
    difficulty: "master",
    level: "13+",
    track: "1",
    speed: "2.0",
    sonic: false,
    mirror: false,
    weKanji: "祭",
    weStars: 3,
    cardType: "musicbox",
    bestScore: "1007850",
    successLamp: "clear",
    comboLamp: "fc",
    fullChainLamp: "none",
    bpm: "180",
    notesDesigner: "Jack",
    confirmed: false,
    startBanner: "gamestart",
  });
});

test("defaultOngekiState returns the O.N.G.E.K.I. defaults", () => {
  assert.deepEqual(defaultOngekiState(), {
    songId: samples.ongeki[0].id,
    songDbBacked: false,
    difficulty: "master",
    level: "13+",
    speed: "9.5",
    sonic: false,
    mirror: false,
    secret: false,
    cardType: "musicbt",
    techScore: "1004283",
    battleScore: "5123456",
    platinumScore: "1450",
    platinumScoreMax: "1500",
    overDamage: "254.5",
    battleRank: "great",
    fullBell: true,
    fcLamp: "fc",
    bossLevel: "45",
    bossAttribute: "fire",
    bpm: "180",
    notesDesigner: "-",
  });
});
