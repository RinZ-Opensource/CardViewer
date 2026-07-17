# Repository Map

This repository is the source boundary for the public Cloudflare CardViewer.
It contains the browser application, Pages routing, the song database
synchronization Worker, and their validation. Local source packages and
asset-production workspaces are deliberately outside this boundary.

## Maintained paths

- `src/`: React/Vite application, CHU/MAI/MU3 card renderers, and CHUNITHM,
  maimai, and O.N.G.E.K.I. score-card renderers.
- `src/scorecard/`: controlled editors, persisted state, selection transitions,
  and preview renderers. `songdb.ts` is the stable public facade; `songdb/`
  separates fetch/cache orchestration, R2 URL and fallback policy, per-game
  normalization, chart helpers, field parsing, and internal models.
- `src/cardRender/`: preview interaction, renderer dispatch, per-game visual
  renderers, and shared MU3 layers. Each renderer consumes already-resolved
  browser URLs and does not fetch or construct producer paths.
- `src/cardData.ts` and `src/cardData/`: stable card-rule facade plus isolated
  field access, formatting, holo, QR, MAI, and MU3 rules.
- `src/hooks.ts` and `src/hooks/`: stable shared-hook facade plus isolated font,
  manifest, list viewport, selected-asset, and thumbnail loading lifecycles.
- `src/scorecard/scorecardLayout.ts`: renderer-independent design dimensions
  used by the responsive preview fitter; CSS parity is enforced by tests.
- `src/styles/scorecard-ui.css` and `src/styles/scorecard-{mai,chuni,ongeki}*.css`:
  shared workbench layout is separate from each game's design-space renderer.
- `src/textRendering.ts` and `src/textRendering/`: stable text-rendering facade
  plus isolated Canvas, TextMesh Pro, React-child, Unity bitmap-font, and shared
  coordinate pipelines. Renderer consumers use only the facade.
- `src/layers.tsx` and `src/layers/`: stable visual-layer facade plus isolated
  image/text primitives, Canvas/Unity/TMP text components, sprite counters, and
  QR rendering.
- `src/cardAssets.ts` and the holo and font loaders: browser renderer source
  that reads allowlisted R2 objects; these modules do not embed renderer assets.
- `public/`: only `404.html`, `_headers`, and `theme-init.js`, copied verbatim
  into `dist`.
- `functions/official/public-object-policy.js`: runtime-independent URL-to-R2
  allowlist and key mapping for the reviewed `/official/*` surface.
- `functions/official/[[path]].js`: Pages transport for the `ASSETS_BUCKET` R2
  binding, edge cache, response metadata, and GET/HEAD behavior.
- `workers/songdb-sync/`: scheduled/manual upstream metadata production plus
  R2-only GET diagnostics. Its source separates generated binding/config,
  authentication, HTTP/R2 transport, upstream validation, and synchronization;
  browser reads never use its origin.
- `scripts/cloudflare/`: helper for deterministic, extension-specific R2 bulk
  upload manifests.
- `tests/`: web behavior, per-feature module boundaries, an acyclic frontend
  import graph, Pages routing, persisted state, secret scanning, public
  artifact checks, and this deployment boundary.
- `.github/workflows/ci.yml`: read-only validation for the Node web and Worker
  toolchains. It does not deploy or use repository secrets.
- `docs/online-preview.md`: authoritative Cloudflare and R2 runbook.

## External producer contract

Extraction, conversion, and source asset review happen in a separate local
workspace. This repository accepts no source packages, image or font binaries,
generated packs, platform runtimes, or extraction code.

An external producer hands off only objects ready for R2 publication:

1. `official/generated/cards.json`.
2. `official/generated/cards.index.json` plus every shard it references.
3. Card images below `official/generated/assets/{chu,mai,mu3}/<image>` and
   thumbnails below `official/generated/assets/thumbs/{chu,mai,mu3}/<image>`.
4. Score-card direct images and reviewed manifests below
   `official/scorecard/{mai,chuni,ongeki}/`, plus jacket maps/images and the
   versioned ONGEKI boss map/icons.
5. Shared renderer UI, atlases, hologram textures, bitmap-font metrics, and
   bitmap-font textures as direct runtime files or
   `official/cardviewer/v1/runtime/fonts/FONT_*.{json,png}`.
6. Redistributable web fonts and their matching license texts below
   `official/cardviewer/v1/fonts/**`.
7. Song metadata and regular/HD jacket publication objects below `songdb/**`;
   browser access is fixed to the Pages `/official/songdb/**` mapping.

Generated, score-card, and renderer-runtime objects must match both a reviewed
path shape and an allowed `.json`, `.png`, `.jpg`, `.jpeg`, or `.webp`
extension; an allowed extension does not make an arbitrary nested key public.
Current font release
objects are limited to the seven reviewed Zen `.ttf` filenames and their two
reviewed OFL `.txt` filenames; adding another font requires a Function
allowlist, test, attribution, and publication-policy change.
JSON must reference the final same-origin `/official/*` URL, not a producer
filesystem path. Binary objects are uploaded before maps and manifests;
manifests are published last. Generated logs, scripts, command files, process
IDs, caches, raw data, and privately licensed fonts are never publication
inputs.

External JSON crosses an explicit runtime boundary. Manifest indexes, shards,
legacy manifests, bitmap-font catalogs, and SongDB payloads are parsed as
`unknown` and validated before application code receives typed values. The
SongDB producer separately rejects invalid MIME types, oversized bodies,
malformed JSON, and unusable game records before inspecting or replacing an R2
object.

## Enforced exclusions

`tests/deployment-boundary.test.mjs` rejects tracked desktop or device source,
source-extraction utilities, local asset roots, non-Node toolchain pins,
deprecated platform documentation, image/font/media binary extensions, and
frontend imports tied to removed desktop or export surfaces. Pure browser
renderer modules and their QR-code dependency remain inside the source
boundary. The test also checks the root package scripts and direct
dependencies.

`.gitignore` prevents routine additions of the external-only roots. The test is
the stronger gate because it still rejects files added with a forced Git add.
The tracked-secret scanner independently checks both committed blobs and
changed working-tree variants.

The Vite guard compares the entire `public/` tree with
`public-asset-policy.json` before serving or building. That policy allows only
`404.html`, `_headers`, and `theme-init.js`; `check-public-dist.mjs` then allows
those files plus the expected Vite entry bundles. These safeguards are
independent of the Pages Function allowlist: one protects static build contents,
while the other limits which R2 objects can be read at runtime.

## Deployment boundary

The repository does not publish merely because a build or test succeeds. Keep
these states separate:

- built: Vite produced `dist`;
- locally verified: automated tests and the local artifact guard passed;
- live verified: approved and rejected requests were checked against a deployed
  Pages environment with the intended R2 binding;
- deployed: a specific commit and asset release are active in Cloudflare.

See [online-preview.md](online-preview.md) for the release checklist.
