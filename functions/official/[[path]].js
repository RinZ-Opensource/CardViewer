// Cloudflare Pages Function: serve the reviewed public subset of /official/*
// from the ASSETS_BUCKET R2 binding. Prefixes alone are not a sufficient
// boundary because the source bucket also contains scripts and diagnostic
// files, so every request must pass both a path allowlist and an extension
// allowlist before R2 is consulted.

const MEDIA_EXTENSIONS = new Set([".json", ".png", ".jpg", ".jpeg", ".webp"]);
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
const CONTENT_TYPES = new Map([
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ttf", "font/ttf"],
  [".txt", "text/plain; charset=utf-8"],
]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function rawPathname(rawUrl) {
  const match = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*(\/[^?#]*)?(?:[?#].*)?$/i.exec(rawUrl);
  return match ? match[1] || "/" : null;
}

function publicObjectKey(rawUrl) {
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

  const leaf = relativeSegments.at(-1);
  const extensionAt = leaf.lastIndexOf(".");
  if (extensionAt <= 0) return null;

  const extension = leaf.slice(extensionAt).toLowerCase();
  const [root, version, assetClass] = relativeSegments;
  if (root === "songdb") {
    const [, songdbClass, game, file] = relativeSegments;
    if (relativeSegments.length !== 4 || !SONGDB_GAMES.has(game)) return null;
    if (songdbClass === "data" && file === "music-ex.json") {
      return `songdb/data/${game}/${file}`;
    }
    if (
      (songdbClass === "jackets" || songdbClass === "hd-jackets") &&
      SONGDB_IMAGE_FILE.test(file)
    ) {
      return `songdb/${songdbClass}/${game}/${file}`;
    }
    return null;
  }

  const isLegacyMedia =
    relativeSegments.length >= 2 && (root === "generated" || root === "scorecard");
  const isVersionedRuntime =
    relativeSegments.length >= 4 &&
    root === "cardviewer" &&
    version === "v1" &&
    assetClass === "runtime";
  if ((isLegacyMedia || isVersionedRuntime) && MEDIA_EXTENSIONS.has(extension)) {
    return ["official", ...relativeSegments].join("/");
  }
  if (
    relativeSegments.length === 5 &&
    root === "cardviewer" &&
    version === "v1" &&
    assetClass === "fonts"
  ) {
    const [, , , fontClass, file] = relativeSegments;
    if (
      (fontClass === "zen" && PUBLIC_FONT_FILES.has(file)) ||
      (fontClass === "licenses" && PUBLIC_FONT_LICENSE_FILES.has(file))
    ) {
      return ["official", ...relativeSegments].join("/");
    }
  }
  return null;
}

function notFoundResponse() {
  return new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

function unavailableBindingResponse() {
  return new Response("ASSETS_BUCKET binding is not configured", {
    status: 503,
    headers: { "Cache-Control": "no-store" },
  });
}

function publicAssetResponse(response, key) {
  const extensionAt = key.lastIndexOf(".");
  const contentType = CONTENT_TYPES.get(key.slice(extensionAt).toLowerCase());
  const headers = new Headers(response.headers);
  headers.set("Content-Type", contentType);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function onRequest({ request, env, waitUntil }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  const rawUrl = String(request.url);
  const key = publicObjectKey(rawUrl);
  if (!key) {
    return notFoundResponse();
  }

  if (typeof env?.ASSETS_BUCKET?.get !== "function") {
    return unavailableBindingResponse();
  }

  const url = new URL(rawUrl);
  url.search = "";
  url.hash = "";

  const cache = globalThis.caches.default;
  const isMutableData = key.endsWith(".json");
  // Query parameters do not select a different R2 object. Normalize them out,
  // and use GET so GET and HEAD share one edge-cache entry for immutable media.
  // Mutable catalogs deliberately bypass the Cache API: an R2 overwrite must
  // not be shadowed by a response inserted by an older Function deployment.
  const cacheKey = new Request(url.toString(), { method: "GET" });

  let response = isMutableData ? undefined : await cache.match(cacheKey);
  if (!response) {
    const object = await env.ASSETS_BUCKET.get(key);
    if (!object || object.body == null) {
      return notFoundResponse();
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    if (object.httpEtag) headers.set("etag", object.httpEtag);
    headers.set(
      "Cache-Control",
      key.endsWith(".json")
        ? "public, max-age=60, stale-while-revalidate=86400"
        : "public, max-age=31536000, immutable",
    );
    response = publicAssetResponse(new Response(object.body, { headers }), key);
    if (!isMutableData) {
      const cacheWrite = cache.put(cacheKey, response.clone());
      if (typeof waitUntil === "function") {
        waitUntil(cacheWrite);
      } else {
        await cacheWrite;
      }
    }
  } else {
    // Normalize cached entries too so a response written by an older Function
    // deployment cannot retain unsafe R2 metadata.
    response = publicAssetResponse(response, key);
  }

  if (request.method === "HEAD") {
    return new Response(null, { status: response.status, headers: response.headers });
  }
  return response;
}
