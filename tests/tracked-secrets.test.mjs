import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const scannerSource = path.join(
  projectRoot,
  "scripts",
  "security",
  "check-tracked-secrets.mjs",
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
  const repo = await mkdtemp(path.join(tmpdir(), "cardviewer-secret-scan-"));
  t.after(() => rm(repo, { recursive: true, force: true }));
  await mkdir(path.join(repo, "scripts", "security"), { recursive: true });
  await copyFile(
    scannerSource,
    path.join(repo, "scripts", "security", "check-tracked-secrets.mjs"),
  );
  runGit(repo, "init", "--quiet");
  return repo;
}

function simulatedSecret() {
  // Assemble at runtime so this regression test does not place a token-shaped
  // literal in the CardViewer repository itself.
  return ["AK", "IA", "A".repeat(16)].join("");
}

function runScanner(repo) {
  return run(
    repo,
    process.execPath,
    [path.join(repo, "scripts", "security", "check-tracked-secrets.mjs")],
  );
}

function assertSecretFailure(result, secret) {
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /AWS_ACCESS_KEY_ID/);
  assert.match(result.stderr, /"tracked\.txt":1/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(secret));
}

test("fails when the index contains a secret removed from the working tree", async (t) => {
  const repo = await temporaryRepository(t);
  const secret = simulatedSecret();
  await writeFile(path.join(repo, "tracked.txt"), `${secret}\n`);
  runGit(repo, "add", "--", "tracked.txt");
  await writeFile(path.join(repo, "tracked.txt"), "safe working-tree content\n");

  assertSecretFailure(runScanner(repo), secret);
});

test("fails when a tracked working-tree file gains an unstaged secret", async (t) => {
  const repo = await temporaryRepository(t);
  const secret = simulatedSecret();
  await writeFile(path.join(repo, "tracked.txt"), "safe index content\n");
  runGit(repo, "add", "--", "tracked.txt");
  await writeFile(path.join(repo, "tracked.txt"), `${secret}\n`);

  assertSecretFailure(runScanner(repo), secret);
});
