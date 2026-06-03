// Cloudflare Pages Function: serve EVERYTHING under /official/* from R2.
// Covers the static sprites/fonts atlases (UI_*.png, FONT_*.json) AND the
// generated card data + assets under /official/generated/*.
// Requires an R2 bucket binding named ASSETS_BUCKET on the Pages project.
//
// Responses are stored in the Cloudflare edge cache (Cache API) so that, after
// the first request, subsequent users are served from the edge without
// re-invoking the Worker's R2 lookup. The browser-facing Cache-Control still
// distinguishes mutable manifests (short TTL) from immutable assets.
export async function onRequest({ request, env, waitUntil }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const url = new URL(request.url);
  const cache = caches.default;
  // Key the edge cache on a normalized GET request so HEAD shares the entry.
  const cacheKey = new Request(url.toString(), { method: "GET" });

  let response = await cache.match(cacheKey);
  if (!response) {
    // "/official/generated/cards.json" -> "official/generated/cards.json"
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

    const object = await env.ASSETS_BUCKET.get(key);
    if (!object || !object.body) {
      return new Response("Not found", { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    // Manifests change; images/atlases don't. stale-while-revalidate lets a
    // revisiting browser paint from the (slightly stale) cached manifest
    // immediately while it refreshes in the background, instead of blocking on
    // a revalidation round-trip.
    headers.set(
      "Cache-Control",
      key.endsWith(".json")
        ? "public, max-age=60, stale-while-revalidate=86400"
        : "public, max-age=31536000, immutable",
    );
    // Ensure JSON carries a correct content-type even if the R2 object lacks
    // one, so Cloudflare applies brotli/gzip and clients parse it correctly.
    if (key.endsWith(".json") && !headers.get("content-type")) {
      headers.set("content-type", "application/json; charset=utf-8");
    }

    response = new Response(object.body, { headers });
    // Populate the edge cache for the next user without blocking this response.
    waitUntil(cache.put(cacheKey, response.clone()));
  }

  if (request.method === "HEAD") {
    return new Response(null, { status: response.status, headers: response.headers });
  }
  return response;
}
