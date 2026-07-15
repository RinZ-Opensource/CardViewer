#!/usr/bin/env node
// Bulk-upload a local folder of high-res jackets to the songdb/hd-jackets/{game}/
// prefix of the existing CardViewer R2 bucket via `wrangler r2 object put`
// (the worker serves them as /hd-jackets/{game}/{file}).
//
// Usage (from workers/songdb-sync):
//   node scripts/upload-hd-jackets.mjs <maimai|chunithm|ongeki> <folder>
//        --bucket <your-existing-cardviewer-bucket> [--local] [--dry-run]
//
// File names must match the otoge-db jacket file name for the song (the
// hashed `image`/`image_url` value in music-ex.json, e.g. 30eb032b16877275.png)
// — that is the key the app's /hd-jackets URL is built from. Game-extracted
// art under private-assets/official/scorecard/{game}/ uses game-native names
// (jacket_11818.png, UI_Jacket_0001.png, ...), so rename/map it first.

import { readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";

const GAMES = new Set(["maimai", "chunithm", "ongeki"]);
const JACKET_FILE = /^[A-Za-z0-9_.-]+\.(png|jpg|jpeg|webp)$/;
const CONTENT_TYPE = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith("--"));
const [game, folder] = positional;
const dryRun = args.includes("--dry-run");
// --local targets the `wrangler dev` simulated bucket instead of production.
const remoteFlag = args.includes("--local") ? "--local" : "--remote";
const bucketIndex = args.indexOf("--bucket");
const bucket = bucketIndex >= 0 ? args[bucketIndex + 1] : undefined;

if (!GAMES.has(game) || !folder || !bucket) {
  console.error(
    "usage: node scripts/upload-hd-jackets.mjs <maimai|chunithm|ongeki> <folder> --bucket <name> [--local] [--dry-run]",
  );
  process.exit(1);
}

const files = readdirSync(folder).filter((name) => JACKET_FILE.test(name));
if (files.length === 0) {
  console.error(`no jacket files (*.png/jpg/jpeg/webp) found in ${folder}`);
  process.exit(1);
}

let failed = 0;
for (const name of files) {
  // songdb/ namespaces the worker's keys inside the shared CardViewer bucket.
  const key = `${bucket}/songdb/hd-jackets/${game}/${name}`;
  const contentType = CONTENT_TYPE[extname(name).toLowerCase()];
  console.log(`${dryRun ? "[dry-run] " : ""}put ${key}`);
  if (dryRun) continue;
  const result = spawnSync(
    "npx",
    ["wrangler", "r2", "object", "put", key, "--file", join(folder, name), "--content-type", contentType, remoteFlag],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  if (result.status !== 0) failed += 1;
}

console.log(`done: ${files.length - failed}/${files.length} uploaded${failed ? `, ${failed} failed` : ""}`);
process.exit(failed ? 1 : 0);
