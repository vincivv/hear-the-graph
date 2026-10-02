"""Per-point error against the answer keys, shared by eval/run_eval.py and tools/replay_cache.py.

error: |extracted - true| as a percent of the axis range, where the axis range is
the true data span plus 5% on each side (matplotlib's default margins); log axes
are compared in log10 space.

A point is "flagged" when the app marks it uncertain (it is announced as uncertain
and drawn as a hollow diamond). Counts:

- caught: a real error (more than REAL_ERROR_PCT off) that was flagged
- missed: a real error that was not flagged
- false alarm: a correct point (within CORRECT_PCT) that was flagged
- marked: confidence below 0.85, so the verification view draws it as medium or
  uncertain even when it is not announced as uncertain (reported separately)

Only this file and the eval read the answer keys, after the pipeline has run.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REAL_ERROR_PCT = 3.0
CORRECT_PCT = 1.5


def load_truth() -> dict:
    t = {}
    for k, v in json.loads((ROOT / "test_data/clean/truth.json").read_text()).items():
        t[k] = ("clean", v)
    for k, v in json.loads((ROOT / "test_data/hard/truth_hard.json").read_text()).items():
        t[k] = ("hard", v)
    return t


def point_errors(chart, truth: dict) -> tuple[list[dict], int]:
    """([{series, x, true, got, err, flagged, flags}], number of true points with no extracted point)."""
    log = "log" in (truth.get("y_label", "").lower()) or chart.y_axis.scale == "log"
    true_series = truth["series"]
    ys = [y for s in true_series.values() for y in s["y"]]
    f = (lambda v: math.log10(v) if v > 0 else float("nan")) if log else (lambda v: v)
    lo, hi = min(f(y) for y in ys), max(f(y) for y in ys)
    span = (hi - lo) * 1.1 or 1.0
    categorical = truth["type"] == "bar"

    rows, missing = [], 0
    extracted = list(chart.series)
    used = set()
    for name, ts in true_series.items():
        es = next((s for s in extracted if s.name.strip().lower() == name.strip().lower() and id(s) not in used), None)
        if es is None:
            es = next((s for s in extracted if id(s) not in used), None)
        if es is None:
            missing += len(ts["x"])
            continue
        used.add(id(es))
        if categorical:
            by_label = {p.x_label.strip().lower(): p for p in es.points}
            pairs = [(x, y, by_label.get(str(x).strip().lower())) for x, y in zip(ts["x"], ts["y"])]
        else:
            xs = ts["x"]
            spacing = min(b - a for a, b in zip(xs, xs[1:])) if len(xs) > 1 else 1.0
            pairs = []
            for x, y in zip(xs, ts["y"]):
                p = min(es.points, key=lambda q: abs(q.x - x), default=None)
                pairs.append((x, y, p if p is not None and abs(p.x - x) <= spacing / 2 else None))
        for x, y, p in pairs:
            if p is None:
                missing += 1
                continue
            err = abs(f(p.y) - f(y)) / span * 100
            rows.append({"series": name, "x": x, "true": y, "got": p.y, "err": err, "conf": p.confidence,
                         "flagged": "uncertain" in p.flags, "marked": p.confidence < 0.85, "flags": list(p.flags)})
    return rows, missing


def summarize(rows: list[dict], missing: int) -> dict:
    errs = [r["err"] for r in rows]
    real = [r for r in rows if r["err"] > REAL_ERROR_PCT]
    correct = [r for r in rows if r["err"] <= CORRECT_PCT]
    return {
        "avg_err": sum(errs) / len(errs) if errs else None,
        "worst_err": max(errs) if errs else None,
        "matched": len(rows),
        "missing": missing,
        "real_errors": len(real),
        "caught": sum(1 for r in real if r["flagged"]),
        "missed": sum(1 for r in real if not r["flagged"]),
        "correct": len(correct),
        "false_alarms": sum(1 for r in correct if r["flagged"]),
        "caught_marked": sum(1 for r in real if r["marked"]),
        "false_marked": sum(1 for r in correct if r["marked"]),
        "flagged": sum(1 for r in rows if r["flagged"]),
    }
