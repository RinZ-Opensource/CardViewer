# Repository Map

This is the source and deployment boundary for the repository. It describes
what is part of the maintained product, what is an optional prototype, and what
must remain local.

## Maintained Product Paths

- `src/`: React/Vite application. It contains the CHU/MAI/MU3 CardMaker viewer
  and the CHUNITHM, maimai, and O.N.G.E.K.I. score-card UI.
- `src/persistence.ts` and `src/priorityTaskScheduler.ts`: guarded browser-state
  persistence and priority-aware image-task scheduling used by the frontend.
- `src/scorecard/`: score-card components, public fallback song samples, song
  database adapters, asset lookup helpers, isolated score-input sanitizers,
  default-state factories, and surface configuration. `ScoreCardSurface`
  coordinates state and card rendering, the three `*ScoreCardEditor` files own
  their controlled form UI, `useScoreCardSongDb` owns lazy song-database loading
  and retry state, and `useScoreCardState` owns stored state initialization and
  persistence effects. `scorecardSelection.ts` contains the React-independent
  song-database migrations and selection transitions; `ScoreCardPreview.tsx`
  owns the controlled preview DOM and its five renderer branches. This is part
  of the web app, not the Android CardMaker prototype.
- `src-tauri/`: Tauri desktop shell plus Rust scanners and exporters. The
  `export_mobile_pack` binary is a local pack-building tool; its presence does
  not make Android a supported release target. The image IPC reader serves only
  canonical paths below the most recent successful UI scan and revokes the
  previous package roots and data-URL cache when that scan changes. The desktop
  shell and both exporter binaries consume the same `src/lib.rs` scanner module,
  so its unit suite is compiled and executed once per test run. Cmpack path and
  USTAR serialization are isolated in `src-tauri/src/scanner/archive.rs`; mobile
  export keeps ownership of which staged files are eligible for the archive.
  Recursive file discovery, sibling resolution, path comparison, and path
  display normalization live in the dependency-free `scanner/fsutil.rs` leaf.
  Shared game-content path construction and fallback-root selection live in
  `scanner/games/common.rs`, below the individual game parsers. CHUNITHM card
  discovery and XML parsing are isolated in `scanner/games/chu.rs`; the parent
  scanner retains orchestration and shared print-field construction. Embedded
  Python script installation and interpreter selection live in
  `scanner/tools/python.rs`; UnityPy image and bundle extraction, batching, and
  cache handling live in `scanner/tools/unity.rs`.
  Online and mobile exporters share only path/print-field normalization and
  deterministic manifest sharding through `scanner/export/common.rs` and
  `scanner/export/manifest.rs`; target-specific asset policies remain separate.
  `scanner/export/online.rs` owns the online export pipeline, including WebP
  transcodes, thumbnails, pruning, URL rewriting, and MAI composites.
  `scanner/export/mobile.rs` owns mobile pack selection, staging, Unity bundle
  indexing, raw-data inclusion, integrity manifests, and cmpack assembly.
- `functions/`: Cloudflare Pages Function for serving an allowlisted subset of
  `/official/*` from the `ASSETS_BUCKET` R2 binding. Public Cloudflare does not
  serve `/fonts/private/*`.
- `workers/songdb-sync/`: optional Cloudflare Worker that mirrors public song
  metadata used by the score-card picker. Its Node behavior suite covers auth,
  route validation, R2 hits, lazy origin reads, and scheduled/manual sync.
- `scripts/cloudflare/` and `scripts/scorecard-extract/`: repository maintenance
  helpers for R2 manifests and score-card assets.
- `tests/module-boundaries.test.mjs` keeps shared frontend modules below their
  consumers: hooks cannot depend on cards, card data cannot depend on render
  layers, card assets cannot depend on cards, hooks, or the app shell,
  holographic mask math and state types remain type-only leaves below the React
  renderer, score-card surface configuration cannot depend on React,
  persistence, or card components, default-state factories are limited to
  samples and state types, and the score-card editors remain controlled UI
  leaves below the surface and song-database hook. Selection transitions remain
  below React, persistence, export, and rendering modules. It runs under
  `npm run check` alongside the holographic mask math, score-card model,
  frontend reliability, secret-scanner, public-dist, and Pages Function suites.
- `.github/workflows/ci.yml`: read-only pull-request and `main` validation for
  the web checks, pinned Rust formatting/lints/locked tests, and the
  dependency-free .NET mobile Runtime/Smoke build; it does not deploy or
  reference repository secrets.
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
Android release, Unity/Android build job, or committed APK/OBB in this
repository. The ordinary .NET CI job compiles only Runtime and CmpackSmoke; it
does not establish Unity or Android compatibility.
Historical local Android build claims are archived in
`cardmaker-mobile-android-plan.md`; they are not current verification.

Tracking the source-only prototype is reasonable, but it must not pull in an
external Unity project, official data, generated packs, imported pack contents,
or .NET build output. `npm run check:mobile-boundary` scans the exact Git index
and changed working-tree variants under `mobile/`; it rejects those generated
areas, target-specific patchers, Android/pack deliverables, DLLs, and binary
content even if an ignored file was added with `git add --force`.

## Cloudflare and Asset Boundary

The public deployment has two independent layers:

1. `npm run build:public` creates and checks the Pages static bundle.
2. The Pages Function applies the runtime R2 allowlist for `/official/*`.

These are separate release gates. A clean `dist` does not prove that R2 is
restricted, and a correct Function allowlist does not make a contaminated
static bundle safe.

Local official assets and licensed private fonts belong under
`private-assets/official/` and `private-assets/fonts/fot/`. A public build
deliberately fails if files appear under `public/official/` or
`public/fonts/private/`, and the completed `dist` is checked again.
Licensed fonts are available only to private Vite/Tauri workflows; the public
Cloudflare deployment has no private-font Function.

The public Function accepts only `official/generated/**`,
`official/scorecard/**`, and these reviewed root resources:

- `official/C310Busb_CardBack.png`
- `official/UI_Card_Horo_Rainbow_Hard.png`
- `official/UI_Card_Horo_Pattern_00.png`

It additionally restricts files to `.json`, `.png`, `.jpg`, `.jpeg`, or
`.webp`, rejects hidden or abnormal path segments, forces the response MIME
type from that reviewed extension, and sends `X-Content-Type-Options: nosniff`.
Everything else in R2 is outside the Pages route. Do not attach a public custom
domain directly to the bucket or a broader prefix, because that bypasses this
boundary.

Score-card jackets, O.N.G.E.K.I. boss assets, and JSON maps published to R2 use
the `official/scorecard/...` key space. They are runtime assets, not files to
copy into `public/`. The score-card picker can still use its built-in public
fallback when the optional song database Worker is not configured.

The local `private-assets/official/generated` tree may contain logs, scripts,
command files, PID files, and other local output. It is not safe to mirror as a
directory. Only resources present in reviewed, extension-specific R2 bulk
manifests belong in the public bucket/prefix.

See `online-preview.md` for the complete R2 key layout and deployment checks.

## Generated or Local-Only Areas

These must stay out of commits:

- `node_modules/`, `dist/`, `.wrangler/`, `.venv/`, and `.analysis/`
- `src-tauri/target/`
- `mobile/**/bin/`, `mobile/**/obj/`, and `mobile/**/__pycache__/`
- mobile imported/staging areas such as `mobile/**/imported/`,
  `mobile/**/.cmpack-staging/`, and
  `mobile/**/StreamingAssets.mobilebuild_externalized*/`
- external Unity project roots below `mobile/`, including `Assets/`,
  `ProjectSettings/`, and `Packages/`
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
