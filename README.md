# ConfigArc CardViewer

ConfigArc CardViewer is a React/Vite web application for CHU, MAI, and MU3
card previews plus CHUNITHM, maimai, and O.N.G.E.K.I. score-card previews. This
repository contains only the public Cloudflare deployment surface.

## Deployment architecture

Cloudflare Pages serves the Vite bundle from `dist/`. A Pages Function maps the
reviewed `/official/*` request surface to an R2 binding named `ASSETS_BUCKET`.
The song-database Worker is a producer: scheduled or authenticated manual sync
fetches upstream metadata and writes it into R2. Browser reads never use the
Worker origin; they stay on the same-origin Pages Function.

Official source packages, all image and font binaries, extraction utilities,
desktop or device runtimes, and generated working directories are maintained
outside this repository. They are not copied into the Vite build. The browser
renderer source remains here; every visual, atlas, bitmap-font, and web-font
object it consumes is published to R2 by an external producer.

The browser-facing asset contract is:

- `/official/generated/cards.json` is the default card manifest.
- `/official/generated/cards.index.json` and its referenced game shards form
  the sharded manifest contract.
- Manifest asset URLs must stay under the allowlisted `/official/generated/**`
  route.
- Score-card maps and images use `/official/scorecard/**`.
- Shared card-renderer UI, atlases, hologram textures, and bitmap-font data use
  `/official/cardviewer/v1/runtime/**`.
- Redistributable web fonts and their license texts use
  `/official/cardviewer/v1/fonts/**`.
- Runtime and generated objects use reviewed JSON/image extensions; the font
  route accepts only reviewed font binaries and license text.
- Versioned image keys are uploaded before the JSON files that reference them.

See [the Cloudflare runbook](docs/online-preview.md) for the complete
route-specific allowlist, publication order, cache policy, and verification
gates.

## Commands

Use Node.js 22.20.0, pinned by `.node-version`.

```powershell
npm.cmd ci
npm.cmd --prefix workers/songdb-sync ci

npm.cmd run dev
npm.cmd run build
npm.cmd run preview
npm.cmd run preview:cloudflare
npm.cmd run check
```

Every development and build command targets the fixed public Cloudflare
runtime. `build` checks the complete `public/` tree against
`public-asset-policy.json`, then verifies that `dist` contains only reviewed
static files and Vite entry bundles. `check` runs the secret scan,
deployment-boundary tests, frontend and Function tests, the public build, and
the Worker checks. It does not publish Pages, mutate R2, or perform a live edge
verification.

Song metadata and every jacket tier are fixed to the same-origin
`/official/songdb/**` Pages route. There is no build-time origin override or
external browser fallback. The card manifest is likewise fixed to its
same-origin R2 route.

## Repository layout

- `src/`: React application and renderers.
- `public/`: reviewed app-shell control files and the fail-closed Pages 404,
  copied verbatim by Vite; runtime media and fonts do not live here.
- `public-asset-policy.json`: exact allowlist for copied and generated files.
- `functions/`: allowlisted Pages Function for R2-backed official assets.
- `workers/songdb-sync/`: upstream-to-R2 metadata synchronization Worker with
  R2-only GET diagnostics.
- `scripts/cloudflare/`: deterministic R2 publication-manifest helper.
- `tests/`: frontend, Function, artifact, secret, and repository-boundary tests.
- `docs/online-preview.md`: Cloudflare build, R2, cache, and release runbook.
- `docs/repository-map.md`: maintained source and external-input boundaries.

Do not place media or font binaries anywhere in the repository. The
deployment-boundary test rejects tracked image, font, and media extensions,
while `public-asset-policy.json` limits `public/` to `404.html`, `_headers`, and
`theme-init.js`. Vite copies that directory into `dist` even when Git ignores a
file, so the completed artifact is checked independently.

## License

Released under the [MIT License](LICENSE). The license covers source code in
this repository only; it grants no rights to third-party assets or fonts.
Redistributable runtime-font attribution is listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
