# ConfigArc CardViewer

A local card viewer for CardMaker resources, built with React, Vite, and Tauri.

It renders cards for multiple games (CHU / MAI / MU3) with a 3D tilt preview and a
holographic foil effect.

## Deployment modes

The app builds in two modes:

| Mode      | Use                                          | Assets                                     |
| --------- | -------------------------------------------- | ------------------------------------------ |
| `private` | Local desktop builds / controlled previews   | Uses local proprietary card assets + fonts |
| `public`  | Builds that must ship without that content   | Runs without the proprietary asset set     |

Proprietary assets and fonts are **not included in this repository** — they are
local-only inputs. To run in private mode, place them under `public/official/`
and `public/fonts/private/`. Public mode runs without them.

## Commands

```powershell
npm run dev:private        # dev server, private mode (default)
npm run dev:public         # dev server, public mode
npm run build:private      # production build, private mode
npm run build:public       # production build, public mode
npm run tauri:dev          # run inside the Tauri desktop shell
npm run tauri:build        # build the desktop app
```

## License

Released under the [MIT License](LICENSE). The license covers the source code in
this repository only; it does not grant any rights to third-party assets or fonts
used locally.
