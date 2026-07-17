import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const checker = path.resolve(projectRoot, "check-public-dist.mjs");
const publicAssetPolicy = JSON.parse(
  await readFile(path.join(projectRoot, "public-asset-policy.json"), "utf8"),
);

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

async function populateReviewedDist(distRoot) {
  const files = [
    ...publicAssetPolicy.allowedPublicFiles,
    ...publicAssetPolicy.allowedGeneratedDistFiles,
    "assets/index-ABCDEFGH.css",
    "assets/index-ABCDEFGH.js",
  ];
  for (const relativePath of files) {
    const absolutePath = path.join(distRoot, ...relativePath.split("/"));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, "fixture\n");
  }
}

test("accepts output containing only reviewed public paths", async (t) => {
  const distRoot = await temporaryDist(t);
  await populateReviewedDist(distRoot);

  const result = runChecker(distRoot);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS/);
});

test("rejects an empty output directory", async (t) => {
  const distRoot = await temporaryDist(t);

  const result = runChecker(distRoot);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing:/);
});

test("rejects output missing a reviewed static file", async (t) => {
  const distRoot = await temporaryDist(t);
  await populateReviewedDist(distRoot);
  await rm(path.join(distRoot, "theme-init.js"));

  const result = runChecker(distRoot);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing: theme-init\.js/);
});

test("requires the Pages 404 boundary that prevents stale bundle fallback", async (t) => {
  const distRoot = await temporaryDist(t);
  await populateReviewedDist(distRoot);
  await rm(path.join(distRoot, "404.html"));

  const result = runChecker(distRoot);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing: 404\.html/);
});

test("rejects output missing the generated JavaScript entry", async (t) => {
  const distRoot = await temporaryDist(t);
  await populateReviewedDist(distRoot);
  await rm(path.join(distRoot, "assets", "index-ABCDEFGH.js"));

  const result = runChecker(distRoot);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing generated match: .*\\\.js/);
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

test("rejects an ignored environment file copied into the public output", async (t) => {
  const distRoot = await temporaryDist(t);
  await writeFile(path.join(distRoot, ".env.private"), "TOKEN=secret\n");

  const result = runChecker(distRoot);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\.env\.private/);
});

test("rejects an unreviewed credential file under an allowed asset directory", async (t) => {
  const distRoot = await temporaryDist(t);
  await mkdir(path.join(distRoot, "img"), { recursive: true });
  await writeFile(path.join(distRoot, "img", "credentials.json"), "{}\n");

  const result = runChecker(distRoot);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /img\/credentials\.json/);
});

test("rejects a plausible JavaScript credential file in Vite's asset directory", async (t) => {
  const distRoot = await temporaryDist(t);
  await mkdir(path.join(distRoot, "assets"), { recursive: true });
  await writeFile(path.join(distRoot, "assets", "credentials.js"), "export default {};\n");

  const result = runChecker(distRoot);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /assets\/credentials\.js/);
});

test("rejects a missing output directory", () => {
  const missing = path.join(tmpdir(), `cardviewer-missing-${Date.now()}`);
  const result = runChecker(missing);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /dist directory does not exist/);
});
