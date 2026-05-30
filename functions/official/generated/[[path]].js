// Cloudflare Pages Function: serve /official/generated/* from the R2 bucket.
// Bind the bucket in the Pages project as ASSETS_BUCKET (R2 bucket binding).
export async function onRequest({ request, env }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const url = new URL(request.url);
  // e.g. "/official/generated/cards.json" -> "official/generated/cards.json"
  const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

  const object = await env.ASSETS_BUCKET.get(key);
  if (!object || !object.body) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  // Manifests change; the hashed/static assets do not.
  headers.set(
    "Cache-Control",
    key.endsWith(".json") ? "public, max-age=60" : "public, max-age=31536000, immutable",
  );

  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}
