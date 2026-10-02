"""Replay cached live Gemini readings through the trust layer, with no API calls.

For every test chart it finds the cached first reading (values) and second
reading (pixel positions) for that image, runs the trust layer on them, and
prints the error of each point against the answer key with what the app said
about it. A tilted photo is also straightened and replayed, if its straightened
copy was read live before.

    python tools/replay_cache.py                        # all charts, summary
    python tools/replay_cache.py --points               # every point
    python tools/replay_cache.py --only hs1_sparse_ticks --points
    python tools/replay_cache.py --baseline HEAD~3      # also run the trust layer of an older commit
    python tools/replay_cache.py --cache path/to/cache  # default: $DATA_DIR/cache

The answer keys are read here, after the trust layer has run; they never reach
the model (nothing is sent anywhere).

Only stable interfaces of the app are used (models, extract.normalize,
trust.assess, imaging, detect, straighten), so --app-root (and --baseline) can
point the same replay at another version of the code.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _args():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--cache", help="cache directory (default: $DATA_DIR/cache)")
    ap.add_argument("--only", nargs="*", help="chart names")
    ap.add_argument("--points", action="store_true", help="print every point")
    ap.add_argument("--json", help="write results to this file")
    ap.add_argument("--app-root", help="replay with the app code in this directory")
    ap.add_argument("--baseline", help="git revision whose trust layer to compare against")
    ap.add_argument("--quiet", action="store_true")
    return ap.parse_args()


A = _args()
APP_ROOT = Path(A.app_root).resolve() if A.app_root else ROOT
sys.path.insert(0, str(ROOT / "eval"))
sys.path.insert(0, str(APP_ROOT))

from PIL import Image  # noqa: E402
from scoring import CORRECT_PCT, REAL_ERROR_PCT, load_truth, point_errors, summarize  # noqa: E402

from app.imaging import crop, load_image, pixel_hash  # noqa: E402
from app.models import Chart, ChartReading, DetectionResult, GeometryReading  # noqa: E402
from app.pipeline import trust  # noqa: E402
from app.pipeline.extract import normalize  # noqa: E402


def index_cache(cache_dir: Path) -> dict:
    """(content_hash, task) -> newest cache entry."""
    idx: dict = {}
    for p in cache_dir.glob("*/*.json"):
        try:
            e = json.loads(p.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        k = (e.get("content_hash"), e.get("task"))
        if None in k:
            continue
        if k not in idx or e.get("created", 0) > idx[k].get("created", 0):
            idx[k] = e
    return idx


def chart_inputs(im: Image.Image, idx: dict) -> list[Image.Image]:
    """The image(s) the pipeline sent to the readings: the whole image, or the crops of an older run."""
    h = pixel_hash(im)
    if (h, "read") in idx:
        return [im]
    det = idx.get((h, "detect"))
    if det is None:
        return [im]
    from app.pipeline.detect import PAD, WHOLE_IMAGE_FRACTION, boxes_from_detection

    w, hh = im.size
    boxes = boxes_from_detection(DetectionResult.model_validate(det["response"]), w, hh)
    if len(boxes) == 1:
        b = boxes[0][0]
        if (b[2] - b[0]) * (b[3] - b[1]) >= WHOLE_IMAGE_FRACTION * w * hh:
            return [im]
    return [crop(im, b, PAD)[0] for b, _, _ in boxes] or [im]


def assess(im: Image.Image, idx: dict):
    h = pixel_hash(im)
    r, g = idx.get((h, "read")), idx.get((h, "geometry"))
    if r is None:
        return None
    reading = ChartReading.model_validate(r["response"])
    geometry = GeometryReading.model_validate(g["response"]) if g else None
    kind, xa, ya, series, notes = normalize(reading)
    chart = Chart(id="replay", document_id="replay", chart_type=kind, x_axis=xa, y_axis=ya, series=series,
                  has_markers=reading.has_point_markers, image_size=[im.width, im.height])
    a = trust.assess(chart, reading, geometry, im, notes, "" if geometry else "failed")
    meta = {"read_model": r.get("model", ""), "geometry_model": (g or {}).get("model", ""),
            "read_s": r.get("seconds"), "geometry_s": (g or {}).get("seconds")}
    return chart, a, meta


def replay_one(name: str, folder: str, truth: dict, idx: dict) -> dict:
    im = load_image((ROOT / "test_data" / folder / f"{name}.png").read_bytes())
    row: dict = {"name": name, "set": folder}
    best = None
    for inp in chart_inputs(im, idx):
        out = assess(inp, idx)
        if out is None:
            continue
        chart, a, meta = out
        rows, missing = point_errors(chart, truth)
        cand = (chart, a, meta, rows, missing)
        if best is None or len(rows) > len(best[3]):
            best = cand
    if best is None:
        row["status"] = "not cached"
        return row
    chart, a, meta, rows, missing = best
    row.update({"status": "ok" if meta["geometry_model"] else "no second reading", **meta,
                "level": chart.confidence.level, "uncertain": sum(1 for r in rows if r["flagged"]),
                "risks": [r.code for r in chart.confidence.risk_factors],
                "reasons": chart.confidence.reasons, "points": rows, **summarize(rows, missing)})
    if a.tilted:
        row["straightening"] = straighten_replay(im, chart, idx, truth)
    return row


def straighten_replay(im, chart, idx, truth) -> dict:
    from app.pipeline.straighten import straighten

    res = straighten(im)
    if res is None:
        return {"status": "edges not found"}
    out = assess(res[0], idx)
    if out is None:
        return {"status": "straightened copy not cached (needs a live run)"}
    c2, _, meta = out
    rows, missing = point_errors(c2, truth)
    rank = {"low": 0, "medium": 1, "high": 2}
    adopted = (rank[c2.confidence.level] > rank[chart.confidence.level]
               or c2.confidence.score > chart.confidence.score + 0.05)
    return {"status": "ok", "adopted": adopted, "level": c2.confidence.level, **meta, **summarize(rows, missing)}


def totals(rows: list[dict]) -> dict:
    ok = [r for r in rows if r.get("matched")]
    keys = ("matched", "real_errors", "caught", "missed", "correct", "false_alarms", "caught_marked", "false_marked")
    t = {k: sum(r[k] for r in ok) for k in keys}
    t["charts"] = len(ok)
    t["levels"] = {lvl: sum(1 for r in ok if r["level"] == lvl) for lvl in ("high", "medium", "low")}
    return t


def fmt(v, d=2):
    return "n/a" if v is None else f"{v:.{d}f}"


def main() -> int:
    if A.baseline:
        return compare_with_baseline()
    from app.config import load_settings

    cache = Path(A.cache) if A.cache else load_settings().cache_dir
    idx = index_cache(cache)
    if not idx:
        print(f"No cached readings in {cache}. Run the app or eval/run_eval.py in live mode first.")
        return 1
    rows = []
    for name, (folder, t) in sorted(load_truth().items(), key=lambda kv: (kv[1][0] != "clean", kv[0])):
        if A.only and name not in A.only:
            continue
        rows.append(replay_one(name, folder, t, idx))
    if not A.quiet:
        print(f"Replayed {sum(1 for r in rows if r.get('matched'))} charts from {cache} with app code in {APP_ROOT}.")
        print(f"Real error: more than {REAL_ERROR_PCT}% of the axis off. Correct: within {CORRECT_PCT}%. "
              "Flagged: marked uncertain.\n")
        print(f"{'chart':22} {'models (read / second)':40} {'avg':>6} {'worst':>6} {'level':6} "
              f"{'pts':>4} {'unc':>4} {'caught':>7} {'false':>6}")
        for r in rows:
            if not r.get("matched"):
                print(f"{r['name']:22} {r['status']}")
                continue
            models = f"{r['read_model']} / {r['geometry_model'] or '-'}"
            print(f"{r['name']:22} {models:40} {fmt(r['avg_err']):>6} {fmt(r['worst_err']):>6} {r['level']:6} "
                  f"{r['matched']:>4} {r['uncertain']:>4} {r['caught']:>3}/{r['real_errors']:<3} {r['false_alarms']:>6}")
            st = r.get("straightening")
            if st:
                if st.get("status") == "ok":
                    print(f"{'':22} straightened: avg {fmt(st['avg_err'])} worst {fmt(st['worst_err'])} "
                          f"level {st['level']} {'adopted' if st['adopted'] else 'not adopted'}")
                else:
                    print(f"{'':22} straightened: {st['status']}")
            if A.points:
                for p in r["points"]:
                    mark = "UNCERTAIN" if p["flagged"] else ""
                    print(f"{'':4}{p['series'][:14]:14} x={str(p['x']):>8} true={p['true']:<9} got={p['got']:<9} "
                          f"err={p['err']:5.2f}% {mark:9} {','.join(f for f in p['flags'] if f != 'uncertain')}")
        t = totals(rows)
        print(f"\nTotal over {t['charts']} charts, {t['matched']} points: real errors caught {t['caught']} of "
              f"{t['real_errors']}; false alarms {t['false_alarms']} of {t['correct']} correct points. "
              f"Levels: {t['levels']}.")
        print(f"Marked medium or uncertain in the verification view: real errors {t['caught_marked']} of "
              f"{t['real_errors']}, correct points {t['false_marked']} of {t['correct']}.")
    if A.json:
        Path(A.json).write_text(json.dumps({"app_root": str(APP_ROOT), "rows": rows, "totals": totals(rows)},
                                           indent=1, default=str))
    return 0


def compare_with_baseline() -> int:
    """Run this replay twice: with the trust layer at --baseline and with the current code."""
    tmp = Path(tempfile.mkdtemp())
    wt = tmp / "baseline"
    subprocess.run(["git", "-C", str(ROOT), "worktree", "add", "--detach", str(wt), A.baseline],
                   check=True, capture_output=True)
    try:
        base_args = [a for a in sys.argv[1:] if a not in ("--baseline", A.baseline)]
        results = {}
        for label, root in (("baseline " + A.baseline, wt), ("current", ROOT)):
            out = tmp / f"{label.split()[0]}.json"
            cmd = [sys.executable, str(Path(__file__).resolve()), *base_args, "--app-root", str(root),
                   "--json", str(out), "--quiet"]
            env = {**os.environ, "DATA_DIR": os.environ.get("DATA_DIR", str(ROOT / ".data"))}
            if not A.cache:
                from app.config import load_settings
                cmd += ["--cache", str(load_settings().cache_dir)]
            subprocess.run(cmd, check=True, env=env)
            results[label] = json.loads(out.read_text())
        print(f"{'':12} {'charts':>6} {'points':>6} {'caught':>10} {'false alarms':>14} {'marked: err':>12} "
              f"{'ok':>9}  levels")
        for label, res in results.items():
            t = res["totals"]
            print(f"{label[:12]:12} {t['charts']:>6} {t['matched']:>6} {t['caught']:>4} of {t['real_errors']:<3} "
                  f"{t['false_alarms']:>5} of {t['correct']:<5} {t.get('caught_marked', 0):>5} of {t['real_errors']:<3} "
                  f"{t.get('false_marked', 0):>5} of {t['correct']:<5}  {t['levels']}")
        a, b = (list(results.values())[i]["rows"] for i in (0, 1))
        print(f"\n{'chart':22} {'level before':>12} {'after':>8} {'unc before':>11} {'after':>6}")
        for r0, r1 in zip(a, b):
            if r0.get("matched"):
                print(f"{r0['name']:22} {r0['level']:>12} {r1['level']:>8} {r0['uncertain']:>11} {r1['uncertain']:>6}")
        if A.json:
            Path(A.json).write_text(json.dumps(results, indent=1, default=str))
    finally:
        subprocess.run(["git", "-C", str(ROOT), "worktree", "remove", "--force", str(wt)], capture_output=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
