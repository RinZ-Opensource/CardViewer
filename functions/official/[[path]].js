// Cloudflare Pages Function: serve EVERYTHING under /official/* from R2.
// Covers the static sprites/fonts atlases (UI_*.png, FONT_*.json) AND the
// generated card data + assets under /official/generated/*.
// Requires an R2 bucket binding named ASSETS_BUCKET on the Pages project.
export async function onRequest({ request, env }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // "/official/generated/cards.json" -> "official/generated/cards.json"
  const key = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ""));

  const object = await env.ASSETS_BUCKET.get(key);
  if (!object || !object.body) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  // Manifests change; images/atlases don't.
  headers.set(
    "Cache-Control",
    key.endsWith(".json") ? "public, max-age=60" : "public, max-age=31536000, immutable",
  );

  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}
