# songdb-sync

Cloudflare Worker that mirrors [otoge-db](https://github.com/zvuc/otoge-db) song
metadata and jackets into R2 and serves them with
`Access-Control-Allow-Origin: *`, so the score-card song picker and the
html-to-image PNG export work from any origin.

## Routes

| Route | Behavior |
| --- | --- |
| `GET /data/{game}/music-ex.json` | Serve from R2; lazy-bootstraps from GitHub on first hit. |
| `GET /jackets/{game}/{file}` | Serve from R2; lazy-mirrors the jacket from GitHub on miss (404 passes through). |
| `GET /hd-jackets/{game}/{file}` | R2 only — high-res override tier uploaded out-of-band. |
| `POST /sync` | `Authorization: Bearer $SYNC_TOKEN`; runs the same metadata sync as the daily cron. |

`{game}` is one of `maimai`, `chunithm`, `ongeki`. Metadata is cached ~1 h,
jackets ~30 d immutable. A daily cron refreshes `music-ex.json` (uploads are
skipped when the stored sha-256 matches).

## Bucket binding

The worker binds your **existing** CardViewer bucket (the one already hosting
the online-preview assets) — no new bucket is created. Edit `wrangler.toml`
and replace the `bucket_name` placeholder with that bucket's name.

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
npm install
npm run typecheck

# One-time: point wrangler.toml bucket_name at your existing bucket, then
# create the manual-sync secret.
npx wrangler secret put SYNC_TOKEN

npx wrangler deploy
```

Manual sync (optional — the cron and lazy bootstrap cover normal operation):

```powershell
curl -X POST -H "Authorization: Bearer <token>" https://cardviewer-songdb.<account>.workers.dev/sync
```

## Pointing the app at the worker

Set the base URL for Vite builds/dev (empty/unset falls back to the public
jsDelivr mirror of otoge-db, which also sends CORS headers):

```powershell
$env:VITE_SONGDB_BASE_URL="https://cardviewer-songdb.<account>.workers.dev"
npm.cmd run dev
```

With the worker base set, the app prefers `/hd-jackets/...` and falls back to
`/jackets/...`, then to the bundled placeholder, per image (see
`src/scorecard/songdb.ts`).

## Uploading high-res jackets

Uploads go to `songdb/hd-jackets/{game}/...` keys in the same shared bucket:

```powershell
node scripts/upload-hd-jackets.mjs maimai D:\path\to\hd-jackets --bucket <your-existing-cardviewer-bucket> [--dry-run] [--local]
```

Files must be named after the otoge-db jacket file (the hashed
`image`/`image_url` value in `music-ex.json`, e.g. `30eb032b16877275.png`) so
the `/hd-jackets/{game}/{file}` lookup matches. Game-extracted jackets under
`private-assets/official/scorecard/{game}/` use game-native names
(`jacket_11818.png`, `UI_Jacket_0001.png`, ...) and need renaming/mapping first.
