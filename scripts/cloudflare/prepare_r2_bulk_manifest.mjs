#!/usr/bin/env node

import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const MANIFEST_NAME_PATTERN = /^r2-bulk-([a-z0-9]+)\.json$/;

const EXTENSION_POLICIES = Object.freeze({
  png: {
    contentType: "image/png",
    cacheControl: "public, max-age=31536000, immutable",
  },
  jpg: {
    contentType: "image/jpeg",
    cacheControl: "public, max-age=31536000, immutable",
  },
  jpeg: {
    contentType: "image/jpeg",
    cacheControl: "public, max-age=31536000, immutable",
  },
  webp: {
    contentType: "image/webp",
    cacheControl: "public, max-age=31536000, immutable",
  },
  json: {
    contentType: "application/json; charset=utf-8",
    cacheControl: "public, max-age=300, stale-while-revalidate=86400",
  },
});

function printUsage() {
  console.log(`Usage:
  node prepare_r2_bulk_manifest.mjs <source-root> <r2-prefix> <output-dir>
  node prepare_r2_bulk_manifest.mjs --verify-only <source-root> <r2-prefix> <output-dir>

The output directory receives one deterministic r2-bulk-<extension>.json
manifest per extension. Unknown extensions, symbolic links, duplicate keys, and
paths that escape the source root are rejected.`);
}

function parseArguments(argv) {
  let verifyOnly = false;
  let help = false;
  const positional = [];

  for (const argument of argv) {
    if (argument === "--verify-only") {
      if (verifyOnly) {
        throw new Error("--verify-only was supplied more than once");
      }
      verifyOnly = true;
    } else if (argument === "--help" || argument === "-h") {
      help = true;
    } else if (argument.startsWith("-")) {
      throw new Error(`unknown option: ${argument}`);
    } else {
      positional.push(argument);
    }
  }

  if (help) {
    return { help: true };
  }
  if (positional.length !== 3) {
    throw new Error(
      `expected <source-root> <r2-prefix> <output-dir>, received ${positional.length} positional argument(s)`,
    );
  }

  return {
    help: false,
    verifyOnly,
    sourceRoot: positional[0],
    r2Prefix: positional[1],
    outputDir: positional[2],
  };
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeR2Prefix(rawPrefix) {
  if (rawPrefix.includes("\0")) {
    throw new Error("R2 prefix must not contain a NUL byte");
  }

  const prefix = rawPrefix
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0)
    .join("/");

  if (!prefix) {
    throw new Error("R2 prefix must not be empty");
  }

  const invalidSegment = prefix
    .split("/")
    .find((segment) => segment === "." || segment === "..");
  if (invalidSegment) {
    throw new Error(`R2 prefix must not contain '${invalidSegment}' path segments`);
  }

  return prefix;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

async function canonicalizeProspectivePath(inputPath) {
  let cursor = path.resolve(inputPath);
  const missingSegments = [];

  while (true) {
    try {
      const existingRealPath = await realpath(cursor);
      return path.resolve(existingRealPath, ...missingSegments.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }

      const parent = path.dirname(cursor);
      if (parent === cursor) {
        throw new Error(`could not resolve an existing ancestor of ${path.resolve(inputPath)}`);
      }
      missingSegments.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function resolveSourceRoot(inputPath) {
  const absolutePath = path.resolve(inputPath);
  const sourceRealPath = await realpath(absolutePath).catch((error) => {
    throw new Error(`source root does not exist: ${absolutePath}`, { cause: error });
  });
  const sourceStat = await stat(sourceRealPath);
  if (!sourceStat.isDirectory()) {
    throw new Error(`source root is not a directory: ${sourceRealPath}`);
  }
  return sourceRealPath;
}

async function resolveOutputDir(inputPath, sourceRoot, create) {
  const prospectivePath = await canonicalizeProspectivePath(inputPath);
  if (isWithin(sourceRoot, prospectivePath)) {
    throw new Error(
      `output directory must not be the source root or one of its descendants: ${prospectivePath}`,
    );
  }

  if (create) {
    await mkdir(prospectivePath, { recursive: true });
  }

  const outputRealPath = await realpath(prospectivePath).catch((error) => {
    if (!create && error?.code === "ENOENT") {
      throw new Error(`output directory does not exist: ${prospectivePath}`, { cause: error });
    }
    throw error;
  });
  const outputStat = await stat(outputRealPath);
  if (!outputStat.isDirectory()) {
    throw new Error(`output path is not a directory: ${outputRealPath}`);
  }
  if (isWithin(sourceRoot, outputRealPath)) {
    throw new Error(
      `output directory resolves inside the source root and would pollute the manifest: ${outputRealPath}`,
    );
  }

  return outputRealPath;
}

function manifestName(extension) {
  return `r2-bulk-${extension}.json`;
}

function toR2RelativePath(relativePath) {
  const segments = relativePath.split(path.sep);
  if (
    segments.length === 0 ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`unsafe relative path: ${relativePath}`);
  }
  return segments.join("/");
}

async function collectSourceFiles(sourceRoot, r2Prefix) {
  const groups = new Map();
  const keyOwners = new Map();
  const unsupportedFiles = [];
  let objectCount = 0;
  let totalBytes = 0;

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareText(left.name, right.name));

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isSymbolicLink()) {
        throw new Error(`symbolic links and junctions are not allowed: ${entryPath}`);
      }
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`unsupported filesystem entry: ${entryPath}`);
      }

      // Re-check with lstat so a path swapped to a link during traversal cannot
      // silently redirect a manifest entry outside sourceRoot.
      const entryLstat = await lstat(entryPath);
      if (entryLstat.isSymbolicLink()) {
        throw new Error(`symbolic links and junctions are not allowed: ${entryPath}`);
      }

      const extension = path.extname(entry.name).slice(1).toLowerCase();
      if (!Object.hasOwn(EXTENSION_POLICIES, extension)) {
        unsupportedFiles.push(entryPath);
        continue;
      }

      const fileRealPath = await realpath(entryPath);
      if (!isWithin(sourceRoot, fileRealPath) || fileRealPath === sourceRoot) {
        throw new Error(`file resolves outside the source root: ${entryPath} -> ${fileRealPath}`);
      }

      const fileStat = await stat(fileRealPath);
      if (!fileStat.isFile()) {
        throw new Error(`manifest source is not a regular file: ${fileRealPath}`);
      }

      const sourceRelativePath = path.relative(sourceRoot, entryPath);
      const key = `${r2Prefix}/${toR2RelativePath(sourceRelativePath)}`;
      const previousOwner = keyOwners.get(key);
      if (previousOwner) {
        throw new Error(`duplicate R2 key '${key}' for ${previousOwner} and ${fileRealPath}`);
      }
      keyOwners.set(key, fileRealPath);

      let group = groups.get(extension);
      if (!group) {
        group = { extension, entries: [], bytes: 0 };
        groups.set(extension, group);
      }
      group.entries.push({ key, file: fileRealPath });
      group.bytes += fileStat.size;
      objectCount += 1;
      totalBytes += fileStat.size;
    }
  }

  await visit(sourceRoot);

  if (unsupportedFiles.length > 0) {
    unsupportedFiles.sort(compareText);
    const preview = unsupportedFiles.slice(0, 20).map((file) => `  - ${file}`).join("\n");
    const omitted = unsupportedFiles.length > 20 ? `\n  ... ${unsupportedFiles.length - 20} more` : "";
    throw new Error(
      `found ${unsupportedFiles.length} file(s) with unknown or missing extensions:\n${preview}${omitted}`,
    );
  }
  if (objectCount === 0) {
    throw new Error(`source root contains no supported files: ${sourceRoot}`);
  }

  for (const group of groups.values()) {
    group.entries.sort(
      (left, right) => compareText(left.key, right.key) || compareText(left.file, right.file),
    );
  }

  return {
    groups: new Map([...groups.entries()].sort(([left], [right]) => compareText(left, right))),
    objectCount,
    totalBytes,
  };
}

async function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function writeManifests(outputDir, sourceData) {
  const expectedNames = new Set();

  for (const [extension, group] of sourceData.groups) {
    const name = manifestName(extension);
    expectedNames.add(name);
    await atomicWriteJson(path.join(outputDir, name), group.entries);
  }

  const outputEntries = await readdir(outputDir, { withFileTypes: true });
  for (const entry of outputEntries) {
    if (
      entry.isFile() &&
      MANIFEST_NAME_PATTERN.test(entry.name) &&
      !expectedNames.has(entry.name)
    ) {
      await unlink(path.join(outputDir, entry.name));
    }
  }
}

function validateManifestEntry(entry, manifestPath, index) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${manifestPath}[${index}] must be an object`);
  }

  const propertyNames = Object.keys(entry).sort(compareText);
  if (propertyNames.length !== 2 || propertyNames[0] !== "file" || propertyNames[1] !== "key") {
    throw new Error(`${manifestPath}[${index}] must contain exactly the 'key' and 'file' properties`);
  }
  if (typeof entry.key !== "string" || !entry.key) {
    throw new Error(`${manifestPath}[${index}].key must be a non-empty string`);
  }
  if (typeof entry.file !== "string" || !entry.file || !path.isAbsolute(entry.file)) {
    throw new Error(`${manifestPath}[${index}].file must be an absolute path`);
  }
}

function firstDifference(expected, actual) {
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index += 1) {
    const expectedEntry = expected[index];
    const actualEntry = actual[index];
    if (
      !expectedEntry ||
      !actualEntry ||
      expectedEntry.key !== actualEntry.key ||
      expectedEntry.file !== actualEntry.file
    ) {
      return { index, expectedEntry, actualEntry };
    }
  }
  return null;
}

async function verifyManifests(outputDir, sourceData) {
  const expectedNames = [...sourceData.groups.keys()].map(manifestName).sort(compareText);
  const outputEntries = await readdir(outputDir, { withFileTypes: true });
  const actualNames = outputEntries
    .filter((entry) => entry.isFile() && MANIFEST_NAME_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareText);

  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    const expectedSet = new Set(expectedNames);
    const actualSet = new Set(actualNames);
    const missing = expectedNames.filter((name) => !actualSet.has(name));
    const unexpected = actualNames.filter((name) => !expectedSet.has(name));
    throw new Error(
      `manifest set does not match source directory` +
        `${missing.length ? `; missing: ${missing.join(", ")}` : ""}` +
        `${unexpected.length ? `; unexpected: ${unexpected.join(", ")}` : ""}`,
    );
  }

  const seenKeys = new Map();
  for (const [extension, group] of sourceData.groups) {
    const manifestPath = path.join(outputDir, manifestName(extension));
    let actual;
    try {
      actual = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      throw new Error(`could not parse manifest ${manifestPath}: ${error.message}`, { cause: error });
    }
    if (!Array.isArray(actual)) {
      throw new Error(`manifest must contain a JSON array: ${manifestPath}`);
    }

    for (let index = 0; index < actual.length; index += 1) {
      validateManifestEntry(actual[index], manifestPath, index);
      const priorManifest = seenKeys.get(actual[index].key);
      if (priorManifest) {
        throw new Error(
          `duplicate key '${actual[index].key}' in ${priorManifest} and ${manifestPath}`,
        );
      }
      seenKeys.set(actual[index].key, manifestPath);
    }

    const difference = firstDifference(group.entries, actual);
    if (difference) {
      throw new Error(
        `${manifestPath} does not exactly match the source directory at index ${difference.index}; ` +
          `expected ${JSON.stringify(difference.expectedEntry ?? null)}, ` +
          `received ${JSON.stringify(difference.actualEntry ?? null)}`,
      );
    }
  }
}

function quoteCommandArgument(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function printSummary(mode, sourceRoot, r2Prefix, outputDir, sourceData) {
  console.log(`${mode === "verify" ? "Verified" : "Generated and verified"} R2 bulk manifests.`);
  console.log(`Source: ${sourceRoot}`);
  console.log(`R2 prefix: ${r2Prefix}`);
  console.log(`Output: ${outputDir}`);
  console.log(
    `Total: ${sourceData.objectCount.toLocaleString("en-US")} object(s), ${sourceData.totalBytes.toLocaleString("en-US")} bytes`,
  );

  for (const [extension, group] of sourceData.groups) {
    const policy = EXTENSION_POLICIES[extension];
    const manifestPath = path.join(outputDir, manifestName(extension));
    console.log("");
    console.log(
      `[${extension}] ${group.entries.length.toLocaleString("en-US")} object(s), ${group.bytes.toLocaleString("en-US")} bytes`,
    );
    console.log(`Manifest: ${manifestPath}`);
    console.log(`Content-Type: ${policy.contentType}`);
    console.log(`Cache-Control: ${policy.cacheControl}`);
    console.log("Recommended command:");
    console.log(
      `  npx wrangler r2 bulk put "<bucket-name>" --filename ${quoteCommandArgument(manifestPath)} --remote --concurrency 16 --content-type ${quoteCommandArgument(policy.contentType)} --cache-control ${quoteCommandArgument(policy.cacheControl)}`,
    );
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const sourceRoot = await resolveSourceRoot(options.sourceRoot);
  const outputDir = await resolveOutputDir(options.outputDir, sourceRoot, !options.verifyOnly);
  const r2Prefix = normalizeR2Prefix(options.r2Prefix);
  const sourceData = await collectSourceFiles(sourceRoot, r2Prefix);

  if (!options.verifyOnly) {
    await writeManifests(outputDir, sourceData);
  }
  await verifyManifests(outputDir, sourceData);
  printSummary(options.verifyOnly ? "verify" : "generate", sourceRoot, r2Prefix, outputDir, sourceData);
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
});
