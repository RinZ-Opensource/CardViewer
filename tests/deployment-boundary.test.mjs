import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

const forbiddenPrefixes = new Map([
  ["src-tauri/", "DESKTOP_TOOLING"],
  ["mobile/", "MOBILE_PROTOTYPE"],
  ["private-assets/", "PRIVATE_ASSETS"],
  ["public/fonts/private/", "PRIVATE_FONT_STATIC_ASSETS"],
  ["scripts/scorecard-extract/", "SOURCE_EXTRACTION_TOOLING"],
]);

const forbiddenPaths = new Map([
  [".env.private", "PRIVATE_MODE_ENV"],
  [".env.public", "DEPLOYMENT_ENV_FILE"],
  ["Cargo.lock", "RUST_TOOLCHAIN"],
  ["Cargo.toml", "RUST_TOOLCHAIN"],
  ["global.json", "DOTNET_TOOLCHAIN"],
  ["rust-toolchain.toml", "RUST_TOOLCHAIN"],
  ["rustfmt.toml", "RUST_TOOLCHAIN"],
  ["docs/cardmaker-mobile-android-plan.md", "MOBILE_DOCUMENTATION"],
  ["docs/mobile-pack.md", "MOBILE_DOCUMENTATION"],
]);

const forbiddenBinaryAssetPattern =
  /\.(?:png|jpe?g|webp|gif|avif|bmp|ico|tiff?|ttf|otf|woff2?|dds|ktx2?|psd|mp3|wav|ogg|flac|aac|m4a|mp4|webm|mov|avi|mkv)$/i;

const maintainedBoundaryDocs = [
  "README.md",
  "docs/online-preview.md",
  "docs/repository-map.md",
  "workers/songdb-sync/README.md",
];

function pathViolation(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  const exact = forbiddenPaths.get(normalized);
  if (exact) return exact;

  for (const [prefix, rule] of forbiddenPrefixes) {
    if (normalized.startsWith(prefix)) return rule;
  }

  if (/^src\/exportPng\.(?:[cm]?[jt]sx?)$/i.test(normalized)) {
    return "FRONTEND_EXPORT_PNG";
  }

  if (forbiddenBinaryAssetPattern.test(normalized)) {
    return "TRACKED_BINARY_ASSET";
  }

  return null;
}

function frontendContentViolations(source) {
  const violations = [];
  if (/@tauri-apps(?:\/|["'])/.test(source)) {
    violations.push("FRONTEND_TAURI_IMPORT");
  }
  if (
    /(?:from\s*|import\s*\(\s*)["'][^"']*exportPng(?:\.[^"']*)?["']/i.test(source)
  ) {
    violations.push("FRONTEND_EXPORT_PNG_IMPORT");
  }
  if (/VITE_DEPLOYMENT_MODE/.test(source)) {
    violations.push("FRONTEND_MUTABLE_DEPLOYMENT_MODE");
  }
  return violations;
}

function trackedExistingPaths() {
  const result = spawnSync("git", ["ls-files", "--cached", "-z"], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  return result.stdout
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.replaceAll("\\", "/"))
    // During a local cleanup, Git continues to call an unstaged deletion
    // "tracked". CI checks a committed tree, while this filter lets the same
    // test validate the intended post-deletion working tree before staging.
    .filter((entry) => existsSync(path.join(projectRoot, ...entry.split("/"))));
}

test("deployment path rules reject local product and toolchain scopes", () => {
  const fixtures = [
    "src-tauri/Cargo.toml",
    "mobile/Runtime.cs",
    "private-assets/official/card.png",
    "public/fonts/private/licensed.ttf",
    "scripts/scorecard-extract/tool.py",
    ".env.private",
    ".env.public",
    "global.json",
    "rust-toolchain.toml",
    "docs/mobile-pack.md",
    "docs/cardmaker-mobile-android-plan.md",
    "src/exportPng.ts",
    "public/runtime/card.png",
    "src/assets/fallback.webp",
    "public/fonts/zen/open-font.woff2",
    "public/media/preview.mp4",
  ];

  for (const fixture of fixtures) {
    assert.ok(pathViolation(fixture), `expected a deployment-boundary rule for ${fixture}`);
  }
  assert.equal(pathViolation("src/App.tsx"), null);
  assert.equal(pathViolation("src/cardAssets.ts"), null);
  assert.equal(pathViolation("src/fonts.ts"), null);
  assert.equal(pathViolation("src/holoMaskMath.ts"), null);
  assert.equal(pathViolation("src/holoMaskTypes.ts"), null);
  assert.equal(pathViolation("src/layers.tsx"), null);
  assert.equal(pathViolation("src/textRendering.ts"), null);
  assert.equal(pathViolation("scripts/cloudflare/prepare_r2_bulk_manifest.mjs"), null);
});

test("deployment retains an explicit fail-closed private font route", () => {
  const relativePath = "functions/fonts/private/[[path]].js";

  assert.equal(pathViolation(relativePath), null);
  assert.equal(existsSync(path.join(projectRoot, ...relativePath.split("/"))), true);
});

test("frontend content rules reject desktop and PNG-export coupling", () => {
  assert.deepEqual(
    frontendContentViolations('import { invoke } from "@tauri-apps/api/core";'),
    ["FRONTEND_TAURI_IMPORT"],
  );
  assert.deepEqual(
    frontendContentViolations('import { exportNode } from "./exportPng";'),
    ["FRONTEND_EXPORT_PNG_IMPORT"],
  );
  assert.deepEqual(
    frontendContentViolations("const mode = import.meta.env.VITE_DEPLOYMENT_MODE;"),
    ["FRONTEND_MUTABLE_DEPLOYMENT_MODE"],
  );
  assert.deepEqual(frontendContentViolations('import React from "react";'), []);
});

test("tracked deployment repository stays Cloudflare-only", () => {
  const paths = trackedExistingPaths();
  const findings = [];

  for (const relativePath of paths) {
    const rule = pathViolation(relativePath);
    if (rule) findings.push(`${rule}: ${relativePath}`);

    if (/^src\/.*\.[cm]?[jt]sx?$/i.test(relativePath)) {
      const source = readFileSync(
        path.join(projectRoot, ...relativePath.split("/")),
        "utf8",
      );
      for (const contentRule of frontendContentViolations(source)) {
        findings.push(`${contentRule}: ${relativePath}`);
      }
    }
  }

  const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const dependencyNames = Object.keys({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  });
  for (const dependency of ["@tauri-apps/api", "@tauri-apps/cli", "html-to-image"]) {
    if (dependencyNames.includes(dependency)) {
      findings.push(`FORBIDDEN_DEPENDENCY: ${dependency}`);
    }
  }

  const packageLock = JSON.parse(
    readFileSync(path.join(projectRoot, "package-lock.json"), "utf8"),
  );
  for (const dependency of ["@tauri-apps/api", "@tauri-apps/cli", "html-to-image"]) {
    if (packageLock.packages?.[`node_modules/${dependency}`]) {
      findings.push(`FORBIDDEN_LOCKFILE_PACKAGE: ${dependency}`);
    }
  }

  for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
    if (/(?:private|tauri|rust|mobile|export)/i.test(name)) {
      findings.push(`FORBIDDEN_SCRIPT_NAME: ${name}`);
    }
    if (/(?:src-tauri|\btauri\b|\bcargo\b|\bdotnet\b|mobile\/)/i.test(String(command))) {
      findings.push(`FORBIDDEN_SCRIPT_COMMAND: ${name}`);
    }
  }

  for (const relativePath of maintainedBoundaryDocs) {
    const absolutePath = path.join(projectRoot, ...relativePath.split("/"));
    if (!existsSync(absolutePath)) continue;
    const source = readFileSync(absolutePath, "utf8");
    if (/(?:src-tauri\/|mobile\/|private-assets\/|scripts\/scorecard-extract\/|\.env\.private|\bTauri\b)/i.test(source)) {
      findings.push(`STALE_BOUNDARY_DOCUMENTATION: ${relativePath}`);
    }
  }

  assert.deepEqual(findings, []);
});
