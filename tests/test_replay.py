"""tools/replay_cache.py on a simulated cache (fixture readings with injected errors, in the
live cache format). The tool must find the readings by image hash, score every point against
the answer key and count real errors caught and false alarms."""

import copy
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

from app.imaging import load_image, pixel_hash

ROOT = Path(__file__).resolve().parent.parent
FIX = {e["name"]: e for e in json.loads((ROOT / "app/fixtures/fixtures.json").read_text())["charts"]}


def write_entry(d: Path, task: str, h: str, response: dict, model="sim-model"):
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{task}-{h[:16]}.json").write_text(json.dumps(
        {"response": response, "model": model, "created": 1.0, "task": task, "content_hash": h, "seconds": 1.5}))


def test_replay_counts_caught_errors_and_false_alarms(tmp_path):
    cache = tmp_path / "cache" / "samples"
    for name, bump in (("02_line_peak", {5: 4.0, 6: 4.0, 7: 4.0}), ("07_bar_simple", {})):
        e = FIX[name]
        im = load_image((ROOT / e["file"]).read_bytes())
        h = pixel_hash(im)
        r = copy.deepcopy(e["reading"])
        for i, d in bump.items():
            r["series"][0]["points"][i]["y"] += d  # three real errors of about 10% of the axis
        write_entry(cache, "read", h, r)
        write_entry(cache, "geometry", h, e["geometry"])
    out = subprocess.run([sys.executable, "tools/replay_cache.py", "--cache", str(tmp_path / "cache"),
                          "--only", "02_line_peak", "07_bar_simple", "hs1_sparse_ticks", "--json", str(tmp_path / "r.json")],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout
    res = json.loads((tmp_path / "r.json").read_text())
    rows = {r["name"]: r for r in res["rows"]}
    assert rows["hs1_sparse_ticks"]["status"] == "not cached"
    peak = rows["02_line_peak"]
    assert peak["real_errors"] == 3 and peak["caught"] == 3 and peak["false_alarms"] == 0
    assert rows["07_bar_simple"]["level"] == "high" and rows["07_bar_simple"]["false_alarms"] == 0
    assert res["totals"]["caught"] == 3 and "real errors caught 3 of 3" in out
