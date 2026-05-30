import argparse
import os
import sys
from pathlib import Path


MAI_PREFIXES = ("ui_cardbase_", "ui_cardchara_", "ui_cardcharamask_")
MU3_PREFIXES = (
    "ui_card_",
    "ui_card_bg_",
    "ui_card_chara_",
    "ui_card_chara_mask_",
    "ui_card_holo_",
    "ui_card_holo_sign_",
    "ui_card_holo_signmask_",
    "ui_card_grade_",
    "ui_rights_",
)


def sprite_full_rect_image(sprite):
    from PIL import Image

    image = sprite.image.convert("RGBA")
    rect = getattr(sprite, "m_Rect", None)
    render_data = getattr(sprite, "m_RD", None)
    offset = getattr(render_data, "textureRectOffset", None)
    if rect is None or offset is None:
        return image

    full_width = max(1, round(rect.width))
    full_height = max(1, round(rect.height))
    if image.size == (full_width, full_height):
        return image

    left = max(0, round(offset.x))
    bottom = max(0, round(offset.y))
    top = max(0, full_height - bottom - image.height)
    canvas = Image.new("RGBA", (full_width, full_height), (0, 0, 0, 0))
    canvas.alpha_composite(image, (left, top))
    return canvas


def is_content_root(path: Path) -> bool:
    return any((path / name).exists() for name in ("MAI", "MU3", "CHU", "assets_mai", "assets_mu3"))


def discover_content_roots(package_root: Path) -> list[Path]:
    streaming = package_root / "CardMaker_Data" / "StreamingAssets"
    roots: list[Path] = []
    seen: set[str] = set()

    def push(path: Path) -> None:
        try:
            key = str(path.resolve())
        except OSError:
            key = str(path)
        if key not in seen:
            seen.add(key)
            roots.append(path)

    if streaming.exists():
        push(streaming)

    extra_raw = os.environ.get("CARDVIEWER_EXTRA_CONTENT_ROOTS")
    candidates = []
    if extra_raw:
        candidates.extend(Path(part) for part in extra_raw.split(os.pathsep) if part)
    else:
        candidates.append(Path(r"G:\SDED\downloads"))
    candidates.append(package_root / "downloads")

    for candidate in candidates:
        if is_content_root(candidate):
            push(candidate)
            continue
        if not candidate.exists():
            continue
        for child in sorted(candidate.iterdir()):
            if child.is_dir() and is_content_root(child):
                push(child)

    return roots


def asset_dirs(content_root: Path, game: str, asset_dir: str) -> list[Path]:
    return [content_root / asset_dir, content_root / game / asset_dir]


def image_from_asset(UnityPy, asset_path: Path):
    env = UnityPy.load(str(asset_path))
    candidates = []
    for obj in env.objects:
        if obj.type.name not in ("Sprite", "Texture2D"):
            continue
        try:
            data = obj.read()
            image = sprite_full_rect_image(data) if obj.type.name == "Sprite" else data.image.convert("RGBA")
            area = image.size[0] * image.size[1]
            type_rank = 1 if obj.type.name == "Sprite" else 0
            candidates.append((area, type_rank, getattr(data, "m_Name", ""), image))
        except Exception:
            continue
    if not candidates:
        raise RuntimeError("no Sprite or Texture2D image found")
    return max(candidates, key=lambda item: (item[0], item[1]))[3]


def export_dir(UnityPy, source_dir: Path, output_dir: Path, prefixes: tuple[str, ...], force: bool, progress_every: int):
    files = sorted(path for path in source_dir.iterdir() if path.is_file() and path.name.startswith(prefixes))
    output_dir.mkdir(parents=True, exist_ok=True)
    exported = reused = skipped = failed = 0

    print(f"directory {source_dir} -> {output_dir} ({len(files)} files)", flush=True)
    for index, path in enumerate(files, start=1):
        output_path = output_dir / f"{path.name}.png"
        if output_path.exists() and not force:
            reused += 1
        else:
            try:
                image = image_from_asset(UnityPy, path)
                image.save(output_path, "PNG")
                exported += 1
            except Exception as exc:
                failed += 1
                print(f"failed {path}: {exc}", flush=True)

        if index == 1 or index == len(files) or index % progress_every == 0:
            print(
                f"progress {source_dir.name} {index}/{len(files)} "
                f"exported={exported} reused={reused} failed={failed}",
                flush=True,
            )

    return exported, reused, skipped, failed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("package_root")
    parser.add_argument("output_root")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--progress-every", type=int, default=25)
    args = parser.parse_args()

    try:
        import UnityPy
    except Exception as exc:
        print(f"UnityPy import failed: {exc}", file=sys.stderr)
        return 3

    package_root = Path(args.package_root)
    output_root = Path(args.output_root)
    content_roots = discover_content_roots(package_root)
    print(f"content_roots={len(content_roots)}", flush=True)

    totals = [0, 0, 0, 0]
    for content_root in reversed(content_roots):
        for directory in asset_dirs(content_root, "MAI", "assets_mai"):
            if directory.exists():
                result = export_dir(
                    UnityPy,
                    directory,
                    output_root / "assets" / "mai",
                    MAI_PREFIXES,
                    args.force,
                    max(1, args.progress_every),
                )
                totals = [a + b for a, b in zip(totals, result)]
        for directory in asset_dirs(content_root, "MU3", "assets_mu3"):
            if directory.exists():
                result = export_dir(
                    UnityPy,
                    directory,
                    output_root / "assets" / "mu3",
                    MU3_PREFIXES,
                    args.force,
                    max(1, args.progress_every),
                )
                totals = [a + b for a, b in zip(totals, result)]

    print(
        f"done exported={totals[0]} reused={totals[1]} skipped={totals[2]} failed={totals[3]}",
        flush=True,
    )
    return 0 if totals[3] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
