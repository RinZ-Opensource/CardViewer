# songdb-sync

Cloudflare Worker that synchronizes [otoge-db](https://github.com/zvuc/otoge-db)
song metadata into R2. Its GET routes are R2-only diagnostics: they never fetch
an upstream object on a read miss. The browser score-card picker does not use
this Worker origin; it reads the same bucket through the same-origin Pages
Function.

## Routes

| Route | Behavior |
| --- | --- |
| `GET /data/{game}/music-ex.json` | Serve from R2; return 404 on a miss. |
| `GET /jackets/{game}/{file}` | Serve from R2; return 404 on a miss. |
| `GET /hd-jackets/{game}/{file}` | R2 only — high-res override tier uploaded out-of-band. |
| `POST /sync` | `Authorization: Bearer $SYNC_TOKEN`; fetch upstream metadata and write it to R2, matching the daily cron. Returns 200, 207, or 502 for complete success, partial failure, or total failure. |

`{game}` is one of `maimai`, `chunithm`, `ongeki`. Metadata is cached ~1 h,
jackets ~30 d immutable. A daily cron refreshes `music-ex.json` (uploads are
skipped when the stored sha-256 matches). Regular and HD jackets are publication
inputs uploaded separately; no GET request populates them.

Before a sync can replace metadata, the Worker applies a 20-second per-game
origin deadline, checks the upstream MIME type, enforces an 8 MiB
`Content-Length` and streamed-byte limit, decodes and parses JSON, and validates
a non-empty array of flat string records with the minimum game-specific fields
required by the browser. Conservative per-game row floors reject obviously
truncated catalogs; after a successful upload records the row count, a later
drop of more than 25% is also rejected for review.
Any failed check is reported as an `error:` result without inspecting or writing
the existing R2 object. Scheduled runs reject their execution task when any
game fails so Cloudflare monitoring does not record a false success.

## Source layout

- `src/config.ts`: generated binding boundary, games, key builders, and cache/CORS policy.
- `src/auth.ts`: constant-time manual-sync token verification.
- `src/http.ts`: request routing plus streaming R2 responses.
- `src/metadata.ts`: bounded upstream-body and JSON-record validation.
- `src/sync.ts`: hashing, no-op detection, and R2 writes.
- `src/index.ts`: minimal fetch and scheduled-handler entrypoint.

`worker-configuration.d.ts` is generated from `wrangler.jsonc`; secret bindings
remain declared separately because their values and names are not stored in the
tracked configuration.

## Bucket binding

The worker binds the existing CardViewer bucket (the one already hosting the
online-preview assets); no new bucket is created. The tracked `wrangler.jsonc`
currently names `cardviewer-assets`. Confirm that non-secret resource name is
correct for the target Cloudflare account before deploying a fork.

Coexistence is by key prefix: everything this worker reads or writes lives
under `songdb/` (`songdb/data/...`, `songdb/jackets/...`,
`songdb/hd-jackets/...`). It never lists or touches keys outside that prefix,
so `official/generated/...` and the rest of the bucket are unaffected. The
public routes stay unprefixed (`/data/...`) and map onto the prefixed keys.

CORS comes from the worker's own response headers, so no bucket-level CORS
configuration is needed.

## Setup and deploy

```powershell
cd workers/songdb-sync
npm ci
npm run check

# One-time: create the manual-sync secret with the pinned local Wrangler.
npm exec --offline -- wrangler secret put SYNC_TOKEN

npm run deploy
```

`npm run check` verifies that the generated binding declaration matches
`wrangler.jsonc`, performs the Worker type-check, then runs its in-memory
behavior suite. The suite fakes R2 and upstream fetches; it does not contact
Cloudflare or prove a live bucket binding. Regenerate the binding declaration
after configuration changes with `npm run types:generate`.

Manual metadata sync (optional — the cron covers normal operation):

```powershell
curl -X POST -H "Authorization: Bearer <token>" https://cardviewer-songdb.<account>.workers.dev/sync
```

## Browser read boundary

The app is fixed to the same-origin `/official/songdb/**` Pages route; there is
no build-time origin override. It prefers
`/official/songdb/hd-jackets/...`, falls back to
`/official/songdb/jackets/...`, then to the same-origin R2 placeholder at
`/official/cardviewer/v1/runtime/jacket-placeholder.png` per image (see
`src/scorecard/songdb/assets.ts`, re-exported through the stable
`src/scorecard/songdb.ts` facade). No jacket or placeholder binary is bundled
in the repository.

Upstream access is confined to the authenticated `POST /sync` and scheduled
metadata jobs. The Worker's GET routes only inspect existing R2 objects and
return 404 on a miss; they are not an origin fallback for the browser.

## Uploading high-res jackets

Uploads go to `songdb/hd-jackets/{game}/...` keys in the same shared bucket:

```powershell
node scripts/upload-hd-jackets.mjs maimai D:\path\to\hd-jackets --bucket <your-existing-cardviewer-bucket> [--dry-run] [--local]
```

Files must be named after the otoge-db jacket file (the hashed
`image`/`image_url` value in `music-ex.json`, e.g. `30eb032b16877275.png`) so
the `/hd-jackets/{game}/{file}` lookup matches. Game-extracted jackets produced
by the external asset workspace use game-native names (`jacket_11818.png`,
`UI_Jacket_0001.png`, ...) and need renaming or a mapping before upload.

## Score-card official asset tier

The deployed Pages Function already serves the shared R2 bucket below
`/official/*`. Score cards therefore use a same-origin, versioned override
before the mirrored songdb R2 tier and terminal R2 placeholder:

```text
official/scorecard/mai/jackets/jacket-map.json
official/scorecard/mai/jackets/v1/<otoge-image-file>
official/scorecard/chuni/jackets/jacket-map.json
official/scorecard/chuni/jackets/v1/<otoge-image-file>
official/scorecard/ongeki/jackets/jacket-map.json
official/scorecard/ongeki/jackets/v1/<otoge-image-file>
official/scorecard/ongeki/boss/boss-map.json
official/scorecard/ongeki/boss/v1/UI_Card_Icon_<id>.png
```

Prepare and verify the jacket bundles and ONGEKI opponent assets in the external
asset workspace. Bring only the reviewed publication objects and inventory to
this deployment workflow. Generate deterministic `wrangler r2 bulk put`
manifests with `scripts/cloudflare/prepare_r2_bulk_manifest.mjs` and upload each
image type with its matching content type. Upload the small JSON manifests last
so a new version is never advertised before its images are present.
