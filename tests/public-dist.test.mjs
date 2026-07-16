import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const checker = path.resolve(projectRoot, "check-public-dist.mjs");

function runChecker(distRoot) {
  return spawnSync(process.execPath, [checker, distRoot], {
    cwd: projectRoot,
    encoding: "utf8",
  });
}

async function temporaryDist(t) {
  const distRoot = await mkdtemp(path.join(tmpdir(), "cardviewer-public-dist-"));
  t.after(() => rm(distRoot, { recursive: true, force: true }));
  return distRoot;
}

test("accepts a public output without official or private-font files", async (t) => {
  const distRoot = await temporaryDist(t);
  await mkdir(path.join(distRoot, "assets"));
  await writeFile(path.join(distRoot, "index.html"), "<!doctype html>\n");

  const result = runChecker(distRoot);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS/);
});

test("rejects an official asset copied into the public output", async (t) => {
  const distRoot = await temporaryDist(t);
  await mkdir(path.join(distRoot, "official"), { recursive: true });
  await writeFile(path.join(distRoot, "official", "leaked.png"), "not-an-image");

  const result = runChecker(distRoot);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /official\/leaked\.png/);
});

test("rejects marker files inside a forbidden output directory", async (t) => {
  const distRoot = await temporaryDist(t);
  await mkdir(path.join(distRoot, "official"), { recursive: true });
  await writeFile(path.join(distRoot, "official", ".gitkeep"), "");

  const result = runChecker(distRoot);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /official\/\.gitkeep/);
});

test("rejects a licensed font copied into the public output", async (t) => {
  const distRoot = await temporaryDist(t);
  await mkdir(path.join(distRoot, "fonts", "private"), { recursive: true });
  await writeFile(path.join(distRoot, "fonts", "private", "leaked.otf"), "not-a-font");

  const result = runChecker(distRoot);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /fonts\/private\/leaked\.otf/);
});

test("rejects a missing output directory", () => {
  const missing = path.join(tmpdir(), `cardviewer-missing-${Date.now()}`);
  const result = runChecker(missing);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /dist directory does not exist/);
});
