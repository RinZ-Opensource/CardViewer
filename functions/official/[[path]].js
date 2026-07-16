// Cloudflare Pages Function: serve the reviewed public subset of /official/*
// from the ASSETS_BUCKET R2 binding. Prefixes alone are not a sufficient
// boundary because the source bucket also contains scripts and diagnostic
// files, so every request must pass both a path allowlist and an extension
// allowlist before R2 is consulted.

const ALLOWED_ROOT_KEYS = new Set([
  "official/C310Busb_CardBack.png",
]);

const ALLOWED_EXTENSIONS = new Set([".json", ".png", ".jpg", ".jpeg", ".webp"]);
const CONTENT_TYPES = new Map([
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
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
  if (extensionAt <= 0 || !ALLOWED_EXTENSIONS.has(leaf.slice(extensionAt).toLowerCase())) {
    return null;
  }

  const key = ["official", ...relativeSegments].join("/");
  if (relativeSegments.length === 1) {
    return ALLOWED_ROOT_KEYS.has(key) ? key : null;
  }

  const publicPrefix = relativeSegments[0];
  return publicPrefix === "generated" || publicPrefix === "scorecard" ? key : null;
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
  // Query parameters do not select a different R2 object. Normalize them out,
  // and use GET so GET and HEAD share one edge-cache entry.
  const cacheKey = new Request(url.toString(), { method: "GET" });

  let response = await cache.match(cacheKey);
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
    const cacheWrite = cache.put(cacheKey, response.clone());
    if (typeof waitUntil === "function") {
      waitUntil(cacheWrite);
    } else {
      await cacheWrite;
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
