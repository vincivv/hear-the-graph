"""Build app/fixtures/fixtures.json for fixture mode.

Fixture mode lets the app run without a Gemini key. For each test chart it
serves two "readings" in exactly the shape Gemini returns, so the rest of the
pipeline (cross-check, pixel check, confidence, summary, sound) runs unchanged.

Where the data comes from, so nobody mistakes it for model output:
- values: the answer keys (test_data/*/truth*.json)
- titles, axis labels, tick labels, marker and color facts: transcribed by a
  person from the images, in ANNOTATIONS below
- pixel positions: measured by this script, by aligning the answer-key values
  to the drawn ink in each image (affine fit for lines, bar-end detection for bars)

Run: python tools/build_fixtures.py [--overlays DIR]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.imaging import fingerprint  # noqa: E402
from app.pipeline.ink import color_mask, generic_ink_mask  # noqa: E402

# name -> transcribed facts. Tick labels are listed exactly as printed.
ANNOTATIONS = {
    "01_line_rising": dict(title="Plant Height Over Time", markers=True, colors=["#1f77b4"],
                           xt=["0", "2", "4", "6", "8", "10"], yt=[str(v) for v in range(5, 41, 5)]),
    "02_line_peak": dict(title="Reaction Rate vs Temperature Step", markers=True, colors=["#d62728"],
                         xt=[str(v) for v in range(0, 13, 2)], yt=[str(v) for v in range(5, 46, 5)]),
    "03_line_decay": dict(title="Radioactive Sample Remaining", markers=True, colors=["#1f77b4"],
                          xt=["2", "4", "6", "8", "10"], yt=["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8"]),
    "04_line_negative": dict(title="Spring Displacement", markers=True, colors=["#2ca02c"],
                             xt=["0", "5", "10", "15", "20", "25"], yt=["−15", "−10", "−5", "0", "5", "10", "15"]),
    "05_line_two_series": dict(title="Graduation Rate by Program", markers=True, colors=["#1f77b4", "#ff7f0e"],
                               xt=[str(v) for v in range(2016, 2027, 2)],
                               yt=["50.0", "52.5", "55.0", "57.5", "60.0", "62.5", "65.0", "67.5", "70.0"]),
    "06_line_dense": dict(title="Daily Website Visitors", markers=False, colors=["#1f77b4"],
                          xt=[str(v) for v in range(0, 31, 5)], yt=[str(v) for v in range(1000, 5001, 500)]),
    "07_bar_simple": dict(title="Students Enrolled by Major", markers=True, colors=["#1f77b4"],
                          yt=[str(v) for v in range(0, 501, 100)]),
    "08_bar_decimal": dict(title="Rainfall This Week", markers=True, colors=["#ff7f0e"],
                           yt=["0", "2", "4", "6", "8"]),
    "09_bar_negative": dict(title="Net Change per Quarter", markers=True, colors=[""],
                            yt=["−10", "−5", "0", "5", "10", "15"]),
    "10_bar_offset_axis": dict(title="Average High Temperature", markers=True, colors=["#9467bd"],
                               yt=[str(v) for v in range(60, 101, 5)]),
    "hs1_sparse_ticks": dict(title="Signal Strength", markers=False, colors=["#000000"],
                             xt=["0", "10", "20"], yt=["0", "25", "50"]),
    "hs2_grouped_bars": dict(title="New Applications by Term", markers=True, colors=["#4472c4", "#ed7d31"],
                             yt=["0", "500", "1,000", "1,500", "2,000", "2,500"]),
    "hs3_log_scale": dict(title="Bacterial Colony Growth", markers=True, colors=["#1f77b4"], log_y=True,
                          xt=[str(v) for v in range(0, 9)], yt=["10¹", "10²", "10³"]),
    "hs4_hand_drawn": dict(title="Cost per Unit", markers=True, colors=["#1f77b4"],
                           xt=["0", "2", "4", "6", "8", "10"], yt=["40", "42", "44", "46", "48", "50"]),
    "hs5_three_similar": dict(title="Temperature Readings", markers=False, colors=["#184878", "#2870b0", "#5898d0"],
                              xt=[str(v) for v in range(0, 15, 2)],
                              yt=["15.0", "17.5", "20.0", "22.5", "25.0", "27.5", "30.0", "32.5", "35.0"]),
}

UNITS = {"Height (cm)": "cm", "Rate (mol/s)": "mol/s", "Displacement (mm)": "mm", "Time (s)": "s",
         "Rate (%)": "%", "Rainfall (mm)": "mm", "Change (%)": "%", "Temperature (°F)": "°F",
         "Distance (m)": "m", "Strength (dB)": "dB", "Cost ($)": "$", "Temp (°C)": "°C"}


def tick_value(label: str) -> float:
    s = label.replace("−", "-").replace(",", "")
    sup = {"¹": 1, "²": 2, "³": 3, "⁴": 4}
    if s.startswith("10") and len(s) == 3 and s[2] in sup:
        return 10.0 ** sup[s[2]]
    return float(s)


def load_truth() -> dict:
    clean = json.loads((ROOT / "test_data/clean/truth.json").read_text())
    hard = json.loads((ROOT / "test_data/hard/truth_hard.json").read_text())
    out = {}
    for k, v in clean.items():
        out[k] = ("clean", v)
    for k, v in hard.items():
        out[k] = ("hard", v)
    return out


# ---------------------------------------------------------------------------
# Geometry fitting
# ---------------------------------------------------------------------------


def blurred(mask: np.ndarray, sigma: float) -> np.ndarray:
    f = mask.astype(np.float32)
    k = int(sigma * 4) | 1
    return cv2.GaussianBlur(f, (k, k), sigma)


def sample_polyline(uv: np.ndarray, per_seg: int = 8) -> np.ndarray:
    pts = [uv[0]]
    for a, b in zip(uv[:-1], uv[1:]):
        for t in np.linspace(0, 1, per_seg + 1)[1:]:
            pts.append(a + (b - a) * t)
    return np.array(pts)


def apply(M: np.ndarray, uv: np.ndarray) -> np.ndarray:
    return uv @ M[:, :2].T + M[:, 2]


def score(M, field, samples):
    p = apply(M, samples)
    h, w = field.shape
    x = np.clip(p[:, 0], 0, w - 1).astype(int)
    y = np.clip(p[:, 1], 0, h - 1).astype(int)
    return float(field[y, x].mean())


def series_mask(rgb: np.ndarray, color: str, all_colors: list[str]) -> np.ndarray:
    """Ink for one series. Dark series lose straight axis lines; same-hue series use RGB distance."""
    if not color:
        return generic_ink_mask(rgb)
    from app.pipeline.ink import hex_to_rgb

    target = np.array(hex_to_rgb(color), float)
    others = [np.array(hex_to_rgb(c), float) for c in all_colors if c and c != color]
    if any(np.abs(o - target).sum() < 200 for o in others):
        d = np.linalg.norm(rgb.astype(float) - target, axis=2)
        m = d < 45
    else:
        m = color_mask(rgb, color)
    if target.max() < 80:  # black or near-black series: remove axis spines and long gridlines
        u8 = m.astype(np.uint8)
        hl = cv2.morphologyEx(u8, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (max(15, rgb.shape[1] // 12), 1)))
        vl = cv2.morphologyEx(u8, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(15, rgb.shape[0] // 12))))
        m = m & ~(cv2.dilate(hl | vl, np.ones((3, 3), np.uint8)) > 0)
    return m


def fit_lines(rgb: np.ndarray, series_uv: list[np.ndarray], colors: list[str]) -> np.ndarray:
    """Affine map from normalized data (u, v) to pixels maximizing ink overlap."""
    h, w = rgb.shape[:2]
    masks = [series_mask(rgb, c, colors) for c in colors]
    union = np.zeros((h, w), bool)
    for m in masks:
        union |= m
    samples = [sample_polyline(uv) for uv in series_uv]

    def bbox_init(keep):
        ys, xs = np.nonzero(keep)
        lo_x, hi_x = np.percentile(xs, [0.2, 99.8])
        lo_y, hi_y = np.percentile(ys, [0.2, 99.8])
        return np.array([[hi_x - lo_x, 0, lo_x], [0, -(hi_y - lo_y), hi_y]], dtype=float)

    # Two starting guesses: the biggest connected curves (legends and labels are
    # small pieces), and all ink away from the image border (faint broken lines).
    n, lab, stats, _ = cv2.connectedComponentsWithStats(union.astype(np.uint8), connectivity=8)
    areas = stats[1:, cv2.CC_STAT_AREA]
    inits = [bbox_init(np.isin(lab, np.flatnonzero(areas >= 0.08 * areas.max()) + 1))]
    band = np.zeros_like(union)
    band[int(h * 0.08): int(h * 0.97), int(w * 0.06): int(w * 0.98)] = True
    inits.append(bbox_init(union & band))

    best_M, best_score = None, -1.0
    for M in inits:
        for sigma in (6.0, 3.0, 1.5):
            fields = [blurred(m, sigma) for m in masks]

            def total(M):
                return sum(score(M, f, s) for f, s in zip(fields, samples))

            best = total(M)
            step = np.array([[0.01 * w, 0.01 * w, 0.01 * w], [0.01 * h, 0.01 * h, 0.01 * h]])
            for _ in range(60):
                improved = False
                for i in range(2):
                    for j in range(3):
                        for sgn in (1, -1):
                            M2 = M.copy()
                            M2[i, j] += sgn * step[i, j]
                            s_ = total(M2)
                            if s_ > best + 1e-6:
                                best, M, improved = s_, M2, True
                if not improved:
                    step *= 0.5
                    if step.max() < 0.2:
                        break
        if best > best_score:
            best_M, best_score = M, best
    M = best_M
    return M


def bar_runs(mask: np.ndarray, min_height: int = 4) -> list[tuple[int, int]]:
    h, w = mask.shape
    colcount = mask.sum(axis=0)
    on = colcount > max(min_height, 0.01 * h)
    runs, start = [], None
    for x in range(w):
        if on[x] and start is None:
            start = x
        elif not on[x] and start is not None:
            if x - start >= 4:
                runs.append((start, x - 1))
            start = None
    if start is not None and w - start >= 4:
        runs.append((start, w - 1))
    return runs


def fit_bars(rgb, series_vals: list[list[float]], colors: list[str]):
    """Return per-series list of (px, py_end) and the y mapping (a, b): py = a*y + b."""
    h, w = rgb.shape[:2]
    out, obs = [], []
    for vals, c in zip(series_vals, colors):
        m = color_mask(rgb, c) if c else (generic_ink_mask(rgb) & (cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)[..., 1] > 70))
        # drop thin legend swatches / text: keep runs of plausible width, take the n widest-tall ones
        runs = bar_runs(m)
        runs = [r for r in runs if (r[1] - r[0]) > 0.012 * w]
        if len(runs) > len(vals):
            # keep the n runs with most ink (bars beat legend patches)
            runs = sorted(sorted(runs, key=lambda r: -m[:, r[0]:r[1] + 1].sum())[: len(vals)])
        if len(runs) != len(vals):
            raise RuntimeError(f"found {len(runs)} bars for {len(vals)} values")
        pts = []
        for (a, b), v in zip(runs, vals):
            cx = (a + b) / 2
            lo, hi = int(a + (b - a) * 0.3), int(b - (b - a) * 0.3) + 1
            rows = np.flatnonzero(m[:, lo:hi].mean(axis=1) > 0.5)
            top, bot = rows.min(), rows.max()
            pts.append([cx, float(top), float(bot)])
            obs.append((v, top, bot))
        out.append(pts)
    # Fit py = a*v + b. For each bar, the end farther from the baseline is the value end.
    # Iterate: guess baseline from positive bars' bottoms.
    vs = np.array([o[0] for o in obs])
    ends = np.array([o[1] if o[0] >= 0 else o[2] for o in obs], dtype=float)
    A = np.vstack([vs, np.ones_like(vs)]).T
    a, b = np.linalg.lstsq(A, ends, rcond=None)[0]
    result = []
    k = 0
    for pts, vals in zip(out, series_vals):
        sp = []
        for p, v in zip(pts, vals):
            sp.append((p[0], a * v + b))
            k += 1
        result.append(sp)
    return result, (a, b)


# ---------------------------------------------------------------------------


def build_one(name: str, path: Path, truth: dict, base: str) -> dict:
    ann = ANNOTATIONS[base]
    rgb = np.array(Image.open(path).convert("RGB"))
    h, w = rgb.shape[:2]
    is_bar = truth["type"] == "bar"
    log_y = ann.get("log_y", False)
    names = list(truth["series"].keys())
    colors = ann["colors"] if len(ann["colors"]) == len(names) else ann["colors"] * len(names)

    def fy(v):
        return np.log10(v) if log_y else v

    if is_bar:
        cats = [str(c) for c in truth["series"][names[0]]["x"]]
        vals = [truth["series"][n]["y"] for n in names]
        pix, (a, b) = fit_bars(rgb, vals, colors)
        ytv = [tick_value(t) for t in ann["yt"]]
        all_px = [p[0] for s in pix for p in s]
        gap = (max(all_px) - min(all_px)) / max(1, len(cats) - 1) * 0.6 if len(cats) > 1 else w * 0.1
        x0, x1 = min(all_px) - gap, max(all_px) + gap
        ylo = min(min(ytv), 0, min(min(v) for v in vals))
        yhi = max(max(ytv), max(max(v) for v in vals))
        if base == "10_bar_offset_axis":
            ylo = 60.0
        yr = yhi - ylo
        ylo_v = ylo if base == "10_bar_offset_axis" or ylo == 0 else ylo - 0.05 * yr
        if ylo == 0:
            ylo_v = 0.0
        yhi_v = yhi + 0.05 * yr
        plot = [a * yhi_v + b, x0, a * ylo_v + b, x1]  # [ymin, xmin, ymax, xmax] px
        geo_series = [
            {"name": n, "points": [{"x_label": cats[i], "position": [p[1], p[0]]} for i, p in enumerate(s)]}
            for n, s in zip(names, pix)
        ]
        x_ticks = [{"label": c, "position": [plot[2], pix[0][i][0] if len(names) == 1 else float(np.mean([s[i][0] for s in pix]))]}
                   for i, c in enumerate(cats)]
        y_ticks = [{"label": t, "position": [a * tick_value(t) + b, x0]} for t in ann["yt"]]
        reading_series = [
            {"name": n, "color_hex": colors[k], "points": [{"x_label": cats[i], "x_value": float(i), "y": float(v)} for i, v in enumerate(truth["series"][n]["y"])]}
            for k, n in enumerate(names)
        ]
        x_axis = {"label": truth["x_label"], "unit": UNITS.get(truth["x_label"], ""), "scale": "category",
                  "min": -0.5, "max": len(cats) - 0.5, "tick_labels": cats}
        y_axis = {"label": truth["y_label"], "unit": UNITS.get(truth["y_label"], ""), "scale": "linear",
                  "min": round(ylo_v, 4), "max": round(yhi_v, 4), "tick_labels": ann["yt"]}
        M = None
    else:
        xs_all = [x for n in names for x in truth["series"][n]["x"]]
        ys_all = [fy(y) for n in names for y in truth["series"][n]["y"]]
        xmin, xmax = min(xs_all), max(xs_all)
        ymin, ymax = min(ys_all), max(ys_all)
        uv = []
        for n in names:
            xs = np.array(truth["series"][n]["x"], float)
            ys = np.array([fy(y) for y in truth["series"][n]["y"]], float)
            uv.append(np.stack([(xs - xmin) / (xmax - xmin), (ys - ymin) / (ymax - ymin)], axis=1))
        M = fit_lines(rgb, uv, colors)

        def to_px(x, yv):
            u = (x - xmin) / (xmax - xmin)
            v = (yv - ymin) / (ymax - ymin)
            return apply(M, np.array([[u, v]]))[0]

        xtv = [tick_value(t) for t in ann["xt"]]
        ytv = [fy(tick_value(t)) for t in ann["yt"]]
        lo_x, hi_x = min(xmin, min(xtv)), max(xmax, max(xtv))
        lo_y, hi_y = min(ymin, min(ytv)), max(ymax, max(ytv))
        mx, my = 0.05 * (hi_x - lo_x), 0.05 * (hi_y - lo_y)
        ax0, ax1 = lo_x - mx, hi_x + mx
        ay0, ay1 = lo_y - my, hi_y + my
        if base == "hs1_sparse_ticks":
            ay0 = 0.0
        c00 = to_px(ax0, ay0)
        c11 = to_px(ax1, ay1)
        plot = [min(c00[1], c11[1]), min(c00[0], c11[0]), max(c00[1], c11[1]), max(c00[0], c11[0])]
        geo_series = []
        for n in names:
            pts = []
            for x, y in zip(truth["series"][n]["x"], truth["series"][n]["y"]):
                p = to_px(x, fy(y))
                pts.append({"x_label": f"{x:g}", "position": [p[1], p[0]]})
            geo_series.append({"name": n, "points": pts})
        x_ticks = []
        for t in ann["xt"]:
            p = to_px(tick_value(t), ay0)
            x_ticks.append({"label": t, "position": [p[1], p[0]]})
        y_ticks = []
        for t in ann["yt"]:
            p = to_px(ax0, fy(tick_value(t)))
            y_ticks.append({"label": t, "position": [p[1], p[0]]})
        reading_series = [
            {"name": n, "color_hex": colors[k],
             "points": [{"x_label": f"{x:g}", "x_value": float(x), "y": float(y)} for x, y in zip(truth["series"][n]["x"], truth["series"][n]["y"])]}
            for k, n in enumerate(names)
        ]
        x_axis = {"label": truth["x_label"], "unit": UNITS.get(truth["x_label"], ""), "scale": "linear",
                  "min": round(ax0, 4), "max": round(ax1, 4), "tick_labels": ann["xt"]}
        y_axis = {"label": truth["y_label"], "unit": UNITS.get(truth["y_label"], ""), "scale": "log" if log_y else "linear",
                  "min": round(10 ** ay0 if log_y else ay0, 4), "max": round(10 ** ay1 if log_y else ay1, 4), "tick_labels": ann["yt"]}

    def norm_pos(p):  # [y, x] px -> normalized 0-1000
        return [round(p[0] / h * 1000, 2), round(p[1] / w * 1000, 2)]

    geometry = {
        "plot_area": [round(plot[0] / h * 1000, 2), round(plot[1] / w * 1000, 2), round(plot[2] / h * 1000, 2), round(plot[3] / w * 1000, 2)],
        "x_ticks": [{"label": t["label"], "position": norm_pos(t["position"])} for t in x_ticks],
        "y_ticks": [{"label": t["label"], "position": norm_pos(t["position"])} for t in y_ticks],
        "series": [{"name": s["name"], "points": [{"x_label": p["x_label"], "position": norm_pos(p["position"])} for p in s["points"]]} for s in geo_series],
    }
    reading = {
        "is_chart": True,
        "chart_type": truth["type"],
        "title": ann["title"],
        "x_axis": x_axis,
        "y_axis": y_axis,
        "has_point_markers": ann["markers"],
        "series": reading_series,
    }
    data = path.read_bytes()
    return {
        "name": name,
        "file": str(path.relative_to(ROOT)),
        "sha256": hashlib.sha256(data).hexdigest(),
        "pixel_sha256": hashlib.sha256(np.ascontiguousarray(rgb).tobytes()).hexdigest(),
        "size": [w, h],
        "fingerprint": fingerprint(Image.fromarray(rgb)).round(4).tolist(),
        "reading": reading,
        "geometry": geometry,
    }


def draw_overlay(entry: dict, out_dir: Path):
    img = cv2.cvtColor(np.array(Image.open(ROOT / entry["file"]).convert("RGB")), cv2.COLOR_RGB2BGR)
    h, w = img.shape[:2]
    g = entry["geometry"]
    y0, x0, y1, x1 = g["plot_area"]
    cv2.rectangle(img, (int(x0 * w / 1000), int(y0 * h / 1000)), (int(x1 * w / 1000), int(y1 * h / 1000)), (0, 200, 0), 1)
    for s in g["series"]:
        for p in s["points"]:
            cv2.circle(img, (int(p["position"][1] * w / 1000), int(p["position"][0] * h / 1000)), 5, (255, 0, 255), 2)
    for t in g["x_ticks"] + g["y_ticks"]:
        cv2.drawMarker(img, (int(t["position"][1] * w / 1000), int(t["position"][0] * h / 1000)), (0, 0, 255), cv2.MARKER_CROSS, 10, 1)
    cv2.imwrite(str(out_dir / f"{entry['name']}.png"), img)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--overlays", type=Path, default=None)
    args = ap.parse_args()
    truth = load_truth()
    entries = []
    for name, (folder, t) in sorted(truth.items()):
        base = t.get("based_on", name)
        path = ROOT / "test_data" / folder / f"{name}.png"
        try:
            e = build_one(name, path, t, base)
        except Exception as ex:  # report and continue
            print(f"FAILED {name}: {ex}")
            continue
        entries.append(e)
        print(f"ok {name}")
        if args.overlays:
            args.overlays.mkdir(parents=True, exist_ok=True)
            draw_overlay(e, args.overlays)
    out = ROOT / "app" / "fixtures" / "fixtures.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "note": "Fixture data for the test charts. Values come from the answer keys; pixel positions were "
                "measured by tools/build_fixtures.py. This is not model output.",
        "charts": entries,
    }, indent=1))
    print(f"wrote {len(entries)} fixtures to {out}")


if __name__ == "__main__":
    main()
