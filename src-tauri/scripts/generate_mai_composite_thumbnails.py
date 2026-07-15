import hashlib
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
COMPOSITE_CACHE_VERSION = 1


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


def valid_webp(path):
    try:
        with Image.open(path) as image:
            is_webp = image.format == "WEBP"
            image.verify()
            return is_webp
    except Exception:
        return False


def file_sha256(path, cache):
    key = str(path.resolve())
    if key in cache:
        return cache[key]
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    value = digest.hexdigest()
    cache[key] = value
    return value


def composite_fingerprint(base, chara, digest_cache):
    inputs = {
        "version": COMPOSITE_CACHE_VERSION,
        "composeSize": COMPOSE_SIZE,
        "thumbnailSize": THUMBNAIL_SIZE,
        "quality": THUMBNAIL_QUALITY,
        "base": {
            "name": base.name,
            "sha256": file_sha256(base, digest_cache),
        },
        "chara": (
            {
                "name": chara.name,
                "sha256": file_sha256(chara, digest_cache),
            }
            if chara is not None
            else None
        ),
    }
    payload = json.dumps(inputs, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def compose_job(job):
    """Process-pool worker. Returns (dataName, error_or_None)."""
    data_name = job["dataName"]
    output = Path(job["output"])
    temporary = output.with_name(f".{output.name}.{os.getpid()}.tmp")
    try:
        base = load_layer(job.get("base")) or load_layer(job.get("defaultBase"))
        if base is None:
            return (data_name, "missing base")
        canvas = fit_layer(base, COMPOSE_SIZE)
        chara_path = job.get("chara")
        chara = load_layer(chara_path)
        if chara_path and chara is None:
            return (data_name, "missing character layer")
        if chara is not None:
            canvas.alpha_composite(fit_layer(chara, COMPOSE_SIZE), (0, 0))
        canvas.thumbnail(THUMBNAIL_SIZE, Image.Resampling.BICUBIC)
        output.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(temporary, "WEBP", quality=THUMBNAIL_QUALITY, method=4)
        if not valid_webp(temporary):
            return (data_name, "generated thumbnail failed validation")
        os.replace(temporary, output)
        return (data_name, None)
    except Exception as exc:
        return (data_name, str(exc))
    finally:
        try:
            temporary.unlink()
        except OSError:
            pass


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


def update_cards(
    cards,
    assets_root,
    thumbs_root,
    public_base_url,
    default_base,
    cached_fingerprints,
):
    targets = []  # (card, output_name, output_path, fingerprint)
    jobs = []
    skipped = []
    digest_cache = {}
    for card in cards:
        if card.get("game") != "MAI" or card.get("recordType") != "Card":
            continue
        output_name = f"card_{card.get('dataName', card.get('id', 'mai'))}.webp"
        output = thumbs_root / output_name
        type_id = number(field(card, "typeId"))
        map_id = number(field(card, "mapId"))
        chara_id = number(field(card, "charaId"))
        if type_id is None or map_id is None:
            skipped.append({
                "dataName": card.get("dataName"),
                "reason": "missing typeId/mapId",
            })
            continue
        base = assets_root / f"ui_cardbase_{type_id:07}_{map_id:06}.png"
        chara = (
            assets_root / f"ui_cardchara_{chara_id:06}.png"
            if chara_id and chara_id > 0
            else None
        )
        selected_base = base if base.exists() else default_base
        if not selected_base.exists():
            skipped.append({
                "dataName": card.get("dataName"),
                "reason": "missing base",
            })
            continue
        if chara is not None and not chara.exists():
            skipped.append({
                "dataName": card.get("dataName"),
                "reason": "missing character layer",
            })
            continue
        try:
            fingerprint = composite_fingerprint(selected_base, chara, digest_cache)
        except OSError as exc:
            skipped.append({
                "dataName": card.get("dataName"),
                "reason": f"cannot fingerprint source layers: {exc}",
            })
            continue
        targets.append((card, output_name, output, fingerprint))
        reusable = (
            valid_webp(output)
            and cached_fingerprints.get(output_name) == fingerprint
        )
        if reusable:
            continue
        jobs.append({
            "dataName": card.get("dataName"),
            "base": str(base),
            "chara": str(chara) if chara else "",
            "defaultBase": str(default_base),
            "output": str(output),
        })

    generated = 0
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
    fingerprints = {}
    for card, output_name, output, fingerprint in targets:
        if valid_webp(output):
            card["thumbnailPath"] = f"{public_base_url}/assets/thumbs/mai/{output_name}"
            fingerprints[output_name] = fingerprint
            if str(output) not in job_outputs:
                reused += 1

    return generated, reused, skipped, fingerprints


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        with temporary.open("w", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except OSError:
            pass


def main():
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("private-assets/official/generated")
    public_base_url = sys.argv[2].rstrip("/") if len(sys.argv) > 2 else "/official/generated"
    assets_root = root / "assets" / "mai"
    thumbs_root = root / "assets" / "thumbs" / "mai"
    default_base = Path("public/official/MAI_cardbase_default.png").resolve()

    cards_path = root / "cards.json"
    mai_path = root / "cards.mai.json"
    cache_path = root / ".tools" / "mai-composite-cache.json"
    manifest = json.loads(cards_path.read_text(encoding="utf-8"))
    shard = json.loads(mai_path.read_text(encoding="utf-8"))
    try:
        cached_fingerprints = json.loads(cache_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        cached_fingerprints = {}
    if not isinstance(cached_fingerprints, dict):
        cached_fingerprints = {}

    generated, reused, skipped, fingerprints = update_cards(
        manifest["cards"],
        assets_root,
        thumbs_root,
        public_base_url,
        default_base,
        cached_fingerprints,
    )
    summary = {
        "generated": generated,
        "reused": reused,
        "skipped": len(skipped),
        "skippedSamples": skipped[:10],
    }
    if skipped:
        print(json.dumps(summary, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1

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
    write_json(cache_path, fingerprints)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
