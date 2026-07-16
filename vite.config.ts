import { createReadStream, cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const privateAssetsRoot = path.resolve(projectRoot, "private-assets");

const forbiddenPublicAssetRoots = [
  path.resolve(projectRoot, "public", "official"),
  path.resolve(projectRoot, "public", "fonts", "private"),
];

const privateAssetRoutes = [
  { route: "/official/", source: "official", out: "official" },
  { route: "/fonts/private/", source: path.join("fonts", "fot"), out: path.join("fonts", "private") },
];

function isEnabledFlag(value: string | undefined) {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function isInside(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function findForbiddenPublicAssets(root: string) {
  if (!existsSync(root)) return [];

  const pending = [root];
  const forbidden: string[] = [];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.resolve(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else {
        // Files, symlinks and other special entries are all forbidden: Vite may
        // copy them even though Git ignores the public asset directory.
        forbidden.push(entryPath);
      }
    }
  }

  return forbidden;
}

function assertPublicAssetsAreIsolated(command: "build" | "serve") {
  const forbidden = forbiddenPublicAssetRoots.flatMap(findForbiddenPublicAssets);
  if (forbidden.length === 0) return;

  const visibleLimit = 12;
  const visibleFiles = forbidden.slice(0, visibleLimit).map((filePath) => {
    const relative = path.relative(projectRoot, filePath).split(path.sep).join("/");
    return `  - ${relative}`;
  });
  if (forbidden.length > visibleLimit) {
    visibleFiles.push(`  - ... and ${forbidden.length - visibleLimit} more`);
  }

  const action = command === "build" ? "build the public deployment" : "start the public dev server";
  throw new Error(
    [
      `[cardviewer-public-assets] Refusing to ${action}.`,
      "Vite copies everything under public/ into the output, including Git-ignored files.",
      "Move official assets to private-assets/ (or remove the local public copies) before continuing:",
      ...visibleFiles,
    ].join("\n"),
  );
}

function contentType(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".otf":
      return "font/otf";
    case ".ttf":
      return "font/ttf";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}

function shouldCopyPrivateAsset(
  mapping: (typeof privateAssetRoutes)[number],
  sourceRoot: string,
  sourcePath: string,
  copyGeneratedAssets: boolean,
) {
  if (mapping.source !== "official" || copyGeneratedAssets) return true;
  const relative = path.relative(sourceRoot, sourcePath);
  if (relative === "") return true;
  return relative.split(path.sep)[0] !== "generated";
}

function privateAssetsPlugin(
  enabled: boolean,
  command: "build" | "serve",
  copyGeneratedAssets: boolean,
): Plugin {
  return {
    name: "cardviewer-private-assets",
    configureServer(server) {
      if (!enabled) return;
      server.middlewares.use((request, response, next) => {
        if (!request.url) {
          next();
          return;
        }

        const rawPath = request.url.split("?")[0] ?? "";
        let requestPath = "";
        try {
          requestPath = decodeURIComponent(rawPath);
        } catch {
          next();
          return;
        }

        const mapping = privateAssetRoutes.find(({ route }) => requestPath.startsWith(route));
        if (!mapping) {
          next();
          return;
        }

        const sourceRoot = path.resolve(privateAssetsRoot, mapping.source);
        const relativePath = requestPath.slice(mapping.route.length);
        const filePath = path.resolve(sourceRoot, relativePath);

        if (!isInside(sourceRoot, filePath) || !existsSync(filePath) || !statSync(filePath).isFile()) {
          next();
          return;
        }

        response.setHeader("Content-Type", contentType(filePath));
        createReadStream(filePath).pipe(response);
      });
    },
    closeBundle() {
      if (!enabled || command !== "build") return;
      const outDir = path.resolve(projectRoot, "dist");
      for (const mapping of privateAssetRoutes) {
        const sourceRoot = path.resolve(privateAssetsRoot, mapping.source);
        if (!existsSync(sourceRoot)) continue;
        const targetRoot = path.resolve(outDir, mapping.out);
        mkdirSync(path.dirname(targetRoot), { recursive: true });
        cpSync(sourceRoot, targetRoot, {
          recursive: true,
          filter: (sourcePath) =>
            shouldCopyPrivateAsset(mapping, sourceRoot, sourcePath, copyGeneratedAssets),
        });
      }
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, projectRoot, "");
  const deploymentMode = env.VITE_DEPLOYMENT_MODE ?? (mode === "public" ? "public" : "private");
  // `--mode public` must stay fail-closed even if a local environment file
  // accidentally asks for the private deployment mode.
  const publicDeployment = mode === "public" || deploymentMode === "public";
  const privateAssetsEnabled = !publicDeployment;
  const copyGeneratedAssets = isEnabledFlag(env.CARDVIEWER_COPY_GENERATED_ASSETS);

  if (publicDeployment) {
    assertPublicAssetsAreIsolated(command);
  }

  return {
    plugins: [react(), privateAssetsPlugin(privateAssetsEnabled, command, copyGeneratedAssets)],
    clearScreen: false,
    server: {
      strictPort: true,
      watch: {
        ignored: ["**/src-tauri/target/**"],
      },
    },
  };
});
