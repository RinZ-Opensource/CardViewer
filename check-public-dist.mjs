import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const distRoot = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.resolve(projectRoot, "dist");

const forbiddenRoots = [
  path.resolve(distRoot, "official"),
  path.resolve(distRoot, "fonts", "private"),
];

function findForbiddenFiles(root) {
  if (!existsSync(root)) return [];

  const pending = [root];
  const forbidden = [];

  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.resolve(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else {
        // Treat every file, symlink and other special entry as a leak.
        forbidden.push(entryPath);
      }
    }
  }

  return forbidden;
}

if (!existsSync(distRoot) || !statSync(distRoot).isDirectory()) {
  console.error(
    `[cardviewer-public-dist] Cannot verify public output because the dist directory does not exist: ${distRoot}`,
  );
  process.exit(1);
}

const forbidden = forbiddenRoots.flatMap(findForbiddenFiles);

if (forbidden.length > 0) {
  console.error(
    `[cardviewer-public-dist] Public output contains ${forbidden.length} forbidden official/private asset file(s):`,
  );
  const visibleLimit = 20;
  for (const filePath of forbidden.slice(0, visibleLimit)) {
    console.error(`  - ${path.relative(distRoot, filePath).split(path.sep).join("/")}`);
  }
  if (forbidden.length > visibleLimit) {
    console.error(`  - ... and ${forbidden.length - visibleLimit} more`);
  }
  console.error("Refusing to treat this directory as a deployable public artifact.");
  process.exit(1);
}

console.log(`[cardviewer-public-dist] PASS: ${distRoot} contains no forbidden official/private assets.`);
