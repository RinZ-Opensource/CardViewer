import json
import sys
from pathlib import Path


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


def extract_image(UnityPy, asset_path: Path, output_path: Path) -> None:
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
        raise RuntimeError(f"no Sprite or Texture2D image found in {asset_path}")

    _area, _type_rank, _name, image = max(candidates, key=lambda item: (item[0], item[1]))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    # compress_level=1: PNG encode is hot here and these are intermediate files,
    # so trade a little size for much faster encoding.
    image.save(output_path, "PNG", compress_level=1)


def main() -> int:
    args = sys.argv[1:]

    # Import UnityPy once in this process (UnityPy is not reliable under a
    # spawned process pool, so parallelism is driven by running several of
    # these processes from the caller instead).
    try:
        import UnityPy
    except Exception as exc:
        print(f"UnityPy import failed: {exc}", file=sys.stderr)
        return 3

    # Batch mode: extract every job in this process, serially.
    if len(args) == 2 and args[0] == "--jobs":
        try:
            jobs = json.loads(Path(args[1]).read_text(encoding="utf-8"))
        except Exception as exc:
            print(f"failed to read jobs file: {exc}", file=sys.stderr)
            return 2
        failures = 0
        for job in jobs:
            source = job.get("source")
            output = job.get("output")
            if not source or not output:
                failures += 1
                continue
            try:
                extract_image(UnityPy, Path(source), Path(output))
            except Exception as exc:
                failures += 1
                print(f"extract failed for {source}: {exc}", file=sys.stderr)
        return 0

    # Single-file mode (live app cache and the mobile pack export).
    if len(args) == 2:
        try:
            extract_image(UnityPy, Path(args[0]), Path(args[1]))
            print(args[1])
            return 0
        except Exception as exc:
            print(f"Unity image extraction failed: {exc}", file=sys.stderr)
            return 5

    print(
        "usage: extract_unity_image.py <asset-bundle> <output-png> | --jobs <jobs.json>",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
