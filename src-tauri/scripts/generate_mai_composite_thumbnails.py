import json
import sys
from pathlib import Path

from PIL import Image


DEFAULT_SIZE = (768, 1052)
THUMBNAIL_SIZE = (192, 256)
THUMBNAIL_QUALITY = 72


def field(card, key):
    for item in card.get("printFields", []):
        if item.get("key") == key:
            return str(item.get("value", "")).strip()
    return ""


def number(value):
    try:
        return int(value)
    except ValueError:
        return None


def load_layer(path):
    if not path.exists():
        return None
    return Image.open(path).convert("RGBA")


def fit_layer(image):
    if image.size == DEFAULT_SIZE:
        return image.copy()
    return image.resize(DEFAULT_SIZE, Image.Resampling.LANCZOS)


def compose_thumbnail(card, assets_root, default_base):
    type_id = number(field(card, "typeId"))
    map_id = number(field(card, "mapId"))
    chara_id = number(field(card, "charaId"))
    if type_id is None or map_id is None:
        return None, "missing typeId/mapId"

    base_path = assets_root / f"ui_cardbase_{type_id:07}_{map_id:06}.png"
    chara_path = assets_root / f"ui_cardchara_{chara_id:06}.png" if chara_id and chara_id > 0 else None
    base = load_layer(base_path) or load_layer(default_base)
    if base is None:
        return None, f"missing base {base_path.name}"

    canvas = fit_layer(base)
    if chara_path:
        chara = load_layer(chara_path)
        if chara is not None:
            canvas.alpha_composite(fit_layer(chara), (0, 0))

    canvas.thumbnail(THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
    return canvas, None


def update_cards(cards, assets_root, thumbs_root, public_base_url, default_base):
    generated = 0
    reused = 0
    skipped = []
    for card in cards:
        if card.get("game") != "MAI" or card.get("recordType") != "Card":
            continue

        output = thumbs_root / f"card_{card.get('dataName', card.get('id', 'mai'))}.webp"
        if output.exists():
            reused += 1
        else:
            image, reason = compose_thumbnail(card, assets_root, default_base)
            if image is None:
                skipped.append({"dataName": card.get("dataName"), "reason": reason})
                continue
            output.parent.mkdir(parents=True, exist_ok=True)
            image.save(output, "WEBP", quality=THUMBNAIL_QUALITY, method=6)
            generated += 1

        card["thumbnailPath"] = f"{public_base_url}/assets/thumbs/mai/{output.name}"

    return generated, reused, skipped


def write_json(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("private-assets/official/generated")
    public_base_url = sys.argv[2].rstrip("/") if len(sys.argv) > 2 else "/official/generated"
    assets_root = root / "assets" / "mai"
    thumbs_root = root / "assets" / "thumbs" / "mai"
    default_base = Path("public/official/MAI_cardbase_default.png")

    cards_path = root / "cards.json"
    mai_path = root / "cards.mai.json"
    manifest = json.loads(cards_path.read_text(encoding="utf-8"))
    shard = json.loads(mai_path.read_text(encoding="utf-8"))

    generated, reused, skipped = update_cards(
        manifest["cards"],
        assets_root,
        thumbs_root,
        public_base_url,
        default_base,
    )
    by_data_name = {
        card["dataName"]: card.get("thumbnailPath")
        for card in manifest["cards"]
        if card.get("game") == "MAI"
    }
    for card in shard.get("cards", []):
        thumb = by_data_name.get(card.get("dataName"))
        if thumb:
            card["thumbnailPath"] = thumb

    write_json(cards_path, manifest)
    write_json(mai_path, shard)
    print(json.dumps({
        "generated": generated,
        "reused": reused,
        "skipped": len(skipped),
        "skippedSamples": skipped[:10],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
