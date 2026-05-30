import { createReadStream, cpSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const privateAssetsRoot = path.resolve(projectRoot, "private-assets");

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
  const privateAssetsEnabled = deploymentMode !== "public";
  const copyGeneratedAssets = isEnabledFlag(env.CARDVIEWER_COPY_GENERATED_ASSETS);

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
