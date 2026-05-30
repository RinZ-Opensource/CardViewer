import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from PIL import Image, ImageOps


def generate_thumbnail(job):
    source = Path(job["source"])
    output = Path(job["output"])
    max_width = int(job.get("maxWidth") or job.get("max_width") or 192)
    max_height = int(job.get("maxHeight") or job.get("max_height") or 256)
    quality = int(job.get("quality") or 72)

    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image)
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGBA")
        image.thumbnail((max_width, max_height), Image.Resampling.BICUBIC)
        output.parent.mkdir(parents=True, exist_ok=True)
        image.save(output, "WEBP", quality=quality, method=4)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: generate_thumbnails.py <jobs-json>", file=sys.stderr)
        return 2

    jobs_path = Path(sys.argv[1])
    jobs = json.loads(jobs_path.read_text(encoding="utf-8"))
    workers = int(os.environ.get("CARDVIEWER_THUMBNAIL_WORKERS") or "0")
    if workers <= 0:
        # Conservative default so a many-core machine doesn't spawn a huge
        # number of image workers at once; override via the env var above.
        workers = min(max(os.cpu_count() or 1, 1), 4)

    failed = []
    completed = 0
    total = len(jobs)
    print(f"thumbnail workers={workers}, jobs={total}", file=sys.stderr, flush=True)

    with ProcessPoolExecutor(max_workers=workers) as executor:
        future_jobs = {executor.submit(generate_thumbnail, job): job for job in jobs}
        for future in as_completed(future_jobs):
            job = future_jobs[future]
            try:
                future.result()
            except Exception as exc:
                failed.append(f"{job.get('source', '<unknown>')}: {exc}")
            completed += 1
            if completed == total or completed % 25 == 0:
                print(f"thumbnail progress {completed}/{total}", file=sys.stderr, flush=True)

    for failure in failed:
        print(failure, file=sys.stderr)
    print(json.dumps({"jobs": len(jobs), "failed": len(failed)}), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
