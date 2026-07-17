import { publicObjectKey } from "./public-object-policy.js";

// Cloudflare Pages Function transport for the reviewed /official/* contract.
// Path validation and R2 key selection live in public-object-policy.js; this
// entrypoint owns bindings, edge caching, response metadata, and HTTP methods.

const CONTENT_TYPES = new Map([
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ttf", "font/ttf"],
  [".txt", "text/plain; charset=utf-8"],
]);
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
