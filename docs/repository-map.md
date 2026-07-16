# Repository Map

This is the source and deployment boundary for the repository. It describes
what is part of the maintained product, what is an optional prototype, and what
must remain local.

## Maintained Product Paths

- `src/`: React/Vite application. It contains the CHU/MAI/MU3 CardMaker viewer
  and the CHUNITHM, maimai, and O.N.G.E.K.I. score-card UI.
- `src/scorecard/`: score-card components, public fallback song samples, song
  database adapters, and asset lookup helpers. This is part of the web app, not
  the Android CardMaker prototype.
- `src-tauri/`: Tauri desktop shell plus Rust scanners and exporters. The
  `export_mobile_pack` binary is a local pack-building tool; its presence does
  not make Android a supported release target.
- `functions/`: Cloudflare Pages Functions for serving `/official/*` and
  `/fonts/private/*` from the `ASSETS_BUCKET` R2 binding.
- `workers/songdb-sync/`: optional Cloudflare Worker that mirrors public song
  metadata used by the score-card picker.
- `scripts/cloudflare/` and `scripts/scorecard-extract/`: repository maintenance
  helpers for R2 manifests and score-card assets.
- `docs/online-preview.md`: authoritative public/private build and Cloudflare
  deployment runbook.
- `public/`: repository-safe static files copied verbatim by Vite. It may hold
  public UI assets and redistributable fonts, but never official CardMaker
  payloads or private fonts.
- `private-assets/`: local source material for private development and asset
  publication. Only placeholder files belong in Git.

## Mobile Prototype Boundary

`mobile/` contains a source-only prototype made up of:

- `CardMakerMobile.Runtime/`: dependency-light C# `.cmpack` import/runtime code.
- `CardMakerMobile.Tools/`: desktop smoke tooling for that runtime.
- `CardMakerMobile.UnityBridge/`: Unity bridge sources for a locally integrated
  reconstructed Unity project. The target-specific local patcher is excluded
  pending provenance and redistribution review.

This code is not imported by the React application, Tauri desktop runtime,
Cloudflare Pages Functions, or the score-card Worker. There is no supported
Android release, Android CI job, or committed APK/OBB in this repository.
Historical local Android build claims are archived in
`cardmaker-mobile-android-plan.md`; they are not current verification.

Tracking the source-only prototype is reasonable, but it must not pull in an
external Unity project, official data, generated packs, imported pack contents,
or .NET build output.

## Cloudflare and Asset Boundary

The public deployment has two independent layers:

1. `npm run build:public` creates the Pages static bundle.
2. Pages Functions serve runtime `/official/*` and `/fonts/private/*` requests
   from R2.

Local official assets and licensed private fonts belong under
`private-assets/official/` and `private-assets/fonts/fot/`. A public build
deliberately fails if files appear under `public/official/` or
`public/fonts/private/`, and the completed `dist` is checked again.

Score-card jackets, O.N.G.E.K.I. boss assets, and JSON maps published to R2 use
the `official/scorecard/...` key space. They are runtime assets, not files to
copy into `public/`. The score-card picker can still use its built-in public
fallback when the optional song database Worker is not configured.

See `online-preview.md` for the complete R2 key layout and deployment checks.

## Generated or Local-Only Areas

These must stay out of commits:

- `node_modules/`, `dist/`, `.wrangler/`, `.venv/`, and `.analysis/`
- `src-tauri/target/`
- `mobile/**/bin/`, `mobile/**/obj/`, and `mobile/**/__pycache__/`
- mobile imported/output directories such as `mobile/**/imported/`
- Unity project outputs such as `Library/`, `Temp/`, `Logs/`, `Build/`,
  `Builds/`, and `UserSettings/` if a Unity project is ever placed below
  `mobile/`
- generated `.cmpack`, APK, AAB, OBB, and extracted official-resource payloads
- target-specific patchers that embed reconstructed/decompiled source snippets
- real contents of `private-assets/official/` and
  `private-assets/fonts/fot/`
- one-off scratch files, backups, and local inspection output

## Documentation Status

- Keep `online-preview.md` tracked as the operational Cloudflare runbook.
- Keep `mobile-pack.md` with the mobile source as the prototype pack contract.
- Keep this repository map tracked so source/deployment boundaries are
  reviewable.
- `cardmaker-mobile-android-plan.md` is an archived 2026-05-26 R&D snapshot. If
  retained, track it as historical evidence, not as the current roadmap.
