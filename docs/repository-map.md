# Repository Map

This repository is the source boundary for the public Cloudflare CardViewer.
It contains the browser application, Pages routing, the optional song database
Worker, and their validation. Local source packages and asset-production
workspaces are deliberately outside this boundary.

## Maintained paths

- `src/`: React/Vite application, CHU/MAI/MU3 card renderers, and CHUNITHM,
  maimai, and O.N.G.E.K.I. score-card renderers.
- `src/scorecard/`: controlled editors, persisted state, song database access,
  asset URL lookup, selection transitions, and preview renderers.
- `public/`: reviewed redistributable files copied verbatim into `dist`.
- `functions/official/[[path]].js`: Pages Function that exposes the reviewed
  `/official/*` surface through the `ASSETS_BUCKET` R2 binding.
- `workers/songdb-sync/`: optional Worker for public song metadata, origin
  jacket fallback, R2 caching, and scheduled/manual synchronization.
- `scripts/cloudflare/`: helper for deterministic, extension-specific R2 bulk
  upload manifests.
- `tests/`: web behavior, module boundaries, Pages routing, persisted state,
  secret scanning, public artifact checks, and this deployment boundary.
- `.github/workflows/ci.yml`: read-only validation for the Node web and Worker
  toolchains. It does not deploy or use repository secrets.
- `docs/online-preview.md`: authoritative Cloudflare and R2 runbook.

## External producer contract

Extraction, conversion, and source asset review happen in a separate local
workspace. This repository accepts no source packages, licensed fonts,
generated packs, platform runtimes, or extraction code.

An external producer hands off only objects ready for R2 publication:

1. `official/generated/cards.json`.
2. `official/generated/cards.index.json` plus every shard it references.
3. Versioned card images referenced by those manifests below
   `official/generated/**`.
4. Score-card maps and versioned images below `official/scorecard/**`.
5. The explicitly reviewed root card-back image listed in the Cloudflare runbook.

Every handed-off object must use an allowed `.json`, `.png`, `.jpg`, `.jpeg`,
or `.webp` extension. JSON must reference the final same-origin `/official/*`
URL, not a producer filesystem path. Binary objects are uploaded before maps
and manifests; manifests are published last. Generated logs, scripts, command
files, process IDs, caches, raw data, and licensed fonts are never publication
inputs.

## Enforced exclusions

`tests/deployment-boundary.test.mjs` rejects tracked desktop or device source,
source-extraction utilities, local asset roots, non-Node toolchain pins,
deprecated platform documentation, and frontend imports tied to those removed
surfaces. It also checks the root package scripts and direct dependencies.

`.gitignore` prevents routine additions of the external-only roots. The test is
the stronger gate because it still rejects files added with a forced Git add.
The tracked-secret scanner independently checks both committed blobs and
changed working-tree variants.

The Vite guard compares the entire `public/` tree with
`public-asset-policy.json` before serving or building. `check-public-dist.mjs`
then allows only those reviewed static files plus the expected Vite entry
bundles. These safeguards are independent of the Pages Function allowlist: one
protects static build contents, while the other limits which R2 objects can be
read at runtime.

## Deployment boundary

The repository does not publish merely because a build or test succeeds. Keep
these states separate:

- built: Vite produced `dist`;
- locally verified: automated tests and the local artifact guard passed;
- live verified: approved and rejected requests were checked against a deployed
  Pages environment with the intended R2 binding;
- deployed: a specific commit and asset release are active in Cloudflare.

See [online-preview.md](online-preview.md) for the release checklist.
