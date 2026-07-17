import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
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
    css: "../src/styles/scorecard-mai.css",
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function orderedRuleSignatures(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const signatures = [];

  function walk(block, context) {
    let cursor = 0;
    while (cursor < block.length) {
      while (cursor < block.length && /\s/.test(block[cursor])) cursor += 1;
      if (cursor >= block.length) break;

      const open = block.indexOf("{", cursor);
      if (open < 0) break;
      const prelude = block.slice(cursor, open).trim().replace(/\s+/g, " ");
      let depth = 1;
      let close = open + 1;
      while (close < block.length && depth > 0) {
        if (block[close] === "{") depth += 1;
        if (block[close] === "}") depth -= 1;
        close += 1;
      }
      assert.equal(depth, 0, "CSS rule braces must remain balanced");

      const body = block.slice(open + 1, close - 1);
      if (prelude.startsWith("@media ")) {
        walk(body, [...context, prelude]);
      } else {
        const declarations = body.trim().replace(/\s+/g, " ");
        signatures.push([...context, `${prelude} { ${declarations} }`].join(" :: "));
      }
      cursor = close;
    }
  }

  walk(css, []);
  return signatures;
}

function ruleSignatureInventory(source) {
  const signatures = orderedRuleSignatures(source);
  return {
    count: signatures.length,
    digest: createHash("sha256").update(JSON.stringify(signatures)).digest("hex"),
  };
}

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
    const escaped = escapeRegExp(variant.selector);
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

test("every stylesheet loads once in stable cascade order", async () => {
  const mainSource = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  const imports = [...mainSource.matchAll(/import\s+"\.\/styles\/([^"]+\.css)";/g)].map(
    (match) => match[1],
  );

  assert.deepEqual(imports, [
    "base.css",
    "card.css",
    "holo.css",
    "ui.css",
    "scorecard-ui.css",
    "scorecard-mai.css",
    "scorecard-chuni.css",
    "scorecard-chuni-box.css",
    "scorecard-ongeki.css",
    "scorecard-ongeki-bt.css",
  ]);
  const styleFiles = (await readdir(new URL("../src/styles/", import.meta.url)))
    .filter((file) => file.endsWith(".css"))
    .sort();
  assert.deepEqual([...imports].sort(), styleFiles);
  assert.doesNotMatch(mainSource, /styles\/scorecard\.css/);
});

test("score-card UI and maimai renderer styles keep separate ownership", async () => {
  const uiSource = await readFile(
    new URL("../src/styles/scorecard-ui.css", import.meta.url),
    "utf8",
  );
  const maiSource = await readFile(
    new URL("../src/styles/scorecard-mai.css", import.meta.url),
    "utf8",
  );

  for (const selector of [
    ".scorecard-shell",
    ".scorecard-form",
    ".scorecard-preview",
    ".scorecard-empty",
    ".songpicker-list",
  ]) {
    assert.match(uiSource, new RegExp(escapeRegExp(selector)));
    assert.doesNotMatch(maiSource, new RegExp(escapeRegExp(selector)));
  }
  for (const selector of [".mai-scorecard", ".mai-tmp-text", ".msc-body", ".msc-title"]) {
    assert.match(maiSource, new RegExp(escapeRegExp(selector)));
    assert.doesNotMatch(uiSource, new RegExp(escapeRegExp(selector)));
  }
});

test("split score-card styles retain their ordered rule inventories", async () => {
  const uiSource = await readFile(
    new URL("../src/styles/scorecard-ui.css", import.meta.url),
    "utf8",
  );
  const maiSource = await readFile(
    new URL("../src/styles/scorecard-mai.css", import.meta.url),
    "utf8",
  );

  assert.deepEqual(ruleSignatureInventory(uiSource), {
    count: 38,
    digest: "101b7fa54255dac6062d7ac4d2579c457880cf4f0f64e43060b7811f5d803c3f",
  });
  assert.deepEqual(ruleSignatureInventory(maiSource), {
    count: 50,
    digest: "84c46b4133bd212c6841ecfcc732f39f01c36fad69774dd2b91bfcfdab18f669",
  });
});
