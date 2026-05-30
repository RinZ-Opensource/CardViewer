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


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: extract_unity_image.py <asset-bundle> <output-png>", file=sys.stderr)
        return 2

    asset_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    try:
        import UnityPy
    except Exception as exc:
        print(f"UnityPy import failed: {exc}", file=sys.stderr)
        return 3

    try:
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
            print(f"no Sprite or Texture2D image found in {asset_path}", file=sys.stderr)
            return 4

        _area, _type_rank, _name, image = max(candidates, key=lambda item: (item[0], item[1]))
        output_path.parent.mkdir(parents=True, exist_ok=True)
        image.save(output_path, "PNG")
        print(output_path)
        return 0
    except Exception as exc:
        print(f"Unity image extraction failed: {exc}", file=sys.stderr)
        return 5


if __name__ == "__main__":
    raise SystemExit(main())
