#!/usr/bin/env python3
"""Prepare deterministic, high-resolution scorecard jacket bundles.

The output is intentionally suitable for static/CDN hosting: image filenames
stay identical to otoge-db, while their contents come from local game data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Sequence

from PIL import Image


EXPECTED = {
    "maimai": (".png", "PNG", (400, 400), "image_url"),
    "chunithm": (".jpg", "JPEG", (300, 300), "image"),
    "ongeki": (".png", "PNG", (512, 512), "image_url"),
}

CHUNITHM_VERSE_TARGETS = {
    "8303": "609af8fb1bf0bc94.jpg",
    "8304": "8b145fe4cf0c01bb.jpg",
}


class PreparationError(RuntimeError):
    """A fail-closed input, mapping, or verification error."""


@dataclass(frozen=True)
class PlannedImage:
    target: str
    source: Path
    source_key: str
    output_kind: str
    width: int
    height: int


class JacketIndex:
    """Case-insensitive filename lookup with later roots taking precedence."""

    def __init__(self, roots: Sequence[Path]) -> None:
        self._by_name: dict[str, list[tuple[int, Path]]] = defaultdict(list)
        for rank, root in enumerate(roots):
            if not root.is_dir():
                raise PreparationError(f"jacket root is not a directory: {root}")
            files = sorted(
                (path for path in root.rglob("*") if path.is_file()),
                key=lambda path: str(path).casefold(),
            )
            for path in files:
                self._by_name[path.name.casefold()].append((rank, path))

    def find(self, filename: str) -> Path | None:
        candidates = self._by_name.get(filename.casefold(), [])
        if not candidates:
            return None
        return max(candidates, key=lambda item: (item[0], str(item[1]).casefold()))[1]


def _load_song_db(location: str) -> list[dict[str, Any]]:
    if location.startswith(("https://", "http://")):
        with urllib.request.urlopen(location, timeout=30) as response:
            raw = response.read()
    else:
        raw = Path(location).read_bytes()
    try:
        value = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PreparationError(f"invalid song database JSON: {location}: {exc}") from exc
    if not isinstance(value, list) or not all(isinstance(row, dict) for row in value):
        raise PreparationError("song database JSON must be an array of objects")
    return value


def _safe_target(value: Any, game: str) -> str:
    if not isinstance(value, str) or not value:
        raise PreparationError(f"invalid {game} image target: {value!r}")
    if value != Path(value).name or "/" in value or "\\" in value:
        raise PreparationError(f"image target must be a plain filename: {value!r}")
    extension = EXPECTED[game][0]
    if Path(value).suffix.casefold() != extension:
        raise PreparationError(
            f"unexpected {game} image extension for {value!r}; expected {extension}"
        )
    return value


def _row_target(row: dict[str, Any], game: str) -> str | None:
    value = row.get(EXPECTED[game][3])
    if value in (None, ""):
        return None
    return _safe_target(value, game)


def _canonical_number(value: Any) -> str | None:
    try:
        return str(int(str(value).strip()))
    except (TypeError, ValueError):
        return None


def _canonical_bpm(value: Any) -> Decimal | None:
    try:
        return Decimal(str(value).strip()).normalize()
    except (InvalidOperation, TypeError, ValueError):
        return None


def _normal_text(value: Any) -> str:
    normalized = unicodedata.normalize("NFKC", "" if value is None else str(value))
    return " ".join(normalized.split())


def _xml_text(root: ET.Element, path: str) -> str:
    return (root.findtext(path) or "").strip()


def _iter_music_xml(roots: Sequence[Path]) -> Iterable[tuple[int, Path]]:
    for rank, root in enumerate(roots):
        if not root.is_dir():
            raise PreparationError(f"game data root is not a directory: {root}")
        paths = sorted(root.rglob("Music.xml"), key=lambda path: str(path).casefold())
        for path in paths:
            yield rank, path


def _parse_xml(path: Path) -> ET.Element:
    try:
        return ET.parse(path).getroot()
    except (ET.ParseError, OSError) as exc:
        raise PreparationError(f"cannot parse {path}: {exc}") from exc


def _validate_source(path: Path, expected_format: str, expected_size: tuple[int, int]) -> None:
    try:
        with Image.open(path) as image:
            actual_format = image.format
            actual_size = image.size
            image.verify()
    except (OSError, ValueError) as exc:
        raise PreparationError(f"cannot decode source image {path}: {exc}") from exc
    if actual_format != expected_format or actual_size != expected_size:
        raise PreparationError(
            f"invalid source image {path}: format={actual_format}, size={actual_size}; "
            f"expected format={expected_format}, size={expected_size}"
        )


def _add_plan(plans: dict[str, PlannedImage], plan: PlannedImage) -> None:
    current = plans.get(plan.target)
    if current is not None and current.source_key.casefold() != plan.source_key.casefold():
        # Regional clone records sometimes reference byte-identical art under
        # different DDS names. That is one effective source. Different pixels
        # still fail closed instead of silently selecting one side.
        if _image_fingerprint(current) != _image_fingerprint(plan):
            raise PreparationError(
                "target collision maps different official sources to the same output: "
                f"{plan.target}: {current.source_key} ({current.source}) vs "
                f"{plan.source_key} ({plan.source})"
            )
    # Repeated game-data roots can contain the same logical source. The stable
    # scan order means a later root deliberately supersedes an earlier copy.
    plans[plan.target] = plan


def _image_fingerprint(plan: PlannedImage) -> bytes:
    digest = hashlib.sha256()
    digest.update(plan.output_kind.encode("ascii"))
    if plan.output_kind == "copy":
        with plan.source.open("rb") as source_file:
            for chunk in iter(lambda: source_file.read(1024 * 1024), b""):
                digest.update(chunk)
    elif plan.output_kind == "jpeg":
        with Image.open(plan.source) as image:
            rgb = image.convert("RGB")
            digest.update(f"{rgb.width}x{rgb.height}".encode("ascii"))
            digest.update(rgb.tobytes())
    else:
        raise PreparationError(f"unknown output kind: {plan.output_kind}")
    return digest.digest()


def _unique_target(rows: Sequence[dict[str, Any]], game: str, context: str) -> str | None:
    targets = sorted(
        {target for row in rows if (target := _row_target(row, game)) is not None}
    )
    if not targets:
        return None
    if len(targets) != 1:
        raise PreparationError(f"ambiguous {context}: targets={targets}")
    return targets[0]


def _prepare_maimai(
    rows: list[dict[str, Any]], game_roots: Sequence[Path], jacket_roots: Sequence[Path]
) -> dict[str, PlannedImage]:
    by_title: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if _row_target(row, "maimai") is not None:
            by_title[_normal_text(row.get("title"))].append(row)

    index = JacketIndex(jacket_roots)
    plans: dict[str, PlannedImage] = {}
    data_name_re = re.compile(r"^music(\d+)$", re.IGNORECASE)

    for _, xml_path in _iter_music_xml(game_roots):
        root = _parse_xml(xml_path)
        match = data_name_re.fullmatch(_xml_text(root, "dataName"))
        if match is None:
            continue
        jacket_id = int(match.group(1)) % 10000
        if jacket_id in {854, 1879}:
            continue

        title = _normal_text(_xml_text(root, "./name/str"))
        artist = _normal_text(_xml_text(root, "./artistName/str"))
        bpm = _canonical_bpm(_xml_text(root, "bpm"))
        candidates = list(by_title.get(title, []))

        # One source record in this dump has a blank title. Artist+BPM still
        # identify it uniquely, without introducing fuzzy matching.
        if not candidates and not title:
            candidates = [
                row
                for row in rows
                if _normal_text(row.get("artist")) == artist
                and _canonical_bpm(row.get("bpm")) == bpm
                and _row_target(row, "maimai") is not None
            ]

        if not candidates:
            continue
        filtered = candidates
        if len({_row_target(row, "maimai") for row in filtered}) > 1:
            filtered = [
                row for row in candidates if _normal_text(row.get("artist")) == artist
            ]
            if not filtered:
                continue
        if len({_row_target(row, "maimai") for row in filtered}) > 1:
            filtered = [
                row for row in filtered if _canonical_bpm(row.get("bpm")) == bpm
            ]
            if not filtered:
                continue
        target = _unique_target(
            filtered,
            "maimai",
            f"maimai title/artist/BPM {title!r}/{artist!r}/{bpm}",
        )
        if target is None:
            continue

        source_name = f"UI_Jacket_{jacket_id:06d}.png"
        source = index.find(source_name)
        if source is None:
            continue
        _validate_source(source, "PNG", (400, 400))
        _add_plan(
            plans,
            PlannedImage(target, source, source_name, "copy", 400, 400),
        )
    return plans


def _db_targets_by_id(rows: list[dict[str, Any]], game: str) -> dict[str, str]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        song_id = _canonical_number(row.get("id"))
        if song_id is not None and _row_target(row, game) is not None:
            grouped[song_id].append(row)

    result: dict[str, str] = {}
    for song_id, matches in grouped.items():
        if game == "chunithm" and song_id in CHUNITHM_VERSE_TARGETS:
            forced = CHUNITHM_VERSE_TARGETS[song_id]
            available = {_row_target(row, game) for row in matches}
            if forced not in available:
                raise PreparationError(
                    f"forced CHUNITHM VERSE target is absent for id {song_id}: {forced}"
                )
            result[song_id] = forced
        else:
            target = _unique_target(matches, game, f"{game} id {song_id}")
            if target is not None:
                result[song_id] = target
    return result


def _safe_relative_path(value: str, context: str) -> PurePosixPath:
    path = PurePosixPath(value.replace("\\", "/"))
    if not value or path.is_absolute() or ".." in path.parts:
        raise PreparationError(f"unsafe {context} path: {value!r}")
    return path


def _prepare_chunithm(
    rows: list[dict[str, Any]], game_roots: Sequence[Path], jacket_roots: Sequence[Path]
) -> dict[str, PlannedImage]:
    targets = _db_targets_by_id(rows, "chunithm")
    fallback = JacketIndex(jacket_roots) if jacket_roots else None
    plans: dict[str, PlannedImage] = {}

    for _, xml_path in _iter_music_xml(game_roots):
        root = _parse_xml(xml_path)
        song_id = _canonical_number(_xml_text(root, "./name/id"))
        if song_id is None or song_id not in targets:
            continue
        relative = _safe_relative_path(
            _xml_text(root, "./jaketFile/path"), f"CHUNITHM {song_id} jacket"
        )
        if relative.suffix.casefold() != ".dds":
            raise PreparationError(f"CHUNITHM source is not DDS: {relative}")
        source = xml_path.parent.joinpath(*relative.parts)
        if not source.is_file() and fallback is not None:
            source = fallback.find(relative.name) or source
        if not source.is_file():
            continue
        _validate_source(source, "DDS", (300, 300))
        _add_plan(
            plans,
            PlannedImage(
                targets[song_id],
                source,
                relative.as_posix(),
                "jpeg",
                300,
                300,
            ),
        )
    return plans


def _prepare_ongeki(
    rows: list[dict[str, Any]], game_roots: Sequence[Path], jacket_roots: Sequence[Path]
) -> dict[str, PlannedImage]:
    targets = _db_targets_by_id(rows, "ongeki")
    index = JacketIndex(jacket_roots)
    plans: dict[str, PlannedImage] = {}

    for _, xml_path in _iter_music_xml(game_roots):
        root = _parse_xml(xml_path)
        db_id = _canonical_number(_xml_text(root, "SortOrder"))
        music_id = _canonical_number(_xml_text(root, "./Name/id"))
        if db_id is None or music_id is None or db_id not in targets:
            continue
        source_name = f"UI_Jacket_{int(music_id):04d}.png"
        source = index.find(source_name)
        if source is None:
            continue
        _validate_source(source, "PNG", (512, 512))
        _add_plan(
            plans,
            PlannedImage(targets[db_id], source, source_name, "copy", 512, 512),
        )
    return plans


def _coverage(rows: list[dict[str, Any]], game: str, targets: set[str]) -> dict[str, int]:
    mapped_rows = sum(1 for row in rows if _row_target(row, game) in targets)
    return {
        "songDbRows": len(rows),
        "mappedRows": mapped_rows,
        "uniqueImages": len(targets),
    }


def _write_outputs(
    version_dir: Path,
    game: str,
    version: int,
    rows: list[dict[str, Any]],
    plans: dict[str, PlannedImage],
) -> Path:
    version_dir.mkdir(parents=True, exist_ok=True)
    expected_targets = set(plans)

    for target in sorted(plans):
        plan = plans[target]
        destination = version_dir / target
        temporary = version_dir / f".{target}.tmp"
        if temporary.exists():
            temporary.unlink()
        if plan.output_kind == "copy":
            shutil.copyfile(plan.source, temporary)
        elif plan.output_kind == "jpeg":
            with Image.open(plan.source) as image:
                image.convert("RGB").save(
                    temporary,
                    format="JPEG",
                    quality=95,
                    subsampling=0,
                    optimize=False,
                    progressive=False,
                )
        else:
            raise PreparationError(f"unknown output kind: {plan.output_kind}")
        os.replace(temporary, destination)

    for path in sorted(version_dir.iterdir(), key=lambda item: item.name.casefold()):
        if path.is_dir():
            raise PreparationError(f"unexpected directory in output: {path}")
        if path.name not in expected_targets:
            path.unlink()

    manifest = {
        "version": version,
        "game": game,
        "images": {
            target: {"width": plans[target].width, "height": plans[target].height}
            for target in sorted(plans)
        },
        "coverage": _coverage(rows, game, expected_targets),
    }
    manifest_path = version_dir.parent / "jacket-map.json"
    temporary_manifest = version_dir.parent / ".jacket-map.json.tmp"
    temporary_manifest.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    os.replace(temporary_manifest, manifest_path)
    return manifest_path


def _verify(
    version_dir: Path,
    game: str,
    version: int,
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    manifest_path = version_dir.parent / "jacket-map.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PreparationError(f"cannot read manifest {manifest_path}: {exc}") from exc

    if not isinstance(manifest, dict):
        raise PreparationError("manifest root must be an object")
    if set(manifest) != {"version", "game", "images", "coverage"}:
        raise PreparationError(f"manifest has unexpected keys: {sorted(manifest)}")
    if manifest.get("version") != version or manifest.get("game") != game:
        raise PreparationError(
            f"manifest identity mismatch: expected game={game}, version={version}"
        )
    images = manifest.get("images")
    if not isinstance(images, dict):
        raise PreparationError("manifest images must be an object")

    extension, expected_format, expected_size, _ = EXPECTED[game]
    manifest_targets: set[str] = set()
    for target, dimensions in images.items():
        safe_target = _safe_target(target, game)
        if Path(safe_target).suffix.casefold() != extension:
            raise PreparationError(f"invalid manifest target extension: {safe_target}")
        if dimensions != {"width": expected_size[0], "height": expected_size[1]}:
            raise PreparationError(
                f"invalid manifest dimensions for {safe_target}: {dimensions}"
            )
        path = version_dir / safe_target
        try:
            with Image.open(path) as image:
                actual_format = image.format
                actual_size = image.size
                image.verify()
        except (OSError, ValueError) as exc:
            raise PreparationError(f"cannot verify output image {path}: {exc}") from exc
        if actual_format != expected_format or actual_size != expected_size:
            raise PreparationError(
                f"output mismatch {path}: format={actual_format}, size={actual_size}"
            )
        manifest_targets.add(safe_target)

    output_targets: set[str] = set()
    for path in version_dir.iterdir():
        if path.is_dir():
            raise PreparationError(f"unexpected directory in output: {path}")
        output_targets.add(path.name)
    if output_targets != manifest_targets:
        missing = sorted(manifest_targets - output_targets)
        extra = sorted(output_targets - manifest_targets)
        raise PreparationError(f"output target set mismatch: missing={missing}, extra={extra}")

    db_targets = {
        target for row in rows if (target := _row_target(row, game)) is not None
    }
    unknown = sorted(manifest_targets - db_targets)
    if unknown:
        raise PreparationError(f"manifest targets absent from song database: {unknown}")

    expected_coverage = _coverage(rows, game, manifest_targets)
    if manifest.get("coverage") != expected_coverage:
        raise PreparationError(
            f"coverage mismatch: manifest={manifest.get('coverage')}, "
            f"expected={expected_coverage}"
        )
    return {
        "manifest": str(manifest_path),
        "game": game,
        "version": version,
        "coverage": expected_coverage,
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game", required=True, choices=sorted(EXPECTED))
    parser.add_argument("--songdb-json", required=True)
    parser.add_argument("--game-data-root", action="append", default=[])
    parser.add_argument("--jacket-root", action="append", default=[])
    parser.add_argument("--out", required=True)
    parser.add_argument("--version", type=int, default=1)
    parser.add_argument("--verify-only", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.version < 1:
            raise PreparationError("--version must be a positive integer")
        rows = _load_song_db(args.songdb_json)
        version_dir = Path(args.out) / f"v{args.version}"

        if not args.verify_only:
            game_roots = [Path(value) for value in args.game_data_root]
            jacket_roots = [Path(value) for value in args.jacket_root]
            if not game_roots:
                raise PreparationError("at least one --game-data-root is required")
            if args.game in {"maimai", "ongeki"} and not jacket_roots:
                raise PreparationError(f"at least one --jacket-root is required for {args.game}")

            if args.game == "maimai":
                plans = _prepare_maimai(rows, game_roots, jacket_roots)
            elif args.game == "chunithm":
                plans = _prepare_chunithm(rows, game_roots, jacket_roots)
            else:
                plans = _prepare_ongeki(rows, game_roots, jacket_roots)
            _write_outputs(version_dir, args.game, args.version, rows, plans)

        result = _verify(version_dir, args.game, args.version, rows)
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except PreparationError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
