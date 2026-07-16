# ConfigArc CardViewer

A React/Vite/Tauri viewer for CardMaker resources, with card rendering for CHU,
MAI, and MU3 plus score-card previews for CHUNITHM, maimai, and O.N.G.E.K.I.

## Deployment modes

| Mode | Intended use | Local-only inputs |
| --- | --- | --- |
| `private` | Tauri, LAN, and controlled previews | `private-assets/official` is served as `/official`; `private-assets/fonts/fot` is served as `/fonts/private` |
| `public` | Cloudflare Pages or another public static deployment | The private-assets Vite plugin is disabled |

Official assets and licensed fonts are not repository content. Keep them under
`private-assets/`; do not place copies in Vite's `public/` directory. Vite always
copies `public/` into `dist`, even in public mode, so a local
`public/official` or `public/fonts/private` directory can contaminate a public
artifact. Inspect `dist` before any direct upload.

The Cloudflare deployment uses Pages Functions to serve `/official/*` and
`/fonts/private/*` from an R2 binding named `ASSETS_BUCKET`. Those runtime
assets are separate from the public Vite bundle. See
[docs/online-preview.md](docs/online-preview.md) for the asset layout, local
preview boundary, and deployment checklist.

## Commands

Install both locked JavaScript toolchains after a clean checkout:

```powershell
npm.cmd ci
npm.cmd --prefix workers/songdb-sync ci
```

```powershell
npm.cmd run dev:private
npm.cmd run dev:public
npm.cmd run build:private
npm.cmd run build:public
npm.cmd run check
npm.cmd run check:all
npm.cmd run preview:cloudflare
npm.cmd run tauri:dev
npm.cmd run tauri:build
```

`build:public` refuses to run while local files exist under `public/official` or
`public/fonts/private`, and verifies the completed `dist` before returning
success. `check` tests the dist guard, runs that public build, syntax-checks both
Pages Functions, and type-checks the songdb Worker. It is not an R2 integration
test. `check:all` also runs the Rust/Tauri check.

`VITE_SONGDB_BASE_URL` may be supplied at dev/build time to use the optional
song database Worker. It is a public endpoint setting, not a secret. If it is
unset, the score-card picker uses its built-in public data fallback.

## License

Released under the [MIT License](LICENSE). The license covers the source code in
this repository only; it grants no rights to third-party assets or fonts used
locally or served from an external asset store.
