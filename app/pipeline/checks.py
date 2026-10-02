"""The three per-point checks of the trust layer.

- Sanity: values inside the axis range, plausible structure.
- Cross-check: the second reading (pixel positions, converted to values in
  code from the tick calibration) against the first reading (values read
  directly).
- Pixel check: map each value onto the image and look for the drawn line or
  bar there.

Each check writes its findings into point.checks and point.flags. The
confidence module turns those into numbers and words.
"""

from __future__ import annotations

import math

import cv2
import numpy as np
from PIL import Image

from ..models import Chart
from .ink import bar_end_in_column, color_mask, generic_ink_mask, nearest_ink_in_column, plot_mask
from .mapping import Calibration, norm_to_px

# Agreement thresholds, as a percent of the axis range.
AGREE_PCT = 1.5
DISAGREE_PCT = 4.0
X_DISAGREE_PCT = 3.0
PIXEL_OK_PCT = 2.0
PIXEL_BAD_PCT = 5.0
RANGE_TOLERANCE_PCT = 2.0
END_REACH = 0.015  # fraction of the plot width searched inward for the end of a line


def y_span(chart: Chart) -> tuple[float, bool]:
    ya = chart.y_axis
    if ya.scale == "log" and ya.min > 0 and ya.max > 0:
        return math.log10(ya.max) - math.log10(ya.min), True
    return (ya.max - ya.min) or 1.0, False


def y_diff_pct(chart: Chart, a: float, b: float) -> float:
    span, log = y_span(chart)
    if log:
        if a <= 0 or b <= 0:
            return 100.0
        return abs(math.log10(a) - math.log10(b)) / span * 100
    return abs(a - b) / span * 100


# ---------------------------------------------------------------------------
# Sanity
# ---------------------------------------------------------------------------


def sanity(chart: Chart, notes: list[str], visible: tuple[float, float] | None = None) -> dict:
    """visible: the y range the plot area covers according to the calibration. A reading sometimes
    gives the range of the tick labels as the axis range; a value between the last tick and the plot
    edge is then inside the axis, not outside it."""
    ya = chart.y_axis
    span, log = y_span(chart)
    out_of_range = []
    lo_v, hi_v = ya.min, ya.max
    if visible is not None and all(math.isfinite(v) for v in visible):
        margin = 0.15 * ((ya.max - ya.min) or 1.0)  # never stretch the axis by more than this
        lo_v = min(lo_v, max(min(visible), ya.min - margin))
        hi_v = max(hi_v, min(max(visible), ya.max + margin))
    for s in chart.series:
        for p in s.points:
            if log and p.y <= 0:
                p.flags.append("invalid")
                out_of_range.append((s, p, 100.0))
                continue
            lo, hi = (math.log10(ya.min), math.log10(ya.max)) if log else (lo_v, hi_v)
            v = math.log10(p.y) if log else p.y
            beyond = max(lo - v, v - hi, 0.0) / span * 100
            p.checks["beyond_axis_pct"] = round(beyond, 2)
            if beyond > RANGE_TOLERANCE_PCT:
                p.flags.append("out_of_range")
                out_of_range.append((s, p, beyond))
    counts = [len(s.points) for s in chart.series]
    mismatch = chart.chart_type == "bar" and len(set(counts)) > 1
    return {"out_of_range": len(out_of_range), "notes": notes, "bar_count_mismatch": mismatch,
            "out_of_range_points": [(s.name, p.x_label, p.y) for s, p, _ in out_of_range]}


# ---------------------------------------------------------------------------
# Cross-check
# ---------------------------------------------------------------------------


def match_series(chart_series, geo_series) -> dict[int, int]:
    """Pair value-reading series with geometry series by name, then by order."""
    pairs: dict[int, int] = {}
    used: set[int] = set()
    for i, s in enumerate(chart_series):
        for j, g in enumerate(geo_series):
            if j not in used and g.name.strip().lower() == s.name.strip().lower():
                pairs[i] = j
                used.add(j)
                break
    for i in range(len(chart_series)):
        if i not in pairs:
            for j in range(len(geo_series)):
                if j not in used:
                    pairs[i] = j
                    used.add(j)
                    break
    return pairs


def crosscheck(chart: Chart, geometry, cal: Calibration, w: int, h: int) -> dict:
    """Convert the geometry reading's point pixels to values and compare."""
    pairs = match_series(chart.series, geometry.series)
    xs_all = [p.x for s in chart.series for p in s.points]
    x_span = (max(xs_all) - min(xs_all)) or 1.0
    stats = {"compared": 0, "agree": 0, "minor": 0, "disagree": 0, "x_disagree": 0, "missing": 0,
             "max_dy_pct": 0.0, "count_mismatch": []}
    for i, s in enumerate(chart.series):
        g = geometry.series[pairs[i]] if i in pairs else None
        if g is None or not g.points or cal.y is None:
            for p in s.points:
                p.flags.append("no_crosscheck")
            stats["missing"] += len(s.points)
            continue
        if len(g.points) != len(s.points):
            stats["count_mismatch"].append((s.name, len(s.points), len(g.points)))
        # Values from pixels, in code.
        b_pts = []
        for k, gp in enumerate(g.points):
            px, py = norm_to_px(gp.position, w, h)
            yb = cal.y.to_value(py)
            if chart.x_axis.scale == "category":
                xb = None
                for c_i, c in enumerate(chart.x_axis.categories):
                    if gp.x_label.strip().lower() == c.strip().lower():
                        xb = float(c_i)
                        break
                if xb is None and len(g.points) == len(s.points):
                    xb = s.points[k].x
            else:
                xb = cal.x.to_value(px) if cal.x else None
            b_pts.append((xb, yb, px, py))
        if chart.x_axis.scale != "category" and len(s.points) > 1:
            spacing = min(b.x - a.x for a, b in zip(s.points, s.points[1:])) or x_span
        else:
            spacing = 1.0
        used = set()
        for p in s.points:
            best, best_d = None, None
            for j, (xb, yb, px, py) in enumerate(b_pts):
                if j in used or xb is None:
                    continue
                d = abs(xb - p.x)
                if best_d is None or d < best_d:
                    best, best_d = j, d
            if best is None or best_d > 0.5 * spacing + 1e-9:
                p.flags.append("no_crosscheck")
                stats["missing"] += 1
                continue
            used.add(best)
            xb, yb, px, py = b_pts[best]
            dy = y_diff_pct(chart, p.y, yb)
            dx = abs(xb - p.x) / x_span * 100 if chart.x_axis.scale != "category" else 0.0
            p.checks["second_reading_y"] = round(yb, 6)
            p.checks["crosscheck_dy_pct"] = round(dy, 2)
            p.checks["crosscheck_dx_pct"] = round(dx, 2)
            stats["compared"] += 1
            stats["max_dy_pct"] = max(stats["max_dy_pct"], dy)
            if dy <= AGREE_PCT:
                stats["agree"] += 1
            elif dy <= DISAGREE_PCT:
                stats["minor"] += 1
                p.flags.append("crosscheck_minor")
            else:
                stats["disagree"] += 1
                p.flags.append("crosscheck_disagree")
            if dx > X_DISAGREE_PCT:
                stats["x_disagree"] += 1
                p.flags.append("crosscheck_x")
    stats["max_dy_pct"] = round(stats["max_dy_pct"], 2)
    return stats


# ---------------------------------------------------------------------------
# Pixel check
# ---------------------------------------------------------------------------


def place_points(chart: Chart, geometry, cal: Calibration, w: int, h: int) -> None:
    """Pixel position of each first-reading value, for the overlay and the pixel check."""
    pairs = match_series(chart.series, geometry.series) if geometry is not None else {}
    for i, s in enumerate(chart.series):
        g = geometry.series[pairs[i]] if geometry is not None and i in pairs else None
        n = len(s.points)
        for k, p in enumerate(s.points):
            px = None
            if chart.x_axis.scale == "category":
                if g is not None and len(g.points) == n:
                    px = norm_to_px(g.points[k].position, w, h)[0]
                elif g is not None:
                    for gp in g.points:
                        if gp.x_label.strip().lower() == p.x_label.strip().lower():
                            px = norm_to_px(gp.position, w, h)[0]
                            break
                if px is None and cal.plot_area:
                    x0, _, x1, _ = cal.plot_area
                    px = x0 + (p.x + 0.5) / max(1, len(chart.x_axis.categories)) * (x1 - x0)
            elif cal.x:
                px = cal.x.to_pixel(p.x)
            py = cal.y.to_pixel(p.y) if cal.y else None
            if px is not None and py is not None and math.isfinite(px) and math.isfinite(py):
                p.pixel = [round(px, 1), round(py, 1)]


def _hue(color_hex: str) -> int | None:
    from .ink import hex_to_rgb

    rgb = hex_to_rgb(color_hex)
    if rgb is None:
        return None
    h, sat, _ = cv2.cvtColor(np.uint8([[list(rgb)]]), cv2.COLOR_RGB2HSV)[0, 0]
    return int(h) if sat >= 60 else None  # gray or black series: no hue to compare


def _near_other_line(chart: Chart, s, p, hues: dict, span: float) -> bool:
    """Does a series of nearly the same color pass within PIXEL_BAD_PCT of this value at this x?"""
    for o in chart.series:
        if o is s or hues.get(o.name) is None or hues.get(s.name) is None:
            continue
        d = abs(hues[o.name] - hues[s.name])
        if min(d, 180 - d) > 12 or not o.points:
            continue
        q = min(o.points, key=lambda q: abs(q.x - p.x))
        if y_diff_pct(chart, p.y, q.y) <= PIXEL_BAD_PCT:
            return True
    return False


def pixel_check(chart: Chart, image: Image.Image, cal: Calibration, tolerance_scale: float = 1.0) -> dict:
    """tolerance_scale widens the thresholds for blurry images: a blurred thin line
    loses its sharp tips, so the check can only be as precise as the image."""
    ok_pct, bad_pct = PIXEL_OK_PCT * tolerance_scale, PIXEL_BAD_PCT * tolerance_scale
    rgb = np.asarray(image.convert("RGB"))
    h, w = rgb.shape[:2]
    area = cal.plot_area
    inside = plot_mask((h, w), area, pad=4)
    plot_h = max(1.0, (area[3] - area[1]) if area else h)
    stats = {"checked": 0, "on_ink": 0, "near": 0, "off": 0, "not_checked": 0, "max_off_pct": 0.0,
             "tolerance_pct": [ok_pct, bad_pct]}
    span, log = y_span(chart)
    any_ink = generic_ink_mask(rgb) & inside
    hues = {s.name: _hue(s.color) for s in chart.series}
    for s in chart.series:
        ambiguous = chart.chart_type != "bar" and hues[s.name] is not None and any(
            o.name != s.name and hues[o.name] is not None and min(abs(hues[s.name] - hues[o.name]), 180 - abs(hues[s.name] - hues[o.name])) <= 12
            for o in chart.series)
        m = color_mask(rgb, s.color) if s.color else generic_ink_mask(rgb)
        m = m & inside
        if m.sum() < 30:  # color reading was off: fall back to any ink
            m = generic_ink_mask(rgb) & inside
        for p in s.points:
            if not p.pixel or cal.y is None:
                stats["not_checked"] += 1
                continue
            px, py = p.pixel
            if not (0 <= px < w and -h <= py < 2 * h):
                p.flags.append("off_image")
                stats["off"] += 1
                stats["checked"] += 1
                continue
            if chart.chart_type == "bar":
                base_val = 0.0 if (chart.y_axis.min <= 0 <= chart.y_axis.max) else chart.y_axis.min
                if log:
                    base_val = chart.y_axis.min
                base_py = cal.y.to_pixel(base_val) if cal.y.to_pixel(base_val) is not None else area[3]
                base_py = float(np.clip(base_py, area[1], area[3])) if area else base_py
                end = bar_end_in_column(m, px, base_py, positive=p.y >= base_val, half_width=2)
                if end is None:
                    # Bars are often colored by sign or by category, so the series color may not be
                    # this bar's color: measure whatever colored bar stands in this column.
                    end = bar_end_in_column(any_ink, px, base_py, positive=p.y >= base_val, half_width=2)
                if end is None:
                    dist_pct = None
                else:
                    measured = cal.y.to_value(end)
                    p.checks["pixel_y"] = round(measured, 6)
                    dist_pct = y_diff_pct(chart, p.y, measured)
            else:
                hw = int(round(2 * tolerance_scale))
                y_rng = (int(area[1]) - 4, int(area[3]) + 4) if area else None
                d = nearest_ink_in_column(m, px, py, half_width=hw, y_range=y_rng)
                # A line ends at its first and last point. If the calibration puts that column a few
                # pixels past the end of the drawn line, look a little way inward for the line's end.
                k = s.points.index(p)
                inward = 1 if k == 0 else -1 if k == len(s.points) - 1 else 0
                if inward and (d is None or d / plot_h * 100 > ok_pct):
                    plot_w = (area[2] - area[0]) if area else w
                    reach = max(3, int(round(END_REACH * plot_w)))
                    for step in range(hw + 1, reach + 1):
                        d2 = nearest_ink_in_column(m, px + inward * step, py, half_width=hw, y_range=y_rng)
                        if d2 is not None and (d is None or d2 < d):
                            d = d2
                            p.checks["pixel_end_shift_px"] = step
                dist_pct = None if d is None else d / plot_h * 100
            stats["checked"] += 1
            if dist_pct is None:
                p.flags.append("pixel_missing")
                p.checks["pixel_off_pct"] = None
                stats["off"] += 1
                continue
            p.checks["pixel_off_pct"] = round(dist_pct, 2)
            if ambiguous and _near_other_line(chart, s, p, hues, span):
                # Another line of nearly the same color runs close by here, so the ink found may be its.
                p.checks["pixel_ambiguous"] = True
            stats["max_off_pct"] = max(stats["max_off_pct"], dist_pct)
            if dist_pct <= ok_pct:
                stats["on_ink"] += 1
            elif dist_pct <= bad_pct:
                stats["near"] += 1
                p.flags.append("pixel_near")
            else:
                stats["off"] += 1
                p.flags.append("pixel_off")
    stats["max_off_pct"] = round(stats["max_off_pct"], 2)
    return stats


# ---------------------------------------------------------------------------
# Reconcile
# ---------------------------------------------------------------------------

CROSS_FLAGS = ("crosscheck_disagree", "crosscheck_x")
# A minor difference (1.5 to 4%) is reconciled only when the value sits within 1% of the drawn mark:
# then the second reading is the one that is off (a live second reading was 2 to 3% off on every
# point of a chart the first reading had right). Otherwise it stays a soft flag.
MINOR_CONFIRM_PCT = 1.0
PIXEL_FAIL_FLAGS = ("pixel_near", "pixel_off", "pixel_missing", "off_image")


def reconcile(chart: Chart) -> int:
    """When the two readings disagree but the image confirms the first reading, trust the image.

    The second reading (pixel positions) is the noisier one. If the first reading's value lies on
    the drawn line or bar (the pixel check passed), the disagreement says the second reading is off,
    so the point keeps full confidence and is flagged "second_reading_differs" for the reasons.
    If the pixel check failed or did not run, the cross-check penalty stays.
    """
    n = 0
    for s in chart.series:
        for p in s.points:
            off = p.checks.get("pixel_off_pct")
            if off is None or set(PIXEL_FAIL_FLAGS) & set(p.flags):
                continue
            if p.checks.get("pixel_ambiguous") or off > PIXEL_OK_PCT:
                # Overruling needs a clear match: within the normal tolerance (not the blur-widened
                # one), on a line whose color no other series shares.
                continue
            if p.checks.get("pixel_end_shift_px"):
                # Found by looking inward from the end of the line: along a steep end segment that can
                # pass the height of a wrong value, so it is not enough to overrule the second reading.
                continue
            if set(CROSS_FLAGS) & set(p.flags) or ("crosscheck_minor" in p.flags and off <= MINOR_CONFIRM_PCT):
                p.flags = [f for f in p.flags if f not in CROSS_FLAGS + ("crosscheck_minor",)] + ["second_reading_differs"]
                n += 1
    return n


def bar_centers(image: Image.Image, area: list[float], n: int) -> list[float] | None:
    """Column centers of the n bars drawn in the plot area, or None if they cannot be counted.

    Used when there is no second reading to say where each category sits.
    """
    rgb = np.asarray(image.convert("RGB"))
    h, w = rgb.shape[:2]
    x0, y0, x1, y1 = (int(round(v)) for v in area)
    x0, x1, y0, y1 = max(0, x0), min(w, x1), max(0, y0), min(h, y1)
    if x1 - x0 < 2 * n or y1 <= y0:
        return None
    ink = generic_ink_mask(rgb)[y0:y1, x0:x1]
    cols = ink.sum(axis=0) >= 3
    # Hue of each column's ink, so bars that touch (grouped bars) can be told apart by color.
    hue = cv2.cvtColor(rgb[y0:y1, x0:x1], cv2.COLOR_RGB2HSV)[..., 0].astype(float)
    col_hue = [float(np.median(hue[ink[:, i], i])) if cols[i] else None for i in range(ink.shape[1])]
    runs, start = [], None
    for i, c in enumerate(list(cols) + [False]):
        new_color = (c and start is not None and col_hue[i] is not None and col_hue[i - 1] is not None
                     and min(abs(col_hue[i] - col_hue[i - 1]), 180 - abs(col_hue[i] - col_hue[i - 1])) > 15)
        if start is not None and (not c or new_color):
            if i - start >= 3:
                runs.append((start, i - 1))
            start = None
        if c and start is None:
            start = i
    if runs:  # slivers of colored pixels (anti-aliasing at the frame) are not bars
        typical = float(np.median([b - a + 1 for a, b in runs]))
        runs = [(a, b) for a, b in runs if b - a + 1 >= 0.4 * typical]
    if len(runs) != n:
        return None
    return [x0 + (a + b) / 2 for a, b in runs]
