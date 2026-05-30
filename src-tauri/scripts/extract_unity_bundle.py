import json
import re
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


def safe_name(value, fallback):
    raw = str(value or fallback).strip() or str(fallback)
    cleaned = re.sub(r"[^0-9A-Za-z._-]+", "_", raw).strip("._-")
    return cleaned or str(fallback)


def vector_dict(value, fields):
    if value is None:
        return None
    result = {}
    for field in fields:
        if hasattr(value, field):
            result[field] = getattr(value, field)
    return result or None


def sprite_metadata(data):
    render_data = getattr(data, "m_RD", None)
    return {
        "rect": vector_dict(getattr(data, "m_Rect", None), ("x", "y", "width", "height")),
        "pivot": vector_dict(getattr(data, "m_Pivot", None), ("x", "y")),
        "border": vector_dict(getattr(data, "m_Border", None), ("x", "y", "z", "w")),
        "textureRectOffset": vector_dict(
            getattr(render_data, "textureRectOffset", None),
            ("x", "y"),
        ),
    }


def object_image(obj):
    data = obj.read()
    if obj.type.name == "Sprite":
        image = sprite_full_rect_image(data)
        extra = sprite_metadata(data)
    else:
        image = data.image.convert("RGBA")
        extra = {}
    name = getattr(data, "m_Name", "") or f"{obj.type.name}_{obj.path_id}"
    return data, name, image, extra


def main():
    if len(sys.argv) != 5:
        print(
            "usage: extract_unity_bundle.py <asset-bundle> <output-dir> <primary-output-png> <primary-archive-path>",
            file=sys.stderr,
        )
        return 2

    asset_path = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    primary_output = Path(sys.argv[3])
    primary_archive_path = sys.argv[4].replace("\\", "/")
    objects_dir = output_dir / "objects"
    metadata_path = output_dir / "metadata.json"

    try:
        import UnityPy
    except Exception as exc:
        print(f"UnityPy import failed: {exc}", file=sys.stderr)
        return 3

    try:
        env = UnityPy.load(str(asset_path))
        objects = []
        used_names = set()

        for obj in env.objects:
            if obj.type.name not in ("Sprite", "Texture2D"):
                continue
            try:
                _data, name, image, extra = object_image(obj)
            except Exception as exc:
                objects.append(
                    {
                        "name": "",
                        "type": obj.type.name,
                        "pathId": str(getattr(obj, "path_id", "")),
                        "error": str(exc),
                    }
                )
                continue

            base_name = safe_name(name, f"{obj.type.name}_{obj.path_id}")
            file_name = f"{base_name}.png"
            if file_name in used_names:
                file_name = f"{base_name}_{obj.path_id}.png"
            used_names.add(file_name)

            objects_dir.mkdir(parents=True, exist_ok=True)
            image_path = objects_dir / file_name
            image.save(image_path, "PNG")

            record = {
                "name": name,
                "type": obj.type.name,
                "pathId": str(getattr(obj, "path_id", "")),
                "width": image.size[0],
                "height": image.size[1],
                "area": image.size[0] * image.size[1],
                "file": f"objects/{file_name}",
            }
            record.update({k: v for k, v in extra.items() if v is not None})
            objects.append(record)

        exported = [item for item in objects if "file" in item]
        if not exported:
            print(f"no Sprite or Texture2D image found in {asset_path}", file=sys.stderr)
            return 4

        def primary_key(item):
            type_rank = 1 if item.get("type") == "Sprite" else 0
            return item.get("area", 0), type_rank, item.get("name", "")

        primary = max(exported, key=primary_key)
        primary_source = output_dir / primary["file"]
        primary_output.parent.mkdir(parents=True, exist_ok=True)
        primary_output.write_bytes(primary_source.read_bytes())

        metadata = {
            "source": str(asset_path),
            "primaryFile": primary_archive_path,
            "primaryName": primary.get("name", ""),
            "primaryPathId": primary.get("pathId", ""),
            "objectCount": len(exported),
            "objects": objects,
        }
        output_dir.mkdir(parents=True, exist_ok=True)
        metadata_path.write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(metadata_path)
        return 0
    except Exception as exc:
        print(f"Unity bundle extraction failed: {exc}", file=sys.stderr)
        return 5


if __name__ == "__main__":
    raise SystemExit(main())
