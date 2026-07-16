import {
  lstatSync,
  readFileSync,
  readlinkSync,
} from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryHint = fileURLToPath(new URL("../../", import.meta.url));

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: repositoryHint,
    encoding: null,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`unable to run git: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed with exit code ${result.status}`);
  }

  return result.stdout;
}

const repositoryRoot = runGit(["rev-parse", "--show-toplevel"])
  .toString("utf8")
  .trim();

const forbiddenSegments = new Map([
  [".cmpack-staging", "CMPACK_STAGING"],
  ["assets", "UNITY_PROJECT"],
  ["bin", "BUILD_OUTPUT"],
  ["build", "BUILD_OUTPUT"],
  ["builds", "BUILD_OUTPUT"],
  ["imported", "IMPORTED_CONTENT"],
  ["library", "UNITY_OUTPUT"],
  ["logs", "UNITY_OUTPUT"],
  ["obj", "BUILD_OUTPUT"],
  ["packages", "UNITY_PROJECT"],
  ["projectsettings", "UNITY_PROJECT"],
  ["temp", "UNITY_OUTPUT"],
  ["usersettings", "UNITY_OUTPUT"],
]);

const forbiddenExtensions = new Map([
  [".aab", "ANDROID_PACKAGE"],
  [".apk", "ANDROID_PACKAGE"],
  [".cmpack", "GENERATED_PACK"],
  [".dll", "BUILD_OUTPUT"],
  [".obb", "ANDROID_PACKAGE"],
]);

function trackedMobilePaths() {
  return runGit(["ls-files", "--cached", "-z", "--", "mobile"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"));
}

function readIndexFile(path) {
  return runGit(["show", `:${path}`]);
}

function readWorkingTreeFile(path) {
  const absolutePath = resolve(repositoryRoot, ...path.split("/"));

  try {
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
      return Buffer.from(readlinkSync(absolutePath), "utf8");
    }
    if (!stat.isFile()) {
      return null;
    }
    return readFileSync(absolutePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    return null;
  }
}

function pathViolation(path) {
  const normalized = path.toLowerCase();
  const segments = normalized.split("/");
  const name = segments.at(-1) ?? "";

  if (name === "patch_unity_project.py") {
    return "TARGET_PATCHER";
  }

  for (const segment of segments.slice(1, -1)) {
    const rule = forbiddenSegments.get(segment);
    if (rule) {
      return rule;
    }
    if (segment.startsWith("streamingassets.mobilebuild_externalized")) {
      return "EXTERNALIZED_OFFICIAL_CONTENT";
    }
  }

  const dot = name.lastIndexOf(".");
  if (dot >= 0) {
    return forbiddenExtensions.get(name.slice(dot)) ?? null;
  }

  return null;
}

function looksBinary(buffer) {
  if (buffer.length === 0) {
    return false;
  }

  if (
    buffer.length >= 2 &&
    ((buffer[0] === 0xff && buffer[1] === 0xfe) ||
      (buffer[0] === 0xfe && buffer[1] === 0xff))
  ) {
    return false;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.includes(0)) {
    return true;
  }

  let controlBytes = 0;
  for (const byte of sample) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      controlBytes += 1;
    }
  }
  return controlBytes / sample.length > 0.2;
}

const violations = [];
const paths = trackedMobilePaths();

for (const path of paths) {
  const pathRule = pathViolation(path);
  if (pathRule) {
    violations.push({ path, source: "index path", rule: pathRule });
  }

  const indexFile = readIndexFile(path);
  if (looksBinary(indexFile)) {
    violations.push({ path, source: "index blob", rule: "BINARY_CONTENT" });
  }

  const workingTreeFile = readWorkingTreeFile(path);
  if (
    workingTreeFile &&
    !workingTreeFile.equals(indexFile) &&
    looksBinary(workingTreeFile)
  ) {
    violations.push({ path, source: "working tree", rule: "BINARY_CONTENT" });
  }
}

if (violations.length > 0) {
  console.error("Mobile repository boundary check failed:");
  for (const violation of violations) {
    console.error(`- ${violation.rule} (${violation.source}): ${violation.path}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Mobile repository boundary: PASS (${paths.length} tracked path(s) scanned)`);
}
