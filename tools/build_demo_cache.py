"""Copy the saved live readings of the built-in samples into app/demo_cache.

The app reads app/demo_cache as a read-only cache (SEED_CACHE_DIRS), so in live mode the samples
open at once and never depend on Gemini being available. They are labeled as saved model output,
like any cached reading. Only readings made with the current prompts are copied (the cache's own
check). Uploads are not affected.

Run: python tools/build_demo_cache.py [--cache eval/live_cache] [--only lecture]

--only adds the named samples without rebuilding the rest. Straightening is not bit-identical
across platforms, so rebuild everything only where the straightened photo's readings are found
(the report says "straightened read" for phone-photo).
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


def replay_pdf(path: Path, seed: ResponseCache) -> list[dict]:
    """Run the PDF through the pipeline with no API access and copy every saved reading it used.

    A PDF's charts are found per page and cropped, so the hashes to look up are only known by
    running the pipeline. The client refuses every call; whatever the pipeline finds in the seed
    cache is what the app will find in app/demo_cache.
    """
    import tempfile
    from types import SimpleNamespace

    from google.genai import errors

    from app.config import load_settings
    from app.gemini import GeminiProvider
    from app.models import Document
    from app.pipeline.runner import Pipeline
    from app.storage import Storage

    def no_call(*a, **k):
        raise errors.ClientError(429, {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED",
                                                 "message": "build_demo_cache: no API calls (per day)"}})

    used = []
    get_seed = seed.get_seed

    def recording(content_hash, task):
        e = get_seed(content_hash, task)
        if e is not None and all(u is not e for u in used):
            used.append(e)
        return e

    seed.get_seed = recording
    provider = GeminiProvider(load_settings(), seed)
    provider.client = SimpleNamespace(models=SimpleNamespace(generate_content=no_call, get=lambda model: None))
    store = Storage(Path(tempfile.mkdtemp()), 60)
    doc = Document(id="demo-pdf", filename=path.name, kind="pdf", is_sample=True, mode="live")
    store.doc_dir(doc.id)
    try:
        Pipeline(store, provider, "live").process(doc, path.read_bytes())
    finally:
        seed.get_seed = get_seed
    for e in used:
        e = dict(e)
        stem = e.pop("_file")
        e["prompt_version"] = PROMPT_VERSION
        (OUT / f"{stem}.json").write_text(json.dumps(e))
    return used


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=str(ROOT / "eval/live_cache"))
    ap.add_argument("--only", nargs="+", metavar="SAMPLE",
                    help="add these samples to the existing app/demo_cache instead of rebuilding it")
    a = ap.parse_args()
    seed = ResponseCache(ROOT / ".data" / "unused", [Path(a.cache)])
    if not a.only:
        shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)
    report = []
    for name, (fname, _) in SAMPLES.items():
        if a.only and name not in a.only:
            continue
        path = ROOT / "web/samples" / fname
        if fname.endswith(".pdf"):
            got = [f"{e['task']} ({e.get('model', '')})" for e in replay_pdf(path, seed)]
            report.append((name, ", ".join(got) or "no saved live reading"))
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
