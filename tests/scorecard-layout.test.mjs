import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importTypeScriptModule } from "./helpers/import-typescript.mjs";

const { SCORECARD_DESIGN_SIZES, scorecardDesignSize } = await importTypeScriptModule(
  "src/scorecard/scorecardLayout.ts",
);

const variants = [
  {
    name: "maimai",
    selection: { game: "mai" },
    size: SCORECARD_DESIGN_SIZES.mai,
    css: "../src/styles/scorecard.css",
    selector: ".mai-scorecard",
  },
  {
    name: "CHUNITHM panel",
    selection: { game: "chuni", cardType: "panel" },
    size: SCORECARD_DESIGN_SIZES.chuni.panel,
    css: "../src/styles/scorecard-chuni.css",
    selector: ".chuni-scorecard",
  },
  {
    name: "CHUNITHM musicbox",
    selection: { game: "chuni", cardType: "musicbox" },
    size: SCORECARD_DESIGN_SIZES.chuni.musicbox,
    css: "../src/styles/scorecard-chuni-box.css",
    selector: ".chuni-musicbox-card",
  },
  {
    name: "O.N.G.E.K.I. panel",
    selection: { game: "ongeki", cardType: "panel" },
    size: SCORECARD_DESIGN_SIZES.ongeki.panel,
    css: "../src/styles/scorecard-ongeki.css",
    selector: ".ongeki-scorecard",
  },
  {
    name: "O.N.G.E.K.I. music battle",
    selection: { game: "ongeki", cardType: "musicbt" },
    size: SCORECARD_DESIGN_SIZES.ongeki.musicbt,
    css: "../src/styles/scorecard-ongeki-bt.css",
    selector: ".ongeki-musicbt-card",
  },
];

test("score-card variants resolve to their stable design-size objects", () => {
  for (const variant of variants) {
    assert.strictEqual(
      scorecardDesignSize(variant.selection),
      variant.size,
      `${variant.name} must return its table entry`,
    );
  }
});

test("score-card CSS roots match the preview fitting dimensions", async () => {
  for (const variant of variants) {
    const source = await readFile(new URL(variant.css, import.meta.url), "utf8");
    const escaped = variant.selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rule = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1];
    assert.ok(rule, `missing CSS root ${variant.selector}`);
    assert.match(
      rule,
      new RegExp(`(?:^|;)\\s*width\\s*:\\s*${variant.size.width}px\\s*(?:;|$)`),
    );
    assert.match(
      rule,
      new RegExp(`(?:^|;)\\s*height\\s*:\\s*${variant.size.height}px\\s*(?:;|$)`),
    );
  }
});
