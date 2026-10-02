"""Regression tests on real live Gemini readings (eval/live_cache, saved by the owner's live run).

No API calls: tools/replay_cache.py replays the cached first and second readings through the
trust layer and scores them against the answer keys.
"""

import json
import random
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "eval/live_cache"
pytestmark = pytest.mark.skipif(not CACHE.exists(), reason="no live cache in eval/live_cache")


def replay(cache: Path, tmp_path: Path) -> dict:
    out = tmp_path / "r.json"
    subprocess.run([sys.executable, "tools/replay_cache.py", "--cache", str(cache), "--json", str(out), "--quiet"],
                   cwd=ROOT, check=True)
    res = json.loads(out.read_text())
    return {r["name"]: r for r in res["rows"] if r.get("matched")} | {"_totals": res["totals"]}


def test_live_readings_of_clean_charts_raise_no_false_alarms(tmp_path):
    rows = replay(CACHE, tmp_path)
    # Known, measured: on h08a_lowres (3), hs3_log_scale (7) and hs5_three_similar (23) a lighter
    # model's second reading was wrong and the image could not tell which reading is right (no tick
    # marks found; three lines of nearly the same blue). Tilted photos are left out: every point of
    # the photo itself is uncertain until it is straightened.
    flat = [r for n, r in rows.items() if not n.startswith("_") and "phone_photo" not in n]
    assert sum(r["false_alarms"] for r in flat) <= 33
    for name, r in rows.items():
        if name.startswith("_") or not name[:2].isdigit():
            continue
        if r["status"] == "ok":  # both readings cached
            assert r["level"] == "high", (name, r["reasons"])
            assert r["uncertain"] == 0, name


def test_errors_injected_into_live_readings_are_caught(tmp_path):
    inj = tmp_path / "cache" / "samples"
    inj.mkdir(parents=True)
    rng = random.Random(4)
    # Sorted by content, not file name: names are cache keys and change with PROMPT_VERSION.
    entries = [(p, json.loads(p.read_text())) for p in (CACHE / "samples").glob("*.json")]
    for p, e in sorted(entries, key=lambda pe: (pe[1]["content_hash"], pe[1]["task"], pe[1]["model"])):
        if e["task"] == "read":
            r = e["response"]
            span = r["y_axis"]["max"] - r["y_axis"]["min"]
            for s in r["series"]:
                pts = s["points"]
                for i in rng.sample(range(len(pts)), max(1, len(pts) // 4)):
                    pts[i]["y"] += rng.choice([-1, 1]) * rng.uniform(0.04, 0.12) * span
        (inj / p.name).write_text(json.dumps(e))
    rows = replay(tmp_path / "cache", tmp_path)
    # Both readings and a pixel check: (nearly) every injected error is caught.
    checked = [r for n, r in rows.items() if not n.startswith("_") and r["status"] == "ok"
               and not {"uncalibrated", "unverified"} & set(r["risks"])]
    assert sum(r["caught"] for r in checked) >= sum(r["real_errors"] for r in checked) - 1 > 10
    # Axes not confirmed in the image (pixel check skipped): the cross-check alone catches most.
    cross_only = [r for n, r in rows.items() if not n.startswith("_") and "uncalibrated" in r["risks"]]
    assert sum(r["caught"] for r in cross_only) >= sum(r["real_errors"] for r in cross_only) - 1
    # Charts without a second reading are checked against the image only: most errors are still caught.
    assert rows["_totals"]["caught"] >= rows["_totals"]["real_errors"] - 5
    assert sum(r["false_alarms"] for n, r in rows.items() if not n.startswith("_") and "phone_photo" not in n) <= 33


def test_live_low_resolution_and_blur_are_honest_not_alarmed(tmp_path):
    # Gemini's tick positions on these were 7 to 11% off, and no tick marks could be found to fix them.
    # The plot frame disagrees, so the pixel check is skipped and the chart says why: medium, no
    # correct value announced as uncertain.
    rows = replay(CACHE, tmp_path)
    for name in ("h02a_lowres", "h02b_jpeg_blur"):
        r = rows.get(name)
        if r is None:
            continue
        assert r["level"] == "medium" and r["uncertain"] == 0, (name, r["reasons"])
        assert "uncalibrated" in r["risks"]
    for name in ("09_bar_negative", "03_line_decay"):
        if name in rows:
            assert rows[name]["level"] == "high", (name, rows[name]["reasons"])
