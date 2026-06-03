// Cloudflare Pages Function: serve /fonts/private/* (the commercial FOT/SEGA
// fonts used in private mode) from the R2 bucket (binding ASSETS_BUCKET).
//
// Responses are stored in the Cloudflare edge cache (Cache API) so repeat
// requests across users are served from the edge without re-invoking the R2
// lookup. Fonts are immutable, so they cache for a year.
export async function onRequest({ request, env, waitUntil }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const url = new URL(request.url);
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });

  let response = await cache.match(cacheKey);
  if (!response) {
    // "/fonts/private/FOT-NewRodin-Pro-EB.otf" -> "fonts/private/FOT-NewRodin-Pro-EB.otf"
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

    const object = await env.ASSETS_BUCKET.get(key);
    if (!object || !object.body) {
      return new Response("Not found", { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");

    response = new Response(object.body, { headers });
    waitUntil(cache.put(cacheKey, response.clone()));
  }

  if (request.method === "HEAD") {
    return new Response(null, { status: response.status, headers: response.headers });
  }
  return response;
}
