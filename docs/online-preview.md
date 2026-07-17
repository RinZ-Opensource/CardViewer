# Online preview and Cloudflare deployment

This runbook describes the public Pages, R2, and Worker boundary. It does not
name a production project, account, bucket, or URL. Supply those values through
Cloudflare configuration and never commit credentials or tokens. Repository
changes and local builds do not publish anything by themselves.

## Architecture

```text
Cloudflare Pages
|- dist/                         public Vite bundle
`- /official/*                  allowlisted Pages Function -> R2 ASSETS_BUCKET

R2 synchronization Worker
`- upstream -> songdb/*         scheduled/manual metadata production only
```

`functions/official/[[path]].js` requires an R2 binding named exactly
`ASSETS_BUCKET`. It accepts only these public key spaces:

- `official/generated/**`
- `official/scorecard/**`
- `official/cardviewer/v1/runtime/**`
- `official/cardviewer/v1/fonts/**`
- browser `/official/songdb/**` routes mapped to bucket `songdb/**`

The generated, score-card, and renderer-runtime routes serve only `.json`,
`.png`, `.jpg`, `.jpeg`, and `.webp`. The font route is an exact file
allowlist: the seven named Zen `.ttf` files and their two named OFL `.txt`
license files are the only accepted objects. License text is kept beside the
redistributable fonts it covers. Hidden, empty, dot, traversal-shaped, and
otherwise abnormal path segments are rejected before R2 is read.

| Browser request | R2 key |
| --- | --- |
| `/official/generated/cards.index.json` | `official/generated/cards.index.json` |
| `/official/scorecard/mai/jackets/jacket-map.json` | `official/scorecard/mai/jackets/jacket-map.json` |
| `/official/cardviewer/v1/runtime/C310Busb_CardBack.png` | `official/cardviewer/v1/runtime/C310Busb_CardBack.png` |
| `/official/cardviewer/v1/fonts/zen/ZenMaruGothic-Regular.ttf` | `official/cardviewer/v1/fonts/zen/ZenMaruGothic-Regular.ttf` |
| `/official/songdb/data/maimai/music-ex.json` | `songdb/data/maimai/music-ex.json` |
| `/official/songdb/jackets/chunithm/example.png` | `songdb/jackets/chunithm/example.png` |

Do not expose the bucket or a broader prefix through an R2 custom domain. That
would bypass the Function allowlist. A successful static deployment does not
prove the binding exists, the required objects are present, or negative routes
are blocked.

## External R2 artifact contract

Source packages, font binaries, extraction code, conversion environments, and
working output live outside this repository. The external producer hands off
only reviewed publication objects:

```text
official/generated/cards.json
official/generated/cards.index.json
official/generated/cards.{chu,mai,mu3}.json
official/generated/shards/cards-<release>.json
official/generated/assets/{chu,mai,mu3}/<image>
official/generated/assets/thumbs/{chu,mai,mu3}/<image>
official/scorecard/{mai,chuni,ongeki}/<reviewed direct image or manifest>
official/scorecard/<game>/jackets/{<image>,jacket-map.json,vN/<image>}
official/scorecard/ongeki/boss/{boss-map.json,vN/<image>}
official/cardviewer/v1/runtime/<direct shared UI, atlas, texture, or font data>
official/cardviewer/v1/runtime/fonts/FONT_*.{json,png}
official/cardviewer/v1/fonts/zen/<redistributable web fonts>
official/cardviewer/v1/fonts/licenses/<matching license texts>
songdb/data/<game>/music-ex.json
songdb/{jackets,hd-jackets}/<game>/<safe image file>
```

The browser uses `/official/generated/cards.json` by default and discovers the
index and shards through the manifest loader. Every JSON asset reference must
already use its final same-origin `/official/*` URL. The repository does not
mount a local asset directory into Vite and does not contain an asset exporter.

Before publication, the producer must provide an inventory containing at least
the R2 key, byte size, content type, and checksum for every object. Review the
inventory and upload only entries that satisfy the Function path and extension
rules. Never bulk-upload a producer working directory: logs, scripts, command
files, process IDs, caches, raw data, and privately licensed fonts are not
release objects. Open-font binaries are release objects only when their
matching license text and the attribution in `THIRD_PARTY_NOTICES.md` are both
present.

The Function implements these entries as structural allowlists, not broad
prefix grants. Adding a game, manifest filename, asset directory, or runtime
subdirectory therefore requires a matching Function rule and positive/negative
tests before publication.

Publication order is deliberate:

1. Upload new versioned binary objects.
2. Verify their sizes, hashes, and content types.
3. Upload small lookup maps.
4. Publish game shards, then `cards.index.json`, then `cards.json` last.

This order prevents a manifest from becoming visible before its referenced
objects exist.

## Public build

Cloudflare Pages should run:

```sh
npm run build
```

Use `dist` as the output directory. `.node-version` pins Node.js 22.20.0;
configure Pages to honor it or set `NODE_VERSION=22.20.0`. Pages Build System
v3 does not infer the version from `package.json` `engines`; see Cloudflare's
[build image documentation](https://developers.cloudflare.com/pages/configuration/build-image/).

The equivalent local PowerShell commands are:

```powershell
npm.cmd run build
npm.cmd run check:public-dist
```

All supported Vite commands target the fixed public runtime and fail before
serving or building unless every file under `public/` appears in
`public-asset-policy.json`. Vite copies that tree into `dist` even when Git
ignores a file, so this gate also catches ignored environment or credential
files. The completed `dist` allowlist check is a separate required gate.

The repository-level `functions/` directory supplies Pages Functions. It is not
part of `dist`; uploading only `dist` to a generic static host is not an
equivalent deployment.

## Local previews

`npm.cmd run dev` and `npm.cmd run preview` run Vite only. They do not execute
Pages Functions or read R2, so same-origin `/official/*` requests normally
return 404 in these previews. If they succeed, check for copied files under
`public/` or a stale `dist` first.

For a local Pages Function preview:

```powershell
npm.cmd run build
npm.cmd run preview:cloudflare
```

Wrangler's local R2 namespace must be seeded separately with the keys requested
by the page. Exact persistence and remote-resource flags vary by Wrangler
version; check the installed help and never point an unreviewed command at
production storage.

| Check | Proves | Does not prove |
| --- | --- | --- |
| `npm.cmd run dev` | public UI and fallback behavior | Pages routing or R2 |
| `npm.cmd run build` plus Vite preview | final static bundle | Pages routing or R2 |
| Wrangler Pages dev with local R2 | allowlist and negative routes locally | production bindings or edge cache |
| deployed-origin smoke | active Pages, Function, binding, and selected objects | completeness beyond sampled keys |

## Caching and versioning

JSON responses use a short browser TTL with `stale-while-revalidate`.
Allowlisted non-JSON assets use a one-year immutable cache. Consequently:

- version keys whenever image or atlas bytes change;
- do not overwrite a stable immutable key and expect clients to refresh;
- publish binaries before the JSON that references them;
- treat the card index and every shard as one release.

Typical score-card keys are:

```text
official/scorecard/mai/jackets/jacket-map.json
official/scorecard/mai/jackets/v1/<file>
official/scorecard/chuni/jackets/jacket-map.json
official/scorecard/chuni/jackets/v1/<file>
official/scorecard/ongeki/jackets/jacket-map.json
official/scorecard/ongeki/jackets/v1/<file>
official/scorecard/ongeki/boss/boss-map.json
official/scorecard/ongeki/boss/v1/<file>
```

`scripts/cloudflare/prepare_r2_bulk_manifest.mjs` creates deterministic,
extension-specific upload inventories from an already reviewed handoff
directory. Review its output; do not treat generation as upload authorization.

## Song database Worker

The browser is fixed to the same-origin `/official/songdb/**` Pages route.
There is no build-time Worker-origin override and no browser fallback to
GitHub, jsDelivr, or another public endpoint.

The Worker separates publication from reading. Its authenticated `POST /sync`
and scheduled handler fetch upstream `music-ex.json` and write it to R2. Its
GET data, regular-jacket, and HD-jacket routes only return objects already in
R2; every miss is a 404 and never starts an upstream fetch. Regular and HD
jackets are uploaded as reviewed publication objects outside the browser read
path.

Worker secrets such as the manual-sync token belong in Cloudflare secret
storage. They are never browser configuration or `VITE_` variables.

The Worker and Pages Function may share a physical bucket, but they use distinct
bindings and prefixes: the Worker writes `SONGDB` keys under `songdb/*`; Pages
uses `ASSETS_BUCKET` and maps only the approved browser routes above.

## Release checklist

1. Build the intended commit with Node.js 22.20.0 using `npm run build`.
2. Confirm the automatic public artifact check reports `PASS`.
3. Run `npm run check` and record the exact commit tested.
4. Review the external producer inventory; accept only allowed keys,
   extensions, content types, sizes, and checksums.
5. Upload versioned binary groups first and maps/manifests last.
6. Confirm the Pages environment has `ASSETS_BUCKET` and no bucket-level public
   route that bypasses the Function.
7. Deploy the bundle and Function from the intended commit.
8. Request the app shell, `cards.json`, the card index and one shard, one
   score-card asset, one renderer-runtime object, one web font, and its license
   text from the deployed origin.
9. Confirm a disallowed key, hidden path, traversal-shaped path, unsupported
   extension, and `/fonts/private/*` all return a non-success response.
10. Record built, locally verified, live verified, and deployed states
    separately.
