#!/usr/bin/env python3
"""Export the ONGEKI scorecard boss-card lookup and original icon PNGs."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import struct
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
EXPECTED_ICON_SIZE = (256, 256)
MANIFEST_NAME = "boss-map.json"
ASSET_VERSION = "v1"

KNOWN_MAPPINGS: dict[int, tuple[str, int]] = {
    668700: ("0036", 100005),
    667300: ("0063", 100005),
    669000: ("0064", 100014),
    689900: ("0937", 101552),
}


class ExportError(RuntimeError):
    """Raised when source data or generated output fails validation."""


@dataclass(frozen=True)
class SongBoss:
    sort_order: int
    music_id: str
    boss_card_id: int
    xml_path: Path


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Export ONGEKI Music.xml BossCard mappings and their original "
            "256x256 card-icon PNGs."
        )
    )
    parser.add_argument(
        "--game-data-root",
        type=Path,
        required=True,
        help="GameData, A000, or music directory containing musicNNNN/Music.xml.",
    )
    parser.add_argument(
        "--icon-root",
        type=Path,
        required=True,
        help="Directory containing UI_Card_Icon_NNNNNN.png files.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        required=True,
        help="Output directory for boss-map.json and v1 icon assets.",
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Validate sources and an existing output without writing anything.",
    )
    return parser.parse_args(argv)


def discover_music_xml(game_data_root: Path) -> list[Path]:
    root = game_data_root.resolve()
    if not root.is_dir():
        raise ExportError(f"game-data root is not a directory: {root}")

    candidates: set[Path] = set()
    if root.name.casefold() == "music":
        candidates.update(root.glob("music*/Music.xml"))
    candidates.update(root.glob("music/music*/Music.xml"))
    candidates.update(root.glob("*/music/music*/Music.xml"))

    music_xml = sorted(
        (path.resolve() for path in candidates if path.is_file()),
        key=lambda path: path.as_posix().casefold(),
    )
    if not music_xml:
        raise ExportError(
            "no Music.xml files found below "
            f"{root} (expected music/musicNNNN/Music.xml)"
        )
    return music_xml


def required_positive_int(root: ET.Element, field: str, xml_path: Path) -> int:
    value = root.findtext(field)
    if value is None or not value.strip():
        raise ExportError(f"missing required field {field!r}: {xml_path}")

    normalized = value.strip()
    if not normalized.isdecimal():
        raise ExportError(
            f"field {field!r} must be a decimal integer, got {normalized!r}: "
            f"{xml_path}"
        )

    number = int(normalized, 10)
    if number <= 0:
        raise ExportError(
            f"field {field!r} must be positive, got {number}: {xml_path}"
        )
    return number


def load_song_bosses(game_data_root: Path) -> list[SongBoss]:
    by_sort_order: dict[int, SongBoss] = {}

    for xml_path in discover_music_xml(game_data_root):
        try:
            xml_root = ET.parse(xml_path).getroot()
        except ET.ParseError as exc:
            raise ExportError(f"invalid XML {xml_path}: {exc}") from exc

        music_id_number = required_positive_int(xml_root, "Name/id", xml_path)
        if music_id_number > 9999:
            raise ExportError(
                f"Name/id must fit the four-digit musicId field, got "
                f"{music_id_number}: {xml_path}"
            )
        sort_order = required_positive_int(xml_root, "SortOrder", xml_path)
        boss_card_id = required_positive_int(xml_root, "BossCard/id", xml_path)
        song = SongBoss(
            sort_order=sort_order,
            music_id=f"{music_id_number:04d}",
            boss_card_id=boss_card_id,
            xml_path=xml_path,
        )

        previous = by_sort_order.get(sort_order)
        if previous is not None:
            raise ExportError(
                f"duplicate SortOrder {sort_order}: {previous.xml_path} and "
                f"{xml_path}"
            )
        by_sort_order[sort_order] = song

    songs = [by_sort_order[key] for key in sorted(by_sort_order)]
    validate_known_mappings(songs)
    return songs


def validate_known_mappings(songs: list[SongBoss]) -> None:
    by_sort_order = {song.sort_order: song for song in songs}
    for sort_order, expected in KNOWN_MAPPINGS.items():
        song = by_sort_order.get(sort_order)
        if song is None:
            raise ExportError(f"known SortOrder {sort_order} is missing")
        actual = (song.music_id, song.boss_card_id)
        if actual != expected:
            raise ExportError(
                f"known mapping mismatch for SortOrder {sort_order}: "
                f"expected musicId={expected[0]} bossCardId={expected[1]}, "
                f"got musicId={actual[0]} bossCardId={actual[1]}"
            )


def icon_filename(boss_card_id: int) -> str:
    return f"UI_Card_Icon_{boss_card_id:06d}.png"


def read_png_size(path: Path) -> tuple[int, int]:
    try:
        with path.open("rb") as file:
            header = file.read(24)
    except OSError as exc:
        raise ExportError(f"cannot read PNG {path}: {exc}") from exc

    if len(header) != 24 or header[:8] != PNG_SIGNATURE:
        raise ExportError(f"not a valid PNG file: {path}")
    if header[8:12] != struct.pack(">I", 13) or header[12:16] != b"IHDR":
        raise ExportError(f"PNG does not start with a valid IHDR chunk: {path}")
    return struct.unpack(">II", header[16:24])


def validate_source_icons(
    icon_root: Path, songs: list[SongBoss]
) -> dict[int, Path]:
    root = icon_root.resolve()
    if not root.is_dir():
        raise ExportError(f"icon root is not a directory: {root}")

    icons: dict[int, Path] = {}
    for boss_card_id in sorted({song.boss_card_id for song in songs}):
        path = root / icon_filename(boss_card_id)
        if not path.is_file():
            raise ExportError(
                f"missing icon for BossCard {boss_card_id}: {path}"
            )
        size = read_png_size(path)
        if size != EXPECTED_ICON_SIZE:
            raise ExportError(
                f"icon must be 256x256, got {size[0]}x{size[1]}: {path}"
            )
        icons[boss_card_id] = path
    return icons


def render_manifest(songs: list[SongBoss]) -> str:
    manifest = {
        "version": 1,
        "songs": {
            str(song.sort_order): {
                "musicId": song.music_id,
                "bossCardId": song.boss_card_id,
            }
            for song in songs
        },
    }
    return json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as file:
            for chunk in iter(lambda: file.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise ExportError(f"cannot hash file {path}: {exc}") from exc
    return digest.hexdigest()


def verify_output(
    out: Path,
    songs: list[SongBoss],
    source_icons: dict[int, Path],
) -> int:
    output_root = out.resolve()
    manifest_path = output_root / MANIFEST_NAME
    asset_root = output_root / ASSET_VERSION

    if not manifest_path.is_file():
        raise ExportError(f"missing generated manifest: {manifest_path}")
    try:
        actual_manifest = manifest_path.read_text(encoding="utf-8")
        json.loads(actual_manifest)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ExportError(f"cannot read valid JSON manifest {manifest_path}: {exc}") from exc

    expected_manifest = render_manifest(songs)
    if actual_manifest != expected_manifest:
        raise ExportError(
            f"manifest is stale or not canonically serialized: {manifest_path}"
        )

    if not asset_root.is_dir():
        raise ExportError(f"missing generated asset directory: {asset_root}")

    expected_names = {
        icon_filename(boss_card_id) for boss_card_id in source_icons
    }
    actual_names = {
        path.name
        for path in asset_root.glob("UI_Card_Icon_*.png")
        if path.is_file()
    }
    if actual_names != expected_names:
        missing = sorted(expected_names - actual_names)
        extra = sorted(actual_names - expected_names)
        details: list[str] = []
        if missing:
            details.append(f"missing={', '.join(missing)}")
        if extra:
            details.append(f"extra={', '.join(extra)}")
        raise ExportError(
            f"generated icon set does not match manifest in {asset_root}: "
            + "; ".join(details)
        )

    total_bytes = 0
    for boss_card_id, source_path in source_icons.items():
        target_path = asset_root / icon_filename(boss_card_id)
        size = read_png_size(target_path)
        if size != EXPECTED_ICON_SIZE:
            raise ExportError(
                f"generated icon must be 256x256, got {size[0]}x{size[1]}: "
                f"{target_path}"
            )
        if sha256_file(source_path) != sha256_file(target_path):
            raise ExportError(
                f"generated icon is not byte-identical to source: {target_path}"
            )
        total_bytes += target_path.stat().st_size
    return total_bytes


def generate_output(
    out: Path,
    songs: list[SongBoss],
    source_icons: dict[int, Path],
) -> int:
    output_root = out.resolve()
    asset_root = output_root / ASSET_VERSION
    try:
        asset_root.mkdir(parents=True, exist_ok=True)

        expected_names = {
            icon_filename(boss_card_id) for boss_card_id in source_icons
        }
        for stale_path in asset_root.glob("UI_Card_Icon_*.png"):
            if stale_path.is_file() and stale_path.name not in expected_names:
                stale_path.unlink()

        for boss_card_id, source_path in source_icons.items():
            target_path = asset_root / icon_filename(boss_card_id)
            temporary_path = target_path.with_suffix(".png.tmp")
            shutil.copyfile(source_path, temporary_path)
            temporary_path.replace(target_path)

        manifest_path = output_root / MANIFEST_NAME
        temporary_manifest = manifest_path.with_suffix(".json.tmp")
        temporary_manifest.write_text(
            render_manifest(songs), encoding="utf-8", newline="\n"
        )
        temporary_manifest.replace(manifest_path)
    except OSError as exc:
        raise ExportError(f"cannot write generated output below {output_root}: {exc}") from exc

    return verify_output(output_root, songs, source_icons)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        songs = load_song_bosses(args.game_data_root)
        source_icons = validate_source_icons(args.icon_root, songs)
        if args.verify_only:
            total_bytes = verify_output(args.out, songs, source_icons)
            action = "verified"
        else:
            total_bytes = generate_output(args.out, songs, source_icons)
            action = "generated"
    except ExportError as exc:
        print(f"[ongeki-boss] error: {exc}", file=sys.stderr)
        return 2

    output_root = args.out.resolve()
    print(
        f"[ongeki-boss] {action}: songs={len(songs)} "
        f"icons={len(source_icons)} bytes={total_bytes}"
    )
    print(f"[ongeki-boss] map: {output_root / MANIFEST_NAME}")
    print(f"[ongeki-boss] assets: {output_root / ASSET_VERSION}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
