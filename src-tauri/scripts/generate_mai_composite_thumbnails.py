import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from PIL import Image


# Composite at ~half resolution instead of the full 768x1052 card and then
# downscale to the thumbnail. Same aspect ratio (and layer alignment), but a
# quarter of the pixels to resize/composite.
COMPOSE_SIZE = (384, 526)
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
    except (TypeError, ValueError):
        return None


def load_layer(path):
    if not path:
        return None
    p = Path(path)
    if not p.exists():
        return None
    return Image.open(p).convert("RGBA")


def fit_layer(image, size):
    if image.size == size:
        return image.copy()
    return image.resize(size, Image.Resampling.BICUBIC)


def compose_job(job):
    """Process-pool worker. Returns (dataName, error_or_None)."""
    data_name = job["dataName"]
    try:
        base = load_layer(job.get("base")) or load_layer(job.get("defaultBase"))
        if base is None:
            return (data_name, "missing base")
        canvas = fit_layer(base, COMPOSE_SIZE)
        chara = load_layer(job.get("chara"))
        if chara is not None:
            canvas.alpha_composite(fit_layer(chara, COMPOSE_SIZE), (0, 0))
        canvas.thumbnail(THUMBNAIL_SIZE, Image.Resampling.BICUBIC)
        output = Path(job["output"])
        output.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(output, "WEBP", quality=THUMBNAIL_QUALITY, method=4)
        return (data_name, None)
    except Exception as exc:
        return (data_name, str(exc))


def worker_count() -> int:
    workers = int(
        os.environ.get("CARDVIEWER_COMPOSITE_WORKERS")
        or os.environ.get("CARDVIEWER_THUMBNAIL_WORKERS")
        or "0"
    )
    if workers <= 0:
        # Conservative default: each worker loads full-size base + chara images.
        workers = min(max(os.cpu_count() or 1, 1), 4)
    return workers


def update_cards(cards, assets_root, thumbs_root, public_base_url, default_base):
    targets = []  # (card, output_name, output_path)
    jobs = []
    for card in cards:
        if card.get("game") != "MAI" or card.get("recordType") != "Card":
            continue
        output_name = f"card_{card.get('dataName', card.get('id', 'mai'))}.webp"
        output = thumbs_root / output_name
        targets.append((card, output_name, output))
        if output.exists():
            continue
        type_id = number(field(card, "typeId"))
        map_id = number(field(card, "mapId"))
        chara_id = number(field(card, "charaId"))
        if type_id is None or map_id is None:
            continue
        base = assets_root / f"ui_cardbase_{type_id:07}_{map_id:06}.png"
        chara = (
            assets_root / f"ui_cardchara_{chara_id:06}.png"
            if chara_id and chara_id > 0
            else None
        )
        jobs.append({
            "dataName": card.get("dataName"),
            "base": str(base),
            "chara": str(chara) if chara else "",
            "defaultBase": str(default_base),
            "output": str(output),
        })

    generated = 0
    skipped = []
    if jobs:
        workers = worker_count()
        print(f"composite workers={workers}, jobs={len(jobs)}", file=sys.stderr, flush=True)
        with ProcessPoolExecutor(max_workers=workers) as executor:
            for data_name, reason in executor.map(compose_job, jobs):
                if reason:
                    skipped.append({"dataName": data_name, "reason": reason})
                else:
                    generated += 1

    reused = 0
    job_outputs = {job["output"] for job in jobs}
    for card, output_name, output in targets:
        if output.exists():
            card["thumbnailPath"] = f"{public_base_url}/assets/thumbs/mai/{output_name}"
            if str(output) not in job_outputs:
                reused += 1

    return generated, reused, skipped


def write_json(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def main():
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("private-assets/official/generated")
    public_base_url = sys.argv[2].rstrip("/") if len(sys.argv) > 2 else "/official/generated"
    assets_root = root / "assets" / "mai"
    thumbs_root = root / "assets" / "thumbs" / "mai"
    default_base = Path("public/official/MAI_cardbase_default.png").resolve()

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
