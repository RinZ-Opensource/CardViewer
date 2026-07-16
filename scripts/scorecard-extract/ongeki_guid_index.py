#!/usr/bin/env python3
"""Build or query an ONGEKI Unity-export GUID index.

The cache maps Unity GUIDs to asset paths relative to the supplied ``Assets``
directory. The cache is generated data and may be deleted or rebuilt at any
time.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_CACHE = SCRIPT_DIR / "ongeki_guid_cache.json"
CACHE_FORMAT = 1


def load(
    assets_root: str | os.PathLike[str] | None = None,
    cache_path: str | os.PathLike[str] = DEFAULT_CACHE,
    *,
    refresh: bool = False,
) -> dict[str, str]:
    """Load a cached GUID index, building it from ``assets_root`` if needed."""

    cache = Path(cache_path).expanduser().resolve()
    root: Path | None = None
    if assets_root is not None:
        root = Path(assets_root).expanduser().resolve()
        if not root.is_dir():
            raise ValueError(f"ONGEKI Assets directory does not exist: {root}")

    if cache.is_file() and not refresh:
        with cache.open(encoding="utf-8") as file:
            cached = json.load(file)

        has_metadata = isinstance(cached, dict) and any(
            key in cached for key in ("format", "assets_root", "index")
        )
        valid_metadata = (
            isinstance(cached, dict)
            and cached.get("format") == CACHE_FORMAT
            and isinstance(cached.get("assets_root"), str)
            and isinstance(cached.get("index"), dict)
        )
        if valid_metadata:
            cached_root = Path(cached["assets_root"]).expanduser().resolve()
            if root is None or os.path.normcase(root) == os.path.normcase(cached_root):
                return cached["index"]
        elif has_metadata and root is None:
            raise ValueError(
                "GUID cache metadata is invalid or unsupported; rebuild it with --assets"
            )
        elif root is None and isinstance(cached, dict):
            # Legacy caches contained only the GUID mapping. They remain usable
            # for queries, but are rebuilt when a source Assets tree is known.
            return cached

    if root is None:
        raise ValueError("an ONGEKI Assets directory is required to build the GUID cache")

    index: dict[str, str] = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort(key=str.casefold)
        for filename in sorted(filenames, key=str.casefold):
            if not filename.endswith(".meta"):
                continue
            meta_path = Path(dirpath) / filename
            try:
                with meta_path.open(encoding="utf-8", errors="ignore") as file:
                    contents = file.read(400)
                match = re.search(r"guid: ([0-9a-f]{32})", contents)
                if match:
                    asset_path = meta_path.with_suffix("")
                    index[match.group(1)] = asset_path.relative_to(root).as_posix()
            except (OSError, ValueError):
                continue

    cache.parent.mkdir(parents=True, exist_ok=True)
    with cache.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(
            {
                "format": CACHE_FORMAT,
                "assets_root": os.fspath(root),
                "index": index,
            },
            file,
            indent=2,
            sort_keys=True,
        )
        file.write("\n")
    return index


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--assets",
        type=Path,
        default=os.environ.get("CARDVIEWER_ONGEKI_ASSETS"),
        help="Unity ExportedProject/Assets directory (default: CARDVIEWER_ONGEKI_ASSETS).",
    )
    parser.add_argument(
        "--cache",
        type=Path,
        default=DEFAULT_CACHE,
        help="GUID cache path (default: next to this script).",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Rebuild the cache even when it already exists.",
    )
    parser.add_argument("guids", nargs="*", help="GUIDs to query after loading the index.")
    args = parser.parse_args()
    if (args.refresh or not args.cache.is_file()) and args.assets is None:
        parser.error("--assets is required to create or refresh the cache")
    return args


def main() -> int:
    args = parse_args()
    try:
        index = load(args.assets, args.cache, refresh=args.refresh)
    except ValueError as exc:
        raise SystemExit(f"error: {exc}") from exc
    print("entries:", len(index))
    for guid in args.guids:
        print(guid, "->", index.get(guid, "?"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
