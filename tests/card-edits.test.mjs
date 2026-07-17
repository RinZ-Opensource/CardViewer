import assert from "node:assert/strict";
import test from "node:test";
import { importTypeScriptModule } from "./helpers/import-typescript.mjs";

const {
  SHARED_PLAYER_EDITS_KEY,
  applyEdits,
  effectiveCardEdits,
  maiLinkedPrintEdits,
  parseStoredCardEdits,
} = await importTypeScriptModule("src/cardEdits.ts");

function card(overrides = {}) {
  return {
    id: "1",
    game: "MAI",
    recordType: "Card",
    dataName: "card00000001",
    displayName: "Original character",
    characterName: "Original character",
    skillName: "",
    skillText: "",
    rareType: null,
    labelType: null,
    difType: null,
    miss: null,
    combo: null,
    chain: null,
    imagePath: null,
    thumbnailPath: null,
    assetLayers: [],
    editableFields: [],
    printFields: [
      { key: "charaName", label: "Character", fieldType: "text", value: "Original character" },
      { key: "userName", label: "Player", fieldType: "text", value: "PLAYER" },
      { key: "hideFrame", label: "Hide frame", fieldType: "bool", value: "false" },
    ],
    ...overrides,
  };
}

test("parseStoredCardEdits keeps only nested string and boolean overrides", () => {
  const parsed = parseStoredCardEdits(JSON.stringify({
    card00000001: { charaName: "Edited", hideFrame: true, bad: 10 },
    malformed: "not an edit map",
  }));

  assert.deepEqual({ ...parsed.card00000001 }, { charaName: "Edited", hideFrame: true });
  assert.equal(parsed.malformed, undefined);
  assert.deepEqual(parseStoredCardEdits("{broken"), {});
});

test("effectiveCardEdits merges shared player data over a card edit", () => {
  const edits = {
    card00000001: { charaName: "Edited", userName: "stale" },
    [SHARED_PLAYER_EDITS_KEY]: { userName: "Shared player" },
  };

  assert.deepEqual(effectiveCardEdits(edits, card()), {
    charaName: "Edited",
    userName: "Shared player",
  });
});

test("applyEdits produces a render-ready card without mutating the manifest record", () => {
  const source = card();
  const edited = applyEdits(source, { charaName: "Edited character", hideFrame: true });

  assert.equal(source.printFields[0].value, "Original character");
  assert.equal(edited.displayName, "Edited character");
  assert.equal(edited.printFields[0].value, "Edited character");
  assert.equal(edited.printFields[2].value, "true");
  assert.deepEqual(edited.editedPrintFields, ["charaName", "hideFrame"]);
});

test("maiLinkedPrintEdits keeps character identity fields synchronized", () => {
  const source = card({
    printFields: [
      { key: "charaId", label: "Character", fieldType: "select", value: "1" },
      {
        key: "charaChoices",
        label: "Choices",
        fieldType: "metadata",
        value: "1|10|100|Original character\n2|20|200|New character",
      },
      { key: "verCharaId", label: "Version character", fieldType: "text", value: "[maimaiDX]-0100" },
    ],
  });

  assert.deepEqual(maiLinkedPrintEdits(source, "charaId", "2"), {
    charaId: "2",
    mapId: "20",
    uniqueId: "200",
    charaName: "New character",
    verCharaId: "[maimaiDX]-0200",
  });
});
