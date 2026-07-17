import { isAuthorizedSyncRequest } from "./auth.ts";
import {
  CORS,
  DATA_CACHE,
  JACKET_CACHE,
  JACKET_FILE,
  contentTypeFor,
  dataKey,
  isGame,
  jacketKey,
  type Env,
  type Game,
} from "./config.ts";
import { syncAll, syncHttpStatus } from "./sync.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

function r2Response(object: R2ObjectBody, contentType: string, cacheControl: string): Response {
  return new Response(object.body, {
    headers: {
      ...CORS,
      "content-type": contentType,
      "cache-control": cacheControl,
      etag: object.httpEtag,
    },
  });
}

async function serveData(env: Env, game: Game): Promise<Response> {
  const object = await env.SONGDB.get(dataKey(game));
  if (!object) return jsonResponse(404, { error: "not found" });
  return r2Response(object, "application/json", DATA_CACHE);
}

async function serveJacket(
  env: Env,
  tier: "jackets" | "hd-jackets",
  game: Game,
  file: string,
): Promise<Response> {
  const object = await env.SONGDB.get(jacketKey(tier, game, file));
  if (!object) return jsonResponse(404, { error: "not found" });
  return r2Response(object, contentTypeFor(file), JACKET_CACHE);
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(request.url);
  const [root, game, ...rest] = url.pathname.split("/").filter(Boolean);
  // Nested paths re-join with "/" and then fail the JACKET_FILE anchor.
  const file = rest.join("/");

  if (request.method === "POST" && root === "sync" && game === undefined) {
    if (!(await isAuthorizedSyncRequest(request, env.SYNC_TOKEN))) {
      return jsonResponse(401, { error: "unauthorized" });
    }
    const results = await syncAll(env);
    return jsonResponse(syncHttpStatus(results), results);
  }

  if (request.method !== "GET") return jsonResponse(405, { error: "method not allowed" });
  if (!root || !game || !isGame(game)) return jsonResponse(404, { error: "not found" });

  if (root === "data" && file === "music-ex.json") return serveData(env, game);
  if (root === "jackets" && JACKET_FILE.test(file)) return serveJacket(env, "jackets", game, file);
  if (root === "hd-jackets" && JACKET_FILE.test(file)) return serveJacket(env, "hd-jackets", game, file);
  return jsonResponse(404, { error: "not found" });
}
