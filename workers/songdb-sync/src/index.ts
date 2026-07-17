/**
 * R2-backed song metadata diagnostics and authenticated synchronization.
 * Browser reads continue to use the same-origin Pages Function.
 */
import { type Env } from "./config.ts";
import { handleRequest } from "./http.ts";
import { failedSyncs, syncAll } from "./sync.ts";

async function runScheduledSync(env: Env): Promise<void> {
  const results = await syncAll(env);
  const failures = failedSyncs(results);
  const event = JSON.stringify({
    event: "songdb_sync",
    status: failures.length === 0 ? "ok" : "error",
    results,
  });
  if (failures.length > 0) {
    console.error(event);
    throw new Error(`songdb sync failed for ${failures.map(({ game }) => game).join(", ")}`);
  }
  console.log(event);
}

export default {
  fetch(request, env): Promise<Response> {
    return handleRequest(request, env);
  },

  scheduled(_event, env, ctx): void {
    ctx.waitUntil(runScheduledSync(env));
  },
} satisfies ExportedHandler<Env>;
