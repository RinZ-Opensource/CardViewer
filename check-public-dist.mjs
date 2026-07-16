import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const distRoot = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(projectRoot, "dist");

const publicAssetPolicy = JSON.parse(
  readFileSync(path.resolve(projectRoot, "public-asset-policy.json"), "utf8"),
);
const allowedFiles = new Set([
  ...publicAssetPolicy.allowedPublicFiles,
  ...publicAssetPolicy.allowedGeneratedDistFiles,
]);
const allowedPatterns = publicAssetPolicy.allowedGeneratedDistPatterns.map(
  (pattern) => new RegExp(pattern),
);

function collectOutputFiles(root) {
  if (!existsSync(root)) return [];

  const pending = [root];
  const files = [];

  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.resolve(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else {
        // Treat symlinks and special entries as files that require review.
        files.push({
          path: path.relative(distRoot, entryPath).split(path.sep).join("/"),
          regular: entry.isFile(),
        });
      }
    }
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

if (!existsSync(distRoot) || !statSync(distRoot).isDirectory()) {
  console.error(
    `[cardviewer-public-dist] Cannot verify public output because the dist directory does not exist: ${distRoot}`,
  );
  process.exit(1);
}

const outputEntries = collectOutputFiles(distRoot);
const regularPaths = new Set(
  outputEntries.filter((entry) => entry.regular).map((entry) => entry.path),
);
const unexpected = outputEntries.filter(
  (entry) =>
    !entry.regular ||
    (!allowedFiles.has(entry.path) &&
      !allowedPatterns.some((pattern) => pattern.test(entry.path))),
);
const missingFiles = [...allowedFiles].filter((file) => !regularPaths.has(file)).sort();
const missingPatterns = allowedPatterns.filter(
  (pattern) => ![...regularPaths].some((file) => pattern.test(file)),
);

if (unexpected.length > 0 || missingFiles.length > 0 || missingPatterns.length > 0) {
  console.error(
    `[cardviewer-public-dist] Public output does not match the reviewed artifact policy:`,
  );
  const visibleLimit = 20;
  const findings = [
    ...unexpected.map(
      (entry) =>
        `unexpected: ${entry.path}${entry.regular ? "" : " (non-regular entry)"}`,
    ),
    ...missingFiles.map((file) => `missing: ${file}`),
    ...missingPatterns.map((pattern) => `missing generated match: ${pattern}`),
  ];
  for (const finding of findings.slice(0, visibleLimit)) {
    console.error(`  - ${finding}`);
  }
  if (findings.length > visibleLimit) {
    console.error(`  - ... and ${findings.length - visibleLimit} more`);
  }
  console.error("Refusing to treat this directory as a deployable public artifact.");
  process.exit(1);
}

console.log(`[cardviewer-public-dist] PASS: ${distRoot} contains only reviewed public output paths.`);
