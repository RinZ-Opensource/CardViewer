import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = path.resolve(projectRoot, "public");
const publicAssetPolicy = JSON.parse(
  readFileSync(path.resolve(projectRoot, "public-asset-policy.json"), "utf8"),
) as { allowedPublicFiles: string[] };
const allowedPublicFiles = new Set(publicAssetPolicy.allowedPublicFiles);

function collectPublicFiles(root: string) {
  if (!existsSync(root)) return [];

  const pending = [root];
  const files: Array<{ path: string; regular: boolean }> = [];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.resolve(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else {
        // Files, symlinks and special entries can all become public output.
        files.push({
          path: path.relative(publicRoot, entryPath).split(path.sep).join("/"),
          regular: entry.isFile(),
        });
      }
    }
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function assertPublicAssetsAreReviewed(command: "build" | "serve") {
  const actualEntries = collectPublicFiles(publicRoot);
  const actualSet = new Set(
    actualEntries.filter((entry) => entry.regular).map((entry) => entry.path),
  );
  const unexpected = actualEntries.filter(
    (entry) => !entry.regular || !allowedPublicFiles.has(entry.path),
  );
  const missing = [...allowedPublicFiles].filter((file) => !actualSet.has(file)).sort();
  if (unexpected.length === 0 && missing.length === 0) return;

  const visibleLimit = 12;
  const findings = [
    ...unexpected.map(
      (entry) =>
        `  - ${entry.regular ? "unexpected" : "non-regular"}: public/${entry.path}`,
    ),
    ...missing.map((file) => `  - missing: public/${file}`),
  ];
  const visibleFindings = findings.slice(0, visibleLimit);
  if (findings.length > visibleLimit) {
    visibleFindings.push(`  - ... and ${findings.length - visibleLimit} more`);
  }

  const action = command === "build" ? "build the public deployment" : "start the public dev server";
  throw new Error(
    [
      `[cardviewer-public-assets] Refusing to ${action} with an unreviewed public/ tree.`,
      "Vite copies every file under public/, including Git-ignored credentials and local assets.",
      "Update public-asset-policy.json only after reviewing an intentional static-file change:",
      ...visibleFindings,
    ].join("\n"),
  );
}

export default defineConfig(({ command }) => {
  // Every supported invocation builds or serves the public Cloudflare surface.
  // Local official assets are produced outside this repository and are never
  // mounted into Vite.
  assertPublicAssetsAreReviewed(command);

  return {
    plugins: [react()],
    clearScreen: false,
    server: {
      strictPort: true,
    },
  };
});
