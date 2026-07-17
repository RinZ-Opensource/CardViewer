import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const selectionPath = new URL("../src/scorecard/scorecardSelection.ts", import.meta.url);
const songDbPath = new URL("../src/scorecard/songdb/chartHelpers.ts", import.meta.url);
const selectionSource = await readFile(selectionPath, "utf8");
const songDbSource = await readFile(songDbPath, "utf8");
const selectionFile = ts.createSourceFile(
  "scorecardSelection.ts",
  selectionSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
const songDbFile = ts.createSourceFile(
  "songdb/chartHelpers.ts",
  songDbSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function functionText(sourceFile, name) {
  const declaration = sourceFile.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  assert.ok(declaration, `missing function ${name}`);
  return declaration.getText(sourceFile);
}

function variableStatementText(sourceFile, name) {
  const statement = sourceFile.statements.find(
    (candidate) =>
      ts.isVariableStatement(candidate) &&
      candidate.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name,
      ),
  );
  assert.ok(statement, `missing variable ${name}`);
  return statement.getText(sourceFile);
}

const songDbHelpers = [
  "maiPreferredDifficulty",
  "chuniHasChart",
  "chuniPreferredDifficulty",
  "chuniChartFields",
  "ongekiHasChart",
  "ongekiPreferredDifficulty",
  "ongekiChartFields",
];
const selectionFunctions = [
  "migrateMaiStateToSongDb",
  "migrateChuniStateToSongDb",
  "migrateOngekiStateToSongDb",
  "createMaiSongSelection",
  "createMaiDifficultySelection",
  "createChuniSongSelection",
  "createChuniDifficultySelection",
  "createOngekiSongSelection",
  "createOngekiDifficultySelection",
];

const testModule = `
const MAI_SAMPLE_SONGS = samples.mai;
const CHUNI_SAMPLE_SONGS = samples.chuni;
const ONGEKI_SAMPLE_SONGS = samples.ongeki;
${variableStatementText(songDbFile, "CHUNI_LANDING_ORDER")}
${variableStatementText(songDbFile, "ONGEKI_LANDING_ORDER")}
${songDbHelpers.map((name) => functionText(songDbFile, name)).join("\n")}
${selectionFunctions.map((name) => functionText(selectionFile, name)).join("\n")}
`;
const { outputText } = ts.transpileModule(testModule, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: "scorecardSelection.test.ts",
});

const samples = {
  mai: [
    {
      id: 10,
      title: "Mai Sample",
      artist: "Sample Artist",
      isDx: true,
      charts: [],
    },
  ],
  chuni: [{ id: 20, title: "Chuni Sample", artist: "Sample Artist" }],
  ongeki: [{ id: "0001", title: "Sample Song 0001", artist: "Placeholder Artist" }],
};
const moduleExports = {};
new Function("samples", "exports", outputText)(samples, moduleExports);

const {
  migrateMaiStateToSongDb,
  migrateChuniStateToSongDb,
  migrateOngekiStateToSongDb,
  createMaiSongSelection,
  createMaiDifficultySelection,
  createChuniSongSelection,
  createChuniDifficultySelection,
  createOngekiSongSelection,
  createOngekiDifficultySelection,
} = moduleExports;

function maiSong(overrides = {}) {
  return {
    id: 100,
    title: "Mai DB Song",
    artist: "DB Artist",
    isDx: true,
    charts: [
      {
        difficulty: "master",
        level: "14",
        levelValue: 14,
        notesDesigner: "Mai Designer",
        maxDxScore: 3000,
      },
    ],
    ...overrides,
  };
}

function chuniSong(overrides = {}) {
  return {
    id: 200,
    title: "Chuni DB Song",
    artist: "DB Artist",
    charts: {
      master: {
        level: "14+",
        levelValue: 14.8,
        notesDesigner: "Chuni Designer",
        totalNotes: 1200,
      },
    },
    bpm: 180,
    ...overrides,
  };
}

function ongekiSong(overrides = {}) {
  return {
    id: "0200",
    title: "Ongeki DB Song",
    artist: "DB Artist",
    charts: {
      master: {
        level: "14",
        levelValue: 14.5,
        notesDesigner: "Ongeki Designer",
        totalNotes: 1000,
        bells: 120,
        platinumScoreMax: 2000,
      },
    },
    bpm: 190,
    bossLevel: 70,
    bossAttribute: "aqua",
    ...overrides,
  };
}

function maiState(overrides = {}) {
  return {
    songId: 10,
    songDbBacked: false,
    difficulty: "remaster",
    achievement: "100.0000",
    dxScore: "1234",
    dxScoreMax: "4321",
    comboBadge: "fc",
    syncBadge: "fs",
    ...overrides,
  };
}

function chuniState(overrides = {}) {
  return {
    songId: 20,
    songDbBacked: false,
    difficulty: "tutorial",
    level: "old-level",
    track: "2",
    speed: "5.0",
    sonic: false,
    mirror: true,
    weKanji: "old-kanji",
    weStars: 1,
    cardType: "musicbox",
    bestScore: "1000000",
    successLamp: "clear",
    comboLamp: "fc",
    fullChainLamp: "gold",
    bpm: "old-bpm",
    notesDesigner: "old-designer",
    confirmed: false,
    startBanner: "ready",
    ...overrides,
  };
}

function ongekiState(overrides = {}) {
  return {
    songId: "0001",
    songDbBacked: false,
    difficulty: "basic",
    level: "old-level",
    speed: "9.5",
    sonic: false,
    mirror: true,
    secret: false,
    cardType: "musicbt",
    techScore: "1000000",
    battleScore: "500000",
    platinumScore: "1000",
    platinumScoreMax: "old-max",
    overDamage: "200.0",
    battleRank: "great",
    fullBell: true,
    fcLamp: "fc",
    bossLevel: "old-boss",
    bossAttribute: "fire",
    bpm: "old-bpm",
    notesDesigner: "old-designer",
    ...overrides,
  };
}

test("empty song databases and valid DB-backed selections are identity no-ops", () => {
  const mai = maiState();
  const chuni = chuniState();
  const ongeki = ongekiState();
  assert.strictEqual(migrateMaiStateToSongDb(mai, []), mai);
  assert.strictEqual(migrateChuniStateToSongDb(chuni, []), chuni);
  assert.strictEqual(migrateOngekiStateToSongDb(ongeki, []), ongeki);

  const maiDb = maiSong();
  const chuniDb = chuniSong();
  const ongekiDb = ongekiSong();
  const backedMai = maiState({ songId: maiDb.id, songDbBacked: true });
  const backedChuni = chuniState({ songId: chuniDb.id, songDbBacked: true });
  const backedOngeki = ongekiState({ songId: ongekiDb.id, songDbBacked: true });
  assert.strictEqual(migrateMaiStateToSongDb(backedMai, [maiDb]), backedMai);
  assert.strictEqual(migrateChuniStateToSongDb(backedChuni, [chuniDb]), backedChuni);
  assert.strictEqual(migrateOngekiStateToSongDb(backedOngeki, [ongekiDb]), backedOngeki);
});

test("sample identities migrate to matching DB rows and apply preferred chart fields", () => {
  const maiMatch = maiSong({
    id: 101,
    title: samples.mai[0].title,
    artist: samples.mai[0].artist,
    isDx: samples.mai[0].isDx,
  });
  const migratedMai = migrateMaiStateToSongDb(maiState(), [maiSong({ id: 99 }), maiMatch]);
  assert.equal(migratedMai.songId, 101);
  assert.equal(migratedMai.songDbBacked, true);
  assert.equal(migratedMai.difficulty, "master");
  assert.equal(migratedMai.dxScoreMax, "");
  assert.equal(migratedMai.achievement, "100.0000");

  const chuniMatch = chuniSong({
    id: 201,
    title: samples.chuni[0].title,
    artist: samples.chuni[0].artist,
    charts: {
      ultima: {
        level: "15",
        levelValue: 15,
        notesDesigner: "Ultima Designer",
        totalNotes: 1500,
      },
    },
    bpm: 181,
  });
  const migratedChuni = migrateChuniStateToSongDb(chuniState(), [chuniSong({ id: 199 }), chuniMatch]);
  assert.equal(migratedChuni.songId, 201);
  assert.equal(migratedChuni.difficulty, "ultima");
  assert.equal(migratedChuni.level, "15");
  assert.equal(migratedChuni.notesDesigner, "Ultima Designer");
  assert.equal(migratedChuni.bpm, "181");
  assert.equal(migratedChuni.track, "2");

  const ongekiMatch = ongekiSong({
    id: "0201",
    title: samples.ongeki[0].title,
    artist: samples.ongeki[0].artist,
    charts: {
      lunatic: {
        level: "15",
        levelValue: 15,
        notesDesigner: "Lunatic Designer",
        totalNotes: 1400,
        bells: 140,
        platinumScoreMax: 2800,
      },
    },
  });
  const migratedOngeki = migrateOngekiStateToSongDb(
    ongekiState({ difficulty: "advanced" }),
    [ongekiSong({ id: "0199" }), ongekiMatch],
  );
  assert.equal(migratedOngeki.songId, "0201");
  assert.equal(migratedOngeki.difficulty, "lunatic");
  assert.equal(migratedOngeki.level, "15");
  assert.equal(migratedOngeki.platinumScoreMax, "2800");
  assert.equal(migratedOngeki.techScore, "1000000");
});

test("non-sample ids keep the same DB row", () => {
  const maiDb = maiSong({ id: 901 });
  const chuniDb = chuniSong({ id: 902 });
  const ongekiDb = ongekiSong({ id: "0903" });
  assert.equal(migrateMaiStateToSongDb(maiState({ songId: 901 }), [maiSong(), maiDb]).songId, 901);
  assert.equal(
    migrateChuniStateToSongDb(chuniState({ songId: 902 }), [chuniSong(), chuniDb]).songId,
    902,
  );
  assert.equal(
    migrateOngekiStateToSongDb(ongekiState({ songId: "0903" }), [ongekiSong(), ongekiDb])
      .songId,
    "0903",
  );
});

test("sample identity mismatch retains the existing first-row fallback", () => {
  const first = ongekiSong({ id: "0099", title: "First DB Song" });
  const sameIdDifferentIdentity = ongekiSong({
    id: samples.ongeki[0].id,
    title: "Real Song Title",
    artist: "Real Artist",
  });
  const migrated = migrateOngekiStateToSongDb(ongekiState(), [first, sameIdDifferentIdentity]);
  assert.equal(migrated.songId, first.id);
});

test("maimai song transitions preserve render-closure difficulty and clear the denominator", () => {
  const next = maiSong();
  const current = maiState({ difficulty: "basic", dxScoreMax: "9999" });
  const snapshot = structuredClone(current);
  const readyResult = createMaiSongSelection(next, "master", true)(current);
  assert.equal(readyResult.difficulty, "master");
  assert.equal(readyResult.songDbBacked, true);
  assert.equal(readyResult.dxScoreMax, "");
  assert.equal(readyResult.achievement, current.achievement);
  assert.deepEqual(current, snapshot);

  const loadingResult = createMaiSongSelection(next, "master", false)(current);
  assert.equal(loadingResult.songDbBacked, false);
  const difficultyResult = createMaiDifficultySelection("expert")(current);
  assert.equal(difficultyResult.difficulty, "expert");
  assert.equal(difficultyResult.dxScoreMax, "");
});

test("chunithm transitions apply chart fields while preserving unrelated state", () => {
  const next = chuniSong({
    charts: {
      expert: {
        level: "13+",
        levelValue: 13.8,
        notesDesigner: "Expert Designer",
        totalNotes: 900,
      },
    },
  });
  const current = chuniState({ difficulty: "basic" });
  const snapshot = structuredClone(current);
  const selected = createChuniSongSelection(next, "expert", true)(current);
  assert.equal(selected.difficulty, "expert");
  assert.equal(selected.level, "13+");
  assert.equal(selected.notesDesigner, "Expert Designer");
  assert.equal(selected.bpm, "180");
  assert.equal(selected.track, current.track);
  assert.deepEqual(current, snapshot);

  const worldsend = chuniSong({
    charts: {
      worldsend: {
        level: "",
        levelValue: 0,
        notesDesigner: "WE Designer",
        totalNotes: 800,
      },
    },
    weKanji: "敷",
    weStars: 4.5,
  });
  const difficultyResult = createChuniDifficultySelection(worldsend, "worldsend")(current);
  assert.equal(difficultyResult.weKanji, "敷");
  assert.equal(difficultyResult.weStars, 4.5);
});

test("ongeki transitions apply chart, boss, and platinum fields", () => {
  const next = ongekiSong({
    charts: {
      lunatic: {
        level: "15",
        levelValue: 15,
        notesDesigner: "Lunatic Designer",
        totalNotes: 1300,
        bells: 130,
        platinumScoreMax: 2600,
      },
    },
    bpm: 200,
    bossLevel: 80,
    bossAttribute: "leaf",
  });
  const current = ongekiState({ difficulty: "basic" });
  const snapshot = structuredClone(current);
  const selected = createOngekiSongSelection(next, "lunatic", false)(current);
  assert.equal(selected.difficulty, "lunatic");
  assert.equal(selected.songDbBacked, false);
  assert.equal(selected.level, "15");
  assert.equal(selected.notesDesigner, "Lunatic Designer");
  assert.equal(selected.platinumScoreMax, "2600");
  assert.equal(selected.bpm, "200");
  assert.equal(selected.bossLevel, "80");
  assert.equal(selected.bossAttribute, "leaf");
  assert.equal(selected.techScore, current.techScore);
  assert.deepEqual(current, snapshot);
});

test("chartless songs retain manual derived fields on difficulty changes", () => {
  const chartlessChuni = { id: 501, title: "Manual Chuni", artist: "Artist" };
  const chuniCurrent = chuniState();
  const chuniResult = createChuniDifficultySelection(chartlessChuni, "expert")(chuniCurrent);
  assert.equal(chuniResult.difficulty, "expert");
  assert.equal(chuniResult.level, chuniCurrent.level);
  assert.equal(chuniResult.notesDesigner, chuniCurrent.notesDesigner);
  assert.equal(chuniResult.bpm, chuniCurrent.bpm);

  const chartlessOngeki = { id: "0501", title: "Manual Ongeki", artist: "Artist" };
  const ongekiCurrent = ongekiState();
  const ongekiResult = createOngekiDifficultySelection(chartlessOngeki, "expert")(ongekiCurrent);
  assert.equal(ongekiResult.difficulty, "expert");
  assert.equal(ongekiResult.level, ongekiCurrent.level);
  assert.equal(ongekiResult.notesDesigner, ongekiCurrent.notesDesigner);
  assert.equal(ongekiResult.bossLevel, ongekiCurrent.bossLevel);
});
