# ConfigArc CardViewer

ConfigArc CardViewer is a React/Vite web application for CHU, MAI, and MU3
card previews plus CHUNITHM, maimai, and O.N.G.E.K.I. score-card previews. This
repository contains only the public Cloudflare deployment surface.

## Deployment architecture

Cloudflare Pages serves the Vite bundle from `dist/`. A Pages Function maps the
reviewed `/official/*` request surface to an R2 binding named `ASSETS_BUCKET`.
The optional song-database Worker supplies public metadata and jacket fallbacks.

Official source packages, licensed fonts, extraction utilities, desktop or
device runtimes, and generated working directories are maintained outside this
repository. They are not copied into the Vite build. External producers may
publish only reviewed output objects to R2.

The browser-facing asset contract is:

- `/official/generated/cards.json` is the default card manifest.
- `/official/generated/cards.index.json` and its referenced game shards form
  the sharded manifest contract.
- Manifest asset URLs must stay under the allowlisted `/official/generated/**`
  route.
- Score-card maps and images use `/official/scorecard/**`.
- Published files must be `.json`, `.png`, `.jpg`, `.jpeg`, or `.webp`.
- Versioned image keys are uploaded before the JSON files that reference them.

The Pages Function additionally exposes one reviewed root card-back resource. See
[the Cloudflare runbook](docs/online-preview.md) for the complete allowlist,
publication order, cache policy, and verification gates.

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

`VITE_CARD_MANIFEST_URL` may select another public, credential-free card
manifest URL. `VITE_SONGDB_BASE_URL` may select the optional public Worker
origin. Both values are embedded in browser code at build time and must never
contain secrets.

## Repository layout

- `src/`: React application and renderers.
- `public/`: reviewed redistributable static files copied verbatim by Vite.
- `public-asset-policy.json`: exact allowlist for copied and generated files.
- `functions/`: allowlisted Pages Function for R2-backed official assets.
- `workers/songdb-sync/`: optional public song metadata Worker.
- `scripts/cloudflare/`: deterministic R2 publication-manifest helper.
- `tests/`: frontend, Function, artifact, secret, and repository-boundary tests.
- `docs/online-preview.md`: Cloudflare build, R2, cache, and release runbook.
- `docs/repository-map.md`: maintained source and external-input boundaries.

Do not place any unreviewed file under `public/`; in particular, official
assets, licensed fonts, environment files, and credentials never belong there.
Vite copies that directory into `dist` even when Git ignores a file. An
intentional static-file change therefore requires an explicit policy update,
and the completed artifact is checked independently.

## License

Released under the [MIT License](LICENSE). The license covers source code in
this repository only; it grants no rights to third-party assets or fonts.
Redistributable bundled fonts and their notices are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
