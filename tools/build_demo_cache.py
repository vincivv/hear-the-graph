"""Copy the saved live readings of the built-in samples into app/demo_cache.

The app reads app/demo_cache as a read-only cache (SEED_CACHE_DIRS), so in live mode the samples
open at once and never depend on Gemini being available. They are labeled as saved model output,
like any cached reading. Only readings made with the current prompts are copied (the cache's own
check). Uploads are not affected.

Run: python tools/build_demo_cache.py [--cache eval/live_cache]
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.config import PROMPT_VERSION, SAMPLES  # noqa: E402
from app.gemini import ResponseCache  # noqa: E402
from app.imaging import load_image, pixel_hash  # noqa: E402
from app.pipeline.straighten import straighten  # noqa: E402

OUT = ROOT / "app" / "demo_cache"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=str(ROOT / "eval/live_cache"))
    a = ap.parse_args()
    seed = ResponseCache(ROOT / ".data" / "unused", [Path(a.cache)])
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True)
    report = []
    for name, (fname, _) in SAMPLES.items():
        path = ROOT / "web/samples" / fname
        if fname.endswith(".pdf"):
            report.append((name, "PDF: not included (its charts have not been read live yet)"))
            continue
        im = load_image(path.read_bytes())
        images = [("image", im)]
        st = straighten(im)
        if st is not None:
            images.append(("straightened", st[0]))
        got = []
        for label, img in images:
            h = pixel_hash(img)
            for task in ("read", "geometry"):
                e = seed.get_seed(h, task)
                if e is None:
                    continue
                stem = e.pop("_file")  # the original name is the cache key, which proved the prompt version
                e["prompt_version"] = PROMPT_VERSION
                (OUT / f"{stem}.json").write_text(json.dumps(e))
                got.append(f"{label} {task} ({e.get('model', '')})")
        report.append((name, ", ".join(got) or "no saved live reading"))
    for name, what in report:
        print(f"{name:14} {what}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
