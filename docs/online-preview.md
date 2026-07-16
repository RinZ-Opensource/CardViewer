# Online preview and Cloudflare deployment

This document describes the current public/private asset boundary. It does not
name a production project, account, bucket, or URL. Supply those values through
the deployment environment; never commit credentials or tokens. Repository or
documentation changes do not publish anything by themselves.

## Architecture

The browser sees one origin, but the application bundle and official assets have
different sources:

```text
Cloudflare Pages
|- dist/                         public Vite bundle
`- /official/*                  allowlisted Pages Function -> R2 ASSETS_BUCKET

Optional song database Worker
`- VITE_SONGDB_BASE_URL         metadata, mirrored jackets, HD jacket tier
```

The public asset Function is:

- `functions/official/[[path]].js`

It requires an R2 binding named exactly `ASSETS_BUCKET`. It accepts only these
public key spaces and exact root objects:

- `official/generated/**`
- `official/scorecard/**`
- `official/C310Busb_CardBack.png`
- `official/UI_Card_Horo_Rainbow_Hard.png`
- `official/UI_Card_Horo_Pattern_00.png`

Within those locations, the Function serves only `.json`, `.png`, `.jpg`,
`.jpeg`, and `.webp` files. It rejects hidden, empty, dot, traversal, or
otherwise abnormal path segments before reading R2. Example mappings are:

| Request | R2 key |
| --- | --- |
| `/official/generated/cards.index.json` | `official/generated/cards.index.json` |
| `/official/scorecard/mai/jackets/jacket-map.json` | `official/scorecard/mai/jackets/jacket-map.json` |
| `/official/C310Busb_CardBack.png` | `official/C310Busb_CardBack.png` |

Every other R2 object is inaccessible through the Pages route, even when it is
present in the bound bucket. Do not expose the bucket or a broader prefix on a
public R2 custom domain, because that would bypass the Function allowlist.
Configure the binding for every Cloudflare environment that must serve the
route. A successful static Pages deployment does not prove that the R2 binding
exists, that its allowlist is active, or that the required objects were
uploaded.

## Source asset boundary

Local official assets and licensed fonts belong only under:

```text
private-assets/official/
private-assets/fonts/fot/
```

In private mode, Vite serves them as `/official/*` and `/fonts/private/*`. During
a private build it copies them to `dist/official` and `dist/fonts/private`, with
`private-assets/official/generated` excluded unless explicitly requested.
These font routes and copies are for private Vite/Tauri use only. The public
Cloudflare deployment has no `/fonts/private/*` Function or licensed-font
fallback in R2.

Do not maintain a second copy under `public/official` or
`public/fonts/private`. Vite copies everything below `public/` into `dist` in
all modes. `.gitignore` affects Git only and cannot prevent that copy. Those
directories therefore make a local public build unsafe for direct upload.

The local `private-assets/official/generated` tree is also a working directory,
not a publication unit. It may contain logs, scripts, command files, PID files,
and other local output beside renderer assets. Never upload the directory as a
whole. Generate and review the extension-specific R2 bulk manifests, and upload
only the entries approved for the public prefix.

## Private development and export

Private mode is the most direct way to verify renderers against local assets:

```powershell
npm.cmd run dev:private
npm.cmd run build:private
```

Export an installed package into the private asset tree with:

```powershell
npm.cmd run export:online -- "<package-root>"
```

The exporter writes the generated card manifests and render assets under
`private-assets/official/generated`. Private development serves that directory
directly. A private production build omits it by default; point the application
at an externally hosted manifest at build time:

```powershell
$env:VITE_CARD_MANIFEST_URL="<manifest-url>"
npm.cmd run build:private
```

For a deliberately self-contained controlled build, opt in to copying the
generated directory:

```powershell
$env:CARDVIEWER_COPY_GENERATED_ASSETS="1"
npm.cmd run build:private
```

That opt-in is not appropriate for the public Pages bundle.

The exporter supports resumable and selective rebuilds:

```powershell
# Rebuild generated files even when outputs already exist.
$env:CARDVIEWER_EXPORT_FORCE="1"
npm.cmd run export:online -- "<package-root>"

# Remove older generated files no longer referenced by the export.
$env:CARDVIEWER_EXPORT_PRUNE="1"
npm.cmd run export:online -- "<package-root>"

# Archival/debug export; intentionally broader than the normal renderer set.
$env:CARDVIEWER_EXPORT_ALL_ASSETS="1"
npm.cmd run export:online -- "<package-root>"
```

To prepare output for an object store, pass an explicit directory and the URL
base that the resulting manifest should reference:

```powershell
npm.cmd run export:online -- "<package-root>" "<output-directory>" "<public-url-base>"
```

## Public Pages build

Configure the Cloudflare Pages Dashboard/CI build command as:

```sh
npm run build:public
```

The root `.node-version` pins Node.js 22.20.0. Configure Pages to honor that
file (or set `NODE_VERSION=22.20.0` explicitly) and confirm the selected
version in the build log. Pages Build System v3 does not infer the Node version
from `package.json` `engines`; see Cloudflare's
[build image documentation](https://developers.cloudflare.com/pages/configuration/build-image/).

The equivalent local PowerShell command is:

```powershell
npm.cmd run build:public
```

Use `dist` as the build output directory. `.env.public` sets
`VITE_DEPLOYMENT_MODE=public`, which disables the private-assets Vite plugin.
The repository-level `functions/` directory supplies the Pages Functions; it is
not part of `dist` and a plain static host will not execute it.

`build:public` fails before bundling if either forbidden source directory
contains local files, then runs a second check against the completed artifact.
You can also run that artifact check directly:

```powershell
npm.cmd run check:public-dist
```

The command must report `PASS`. Also inspect unexpected large files before a
direct upload. A clean Cloudflare Git checkout normally lacks ignored local
inputs, but that is not a substitute for checking the built artifact.

This static artifact guard is the first publication gate: it proves that the
public `dist` does not contain forbidden asset trees. The `/official/*` Function
allowlist is a separate runtime gate: it constrains which objects can be read
from R2. Neither gate substitutes for the other, so verify both before any live
deployment.

Do not treat any of the following as an equivalent deployment:

- uploading only `dist` to a generic static host;
- a Dashboard drag-and-drop flow that does not deploy the Pages Functions;
- a Pages environment without the `ASSETS_BUCKET` binding;
- a bucket containing manifests but not their referenced images;
- a public R2 custom domain or bucket route that bypasses the Function
  allowlist.

## Local preview boundary

`npm.cmd run dev:public` and `npm.cmd run preview:public` run Vite only. They do
not execute Cloudflare Pages Functions and they do not read R2. Consequently,
same-origin `/official/*` and `/fonts/private/*` requests should return 404 in a
clean public preview. If they unexpectedly succeed, first check for leaked files
under `public/` or `dist/`.

Use the previews for different questions:

| Preview | What it verifies | What it does not verify |
| --- | --- | --- |
| `npm.cmd run dev:private` | UI and renderers with local `private-assets` | Pages Functions, R2 bindings, edge caching |
| `npm.cmd run dev:public` | public-mode UI and fallback behavior | `/official/*`, R2 |
| `npm.cmd run build:public` + Vite preview | final static bundle | Pages Functions and R2 |
| Wrangler Pages dev with an R2 binding | allowlisted `/official/*` routing and negative-path behavior against a local R2 namespace | production objects, production bindings, live edge cache |

Wrangler is pinned by the songdb Worker toolchain and exposed through the root
preview command. A representative local Functions preview is:

```powershell
npm.cmd run build:public
npm.cmd run preview:cloudflare
```

Wrangler's local R2 namespace must be seeded separately with the keys the page
requests. Exact persistence and remote-resource flags vary by Wrangler version,
so check the installed Wrangler help before relying on additional flags. Never
point an unreviewed local command at production storage.

Local verification and live verification are separate gates. Before declaring
the deployment healthy, request at least the app shell, one generated manifest,
one score-card asset, and one approved root resource from the deployed origin.
Also confirm that a disallowed `/official/*` key, a hidden or traversal-shaped
path, an unsupported extension, and `/fonts/private/*` all return a non-success
response without exposing an R2 object.

## R2 publication and caching

`/official/*` JSON responses currently use a short browser TTL with
`stale-while-revalidate`; allowlisted non-JSON official assets are cached for
one year with `immutable`. Therefore:

- use versioned keys when the bytes of an image or atlas change;
- upload referenced images before publishing a JSON map or manifest that points
  to them;
- publish small maps and manifests last;
- do not overwrite a stable immutable key and expect clients to update quickly;
- treat the index and its shards as one release when publishing card manifests.

The score-card asset tier uses keys such as:

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

The preparation tools are documented in `workers/songdb-sync/README.md`. They
can generate deterministic, extension-specific bulk-upload manifests and reject
unknown file types. Review the resulting keys, upload only approved manifest
entries into `official/generated/**` or `official/scorecard/**`, upload each
binary group with the correct content type, then upload the corresponding JSON
map last. Do not bulk-upload the source directory itself.

## Song database endpoint

The score-card picker can use the optional Worker under `workers/songdb-sync/`.
Set its public origin while running or building the app:

```powershell
$env:VITE_SONGDB_BASE_URL="<songdb-worker-origin>"
npm.cmd run build:public
```

`VITE_SONGDB_BASE_URL` is embedded in the browser bundle by Vite, so changing a
Cloudflare environment variable requires another build/deployment. It must be a
public browser-reachable origin and must not contain credentials. When unset,
the application uses its public otoge-db fallback. Worker secrets such as the
manual-sync token belong in Cloudflare secret storage and must never use a
`VITE_` variable.

The committed Tauri CSP permits only the default `cdn.jsdelivr.net` fallback.
If a desktop build embeds a custom Worker origin, add that exact origin to both
`connect-src` and `img-src` in `src-tauri/tauri.conf.json`; do not widen either
directive to arbitrary HTTPS origins. Web/Cloudflare builds are not governed by
the Tauri CSP.

The Worker and Pages Function may share one physical R2 bucket, but they use
separate bindings and key prefixes: the Worker uses `SONGDB` and `songdb/*`,
while Pages uses `ASSETS_BUCKET` and can serve only the approved `official/*`
keys listed above. Objects elsewhere in a shared bucket are not public through
Pages and must not be exposed through a bucket-level custom domain.

## Deployment checklist

1. Confirm the build uses the root `.node-version` (Node.js 22.20.0), then build
   from the intended commit with `npm run build:public` in CI/Dashboard
   (`npm.cmd run build:public` in local PowerShell).
2. Confirm the automatic `check:public-dist` step reports `PASS`.
3. Confirm any required `VITE_SONGDB_BASE_URL` or
   `VITE_CARD_MANIFEST_URL` value is a public, credential-free URL.
4. Generate, verify, and review R2 bulk manifests; publish only approved
   `.json`, `.png`, `.jpg`, `.jpeg`, and `.webp` entries. Upload versioned
   binaries first and their JSON maps/manifests last.
5. Confirm the Pages environment has an `ASSETS_BUCKET` R2 binding and no
   public custom domain or broader route on the bucket/prefix.
6. Deploy the public bundle with the allowlisted `/official/*` Function and
   without a `/fonts/private/*` Function.
7. Verify approved requests succeed and disallowed keys, abnormal paths,
   unsupported extensions, and `/fonts/private/*` do not.
8. Record separately what was built, locally verified, live verified, and
   deployed.
