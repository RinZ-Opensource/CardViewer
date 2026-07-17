// Reviewed public-object contract for the shared R2 bucket. This module is
// intentionally free of Cloudflare runtime dependencies so routing decisions
// can be tested without a binding, cache, Request, or Response implementation.

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const CARD_GAMES = new Set(["chu", "mai", "mu3"]);
const SCORECARD_GAMES = new Set(["mai", "chuni", "ongeki"]);
const PUBLIC_CARD_MANIFEST_FILES = new Set([
  "cards.json",
  "cards.index.json",
  "cards.chu.json",
  "cards.mai.json",
  "cards.mu3.json",
]);
const PUBLIC_SCORECARD_MANIFEST_FILES = new Set([
  "mai/manifest.json",
  "chuni/manifest.json",
  "chuni/manifest_musicbox.json",
  "ongeki/manifest.json",
  "ongeki/manifest_musicbt.json",
]);
const PUBLIC_FONT_FILES = new Set([
  "ZenKakuGothicNew-Black.ttf",
  "ZenKakuGothicNew-Bold.ttf",
  "ZenKakuGothicNew-Regular.ttf",
  "ZenMaruGothic-Black.ttf",
  "ZenMaruGothic-Bold.ttf",
  "ZenMaruGothic-Medium.ttf",
  "ZenMaruGothic-Regular.ttf",
]);
const PUBLIC_FONT_LICENSE_FILES = new Set([
  "OFL-ZenKakuGothicNew.txt",
  "OFL-ZenMaruGothic.txt",
]);
const SONGDB_GAMES = new Set(["maimai", "chunithm", "ongeki"]);
const SONGDB_IMAGE_FILE = /^[A-Za-z0-9_.-]+\.(?:png|jpg|jpeg|webp)$/i;
const GENERATED_SHARD_FILE = /^cards-[A-Za-z0-9][A-Za-z0-9_-]*\.json$/;
const RUNTIME_FONT_FILE = /^FONT_[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:json|png)$/;
const VERSION_DIRECTORY = /^v[1-9]\d*$/;
const SENSITIVE_PATH_SEGMENTS = new Set([
  "credential",
  "credentials",
  "private",
  "secret",
  "secrets",
]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function fileExtension(file) {
  const extensionAt = file.lastIndexOf(".");
  return extensionAt > 0 ? file.slice(extensionAt).toLowerCase() : "";
}

function hasSensitiveLeafName(file) {
  const extensionAt = file.lastIndexOf(".");
  const stem = (extensionAt > 0 ? file.slice(0, extensionAt) : file).toLowerCase();
  return SENSITIVE_PATH_SEGMENTS.has(stem);
}

function hasSensitiveNameToken(file) {
  const extensionAt = file.lastIndexOf(".");
  const stem = (extensionAt > 0 ? file.slice(0, extensionAt) : file).toLowerCase();
  return stem.split(/[._-]+/).some((token) => SENSITIVE_PATH_SEGMENTS.has(token));
}

function hasAllowedExtension(file, extensions) {
  return !hasSensitiveLeafName(file) && extensions.has(fileExtension(file));
}

function officialKey(relativeSegments) {
  return ["official", ...relativeSegments].join("/");
}

function generatedObjectKey(relativeSegments) {
  const [, ...path] = relativeSegments;
  if (path.length === 1 && PUBLIC_CARD_MANIFEST_FILES.has(path[0])) {
    return officialKey(relativeSegments);
  }
  if (
    path.length === 2 &&
    path[0] === "shards" &&
    !hasSensitiveNameToken(path[1]) &&
    GENERATED_SHARD_FILE.test(path[1])
  ) {
    return officialKey(relativeSegments);
  }

  const isGameAsset =
    path.length === 3 && path[0] === "assets" && CARD_GAMES.has(path[1]);
  const isThumbnailAsset =
    path.length === 4 &&
    path[0] === "assets" &&
    path[1] === "thumbs" &&
    CARD_GAMES.has(path[2]);
  if (
    (isGameAsset || isThumbnailAsset) &&
    !hasSensitiveNameToken(path.at(-1)) &&
    hasAllowedExtension(path.at(-1), IMAGE_EXTENSIONS)
  ) {
    return officialKey(relativeSegments);
  }
  return null;
}

function scorecardObjectKey(relativeSegments) {
  const [, game, ...path] = relativeSegments;
  if (!SCORECARD_GAMES.has(game)) return null;

  if (
    path.length === 1 &&
    (hasAllowedExtension(path[0], IMAGE_EXTENSIONS) ||
      PUBLIC_SCORECARD_MANIFEST_FILES.has(`${game}/${path[0]}`))
  ) {
    return officialKey(relativeSegments);
  }

  if (path[0] === "jackets") {
    const isMap = path.length === 2 && path[1] === "jacket-map.json";
    const isLegacyJacket =
      path.length === 2 && hasAllowedExtension(path[1], IMAGE_EXTENSIONS);
    const isVersionedJacket =
      path.length === 3 &&
      VERSION_DIRECTORY.test(path[1]) &&
      hasAllowedExtension(path[2], IMAGE_EXTENSIONS);
    if (isMap || isLegacyJacket || isVersionedJacket) {
      return officialKey(relativeSegments);
    }
  }

  if (game === "ongeki" && path[0] === "boss") {
    const isMap = path.length === 2 && path[1] === "boss-map.json";
    const isVersionedIcon =
      path.length === 3 &&
      VERSION_DIRECTORY.test(path[1]) &&
      hasAllowedExtension(path[2], IMAGE_EXTENSIONS);
    if (isMap || isVersionedIcon) return officialKey(relativeSegments);
  }
  return null;
}

function runtimeObjectKey(relativeSegments) {
  const [, version, assetClass, ...path] = relativeSegments;
  if (version !== "v1" || assetClass !== "runtime") return null;
  if (path.length === 1) {
    const file = path[0];
    const isDirectImage =
      !hasSensitiveNameToken(file) && hasAllowedExtension(file, IMAGE_EXTENSIONS);
    const isDirectFontData =
      !hasSensitiveNameToken(file) && RUNTIME_FONT_FILE.test(file);
    if (isDirectImage || isDirectFontData) return officialKey(relativeSegments);
  }
  if (
    path.length === 2 &&
    path[0] === "fonts" &&
    !hasSensitiveNameToken(path[1]) &&
    RUNTIME_FONT_FILE.test(path[1])
  ) {
    return officialKey(relativeSegments);
  }
  return null;
}

function redistributableFontObjectKey(relativeSegments) {
  const [root, version, assetClass, fontClass, file] = relativeSegments;
  if (
    relativeSegments.length !== 5 ||
    root !== "cardviewer" ||
    version !== "v1" ||
    assetClass !== "fonts"
  ) {
    return null;
  }
  if (
    (fontClass === "zen" && PUBLIC_FONT_FILES.has(file)) ||
    (fontClass === "licenses" && PUBLIC_FONT_LICENSE_FILES.has(file))
  ) {
    return officialKey(relativeSegments);
  }
  return null;
}

function songdbObjectKey(relativeSegments) {
  const [, songdbClass, game, file] = relativeSegments;
  if (relativeSegments.length !== 4 || !SONGDB_GAMES.has(game)) return null;
  if (songdbClass === "data" && file === "music-ex.json") {
    return `songdb/data/${game}/${file}`;
  }
  if (
    (songdbClass === "jackets" || songdbClass === "hd-jackets") &&
    !hasSensitiveLeafName(file) &&
    SONGDB_IMAGE_FILE.test(file)
  ) {
    return `songdb/${songdbClass}/${game}/${file}`;
  }
  return null;
}

function rawPathname(rawUrl) {
  const match = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*(\/[^?#]*)?(?:[?#].*)?$/i.exec(rawUrl);
  return match ? match[1] || "/" : null;
}

export function publicObjectKey(rawUrl) {
  const pathname = rawPathname(rawUrl);
  if (!pathname) return null;

  const rawSegments = pathname.split("/");
  if (rawSegments[0] !== "" || rawSegments[1] !== "official") return null;

  const relativeSegments = [];
  for (const rawSegment of rawSegments.slice(2)) {
    if (!rawSegment) return null;

    let segment;
    try {
      segment = decodeURIComponent(rawSegment);
    } catch {
      return null;
    }

    if (
      !segment ||
      segment.startsWith(".") ||
      SENSITIVE_PATH_SEGMENTS.has(segment.toLowerCase()) ||
      segment.includes("/") ||
      segment.includes("\\") ||
      segment.includes("%") ||
      segment.includes("?") ||
      segment.includes("#") ||
      CONTROL_CHARACTERS.test(segment)
    ) {
      return null;
    }

    relativeSegments.push(segment);
  }

  if (relativeSegments.length === 0) return null;
  const [root, , assetClass] = relativeSegments;
  if (root === "generated") return generatedObjectKey(relativeSegments);
  if (root === "scorecard") return scorecardObjectKey(relativeSegments);
  if (root === "songdb") return songdbObjectKey(relativeSegments);
  if (root === "cardviewer" && assetClass === "runtime") {
    return runtimeObjectKey(relativeSegments);
  }
  if (root === "cardviewer" && assetClass === "fonts") {
    return redistributableFontObjectKey(relativeSegments);
  }
  return null;
}
