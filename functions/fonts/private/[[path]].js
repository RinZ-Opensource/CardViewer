// Cloudflare Pages Function: serve /fonts/private/* (the commercial FOT/SEGA
// fonts used in private mode) from the R2 bucket (binding ASSETS_BUCKET).
export async function onRequest({ request, env }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // "/fonts/private/FOT-NewRodin-Pro-EB.otf" -> "fonts/private/FOT-NewRodin-Pro-EB.otf"
  const key = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ""));

  const object = await env.ASSETS_BUCKET.get(key);
  if (!object || !object.body) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}
