import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const scannerSource = path.join(
  projectRoot,
  "scripts",
  "security",
  "check-mobile-boundary.mjs",
);

function run(repo, command, args) {
  return spawnSync(command, args, {
    cwd: repo,
    encoding: "utf8",
    windowsHide: true,
  });
}

function runGit(repo, ...args) {
  const result = run(repo, "git", args);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

async function temporaryRepository(t) {
  const repo = await mkdtemp(path.join(tmpdir(), "cardviewer-mobile-boundary-"));
  t.after(() => rm(repo, { recursive: true, force: true }));
  await mkdir(path.join(repo, "scripts", "security"), { recursive: true });
  await copyFile(
    scannerSource,
    path.join(repo, "scripts", "security", "check-mobile-boundary.mjs"),
  );
  runGit(repo, "init", "--quiet");
  return repo;
}

function runScanner(repo) {
  return run(
    repo,
    process.execPath,
    [path.join(repo, "scripts", "security", "check-mobile-boundary.mjs")],
  );
}

async function writeRepositoryFile(repo, relativePath, contents = "fixture\n") {
  const absolutePath = path.join(repo, ...relativePath.split("/"));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
  return absolutePath;
}

test("accepts the current tracked source-only mobile tree", () => {
  const result = runScanner(projectRoot);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS/);
});

test("keeps the experimental Android build identity neutral and batch-safe", async () => {
  const source = await readFile(
    path.join(
      projectRoot,
      "mobile",
      "CardMakerMobile.UnityBridge",
      "CardMakerMobileAndroidBuild.cs",
    ),
    "utf8",
  );

  const disallowedCompany = new RegExp(
    ["jp", "co", "sega-interactive"].join("\\."),
    "i",
  );
  assert.doesNotMatch(source, disallowedCompany);
  assert.match(source, /PlayerSettings\.companyName\s*=\s*"ConfigArc"/);
  assert.match(source, /activeBuildTarget\s*!=\s*BuildTarget\.Android/);
  assert.match(source, /-buildTarget android/);
  assert.doesNotMatch(source, /SwitchActiveBuildTarget/);
});

test("rejects external Unity and generated mobile paths forced into the index", async (t) => {
  const repo = await temporaryRepository(t);
  const forbiddenPaths = [
    "mobile/ExternalUnity/Assets/card.png",
    "mobile/ExternalUnity/ProjectSettings/ProjectSettings.asset",
    "mobile/ExternalUnity/Packages/manifest.json",
    "mobile/output/.cmpack-staging/manifest.json",
    "mobile/output/StreamingAssets.mobilebuild_externalized/data.txt",
    "mobile/tool/bin/output.txt",
    "mobile/tool/obj/cache.txt",
    "mobile/output/app.apk",
  ];

  for (const relativePath of forbiddenPaths) {
    await writeRepositoryFile(repo, relativePath);
    runGit(repo, "add", "--force", "--", relativePath);
  }

  const result = runScanner(repo);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  for (const relativePath of forbiddenPaths) {
    assert.match(result.stderr, new RegExp(relativePath.replaceAll(".", "\\.")));
  }
});

test("checks the forced index blob after a local patcher is deleted", async (t) => {
  const repo = await temporaryRepository(t);
  const relativePath = "mobile/CardMakerMobile.UnityBridge/patch_unity_project.py";
  const absolutePath = await writeRepositoryFile(repo, relativePath);
  runGit(repo, "add", "--force", "--", relativePath);
  await rm(absolutePath);

  const result = runScanner(repo);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /TARGET_PATCHER \(index path\)/);
  assert.match(result.stderr, /patch_unity_project\.py/);
});

test("checks an unstaged binary replacement of tracked mobile source", async (t) => {
  const repo = await temporaryRepository(t);
  const relativePath = "mobile/CardMakerMobile.Runtime/Source.cs";
  const absolutePath = await writeRepositoryFile(repo, relativePath, "class Source {}\n");
  runGit(repo, "add", "--", relativePath);
  await writeFile(absolutePath, Buffer.from([0x00, 0x01, 0x02, 0x03]));

  const result = runScanner(repo);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /BINARY_CONTENT \(working tree\)/);
  assert.match(result.stderr, /Source\.cs/);
});
