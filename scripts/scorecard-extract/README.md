# Score-card extraction tools

These scripts document how the score-card layout dumps and private sprite inputs
used by `src/scorecard/` were derived. They are developer tools, not part of the
Vite or Cloudflare build. Running them is optional unless the upstream game
assets are being re-extracted.

The scripts never download game assets. Supply a legally obtained local source
tree explicitly, either with command-line options or the environment variables
below. Run every command from the repository root.

## Requirements

- Python 3.10 or newer.
- [Pillow](https://pillow.readthedocs.io/) for the CHUNITHM/ONGEKI crop and
  prebake scripts (`python -m pip install Pillow`). Pillow must be able to read
  the source DDS format used by the CHUNITHM export.
- CHUNITHM extraction: the `data/surfboard` directory containing the source SRD
  files and `texture/*.dds`.
- ONGEKI/maimai parsing: a Unity `ExportedProject/Assets` tree retaining YAML
  `.prefab`/`.asset` files, `.meta` GUIDs, and exported `Texture2D` PNGs.

Useful environment variables:

| Variable | Meaning |
| --- | --- |
| `CARDVIEWER_CHUNI_SURFBOARD_ROOT` | CHUNITHM `data/surfboard` directory |
| `CARDVIEWER_ONGEKI_ASSETS` | ONGEKI `ExportedProject/Assets` directory |
| `CARDVIEWER_MAIMAI_ASSETS` | maimai `ExportedProject/Assets` directory |
| `CARDVIEWER_SCORECARD_ASSET_ROOT` | Directory containing the generated `chuni/` and `ongeki/` sprite trees |

Each input option can also be passed directly. `--help` is authoritative for a
script's complete interface.

## CHUNITHM

With `CARDVIEWER_CHUNI_SURFBOARD_ROOT` set, reproduce both supported layouts:

```powershell
python scripts/scorecard-extract/extract_chuni_musicinfo.py `
  --scratch-dir .analysis/scorecard-extract
python scripts/scorecard-extract/extract_chuni_musicbox.py `
  --scratch-dir .analysis/scorecard-extract
```

Without the environment variable, pass both `--srd` and `--texture-dir`.
`--output-dir` defaults to
`private-assets/official/scorecard/chuni`; it contains cropped PNGs plus
`manifest.json` or `manifest_musicbox.json`.

## ONGEKI

With `CARDVIEWER_ONGEKI_ASSETS` set, build the GUID cache, dump both prefab
layouts, and cut their atlas sprites:

```powershell
python scripts/scorecard-extract/ongeki_guid_index.py --refresh
python scripts/scorecard-extract/parse_ongeki_playmusic.py `
  --output-dir .analysis/scorecard-extract
python scripts/scorecard-extract/parse_ongeki_musicbt.py `
  --output-dir .analysis/scorecard-extract
python scripts/scorecard-extract/cut_ongeki_sprites.py
python scripts/scorecard-extract/cut_ongeki_musicbt_sprites.py
```

Use `--assets` instead of the environment variable when preferred. The parser
prefab paths are derived from that Assets directory, but can be overridden with
`--prefab`. The crop scripts default to
`private-assets/official/scorecard/ongeki` and write PNGs plus `manifest.json`
or `manifest_musicbt.json`.

`parse_ongeki_musicbt.py` builds its GUID cache on demand. The cache records its
source Assets directory and is rebuilt automatically when `--assets` points to
a different export. Pass `--refresh-guid-cache` to force a rescan of the same
export, or build the cache first with `ongeki_guid_index.py --refresh`. A custom
cache can be selected with `--guid-cache`/`--cache`.

## maimai and final prebake

The TrackStart parser follows the same convention:

```powershell
python scripts/scorecard-extract/parse_trackstart.py `
  --output-dir .analysis/scorecard-extract
```

Set `CARDVIEWER_MAIMAI_ASSETS` or pass `--assets`. Once the CHUNITHM and ONGEKI
sprites have been cut, generate the CSS-export-safe static PNGs in place:

```powershell
python scripts/scorecard-extract/prebake_scorecard_statics.py
```

The prebake root defaults to `private-assets/official/scorecard`; override it
with `--scorecard-root` or `CARDVIEWER_SCORECARD_ASSET_ROOT`.

## Tracking boundary

Track the Python source files in this directory and this README. Do not track
the source game data or any generated artifacts, including:

- `*_tree.json`, `*_tree.txt`, `musicbase_dump.json`, and
  `musicbase_tree.txt`;
- `ongeki_guid_cache.json`, `chk_montage_*.png`, `__pycache__/`, and `.pyc`
  files;
- cropped manifests, cropped PNGs, prebaked PNGs, and jacket/card exports under
  `private-assets/`;
- temporary inspection output under `.analysis/`.

`private-assets/` is the local/R2 source boundary. These tools do not make its
contents eligible for the public Pages bundle.
