"""Chart summary, computed in code from the extracted data.

Covers type, range, trend, maximum and minimum (SPEC section 3). The trend is
described as up to three phases ("rises to a peak of 45 at step 7, then falls
to 6.8"); longer zigzags are summarized by their overall direction.
"""

from __future__ import annotations

from ..models import Chart, Series
from .extract import y_decimals
from .fmt import fmt, join_words, with_unit

FLAT_FRACTION = 0.04  # changes smaller than this share of the range count as flat


def x_name(chart: Chart) -> str:
    label = chart.x_axis.label or ""
    if "(" in label:
        label = label[: label.index("(")].strip()
    return label.lower() if label else "x"


def x_text(chart: Chart, p) -> str:
    """'step 7', 'Tue', '2021'."""
    if chart.x_axis.scale == "category":
        return p.x_label
    name = x_name(chart)
    unit = chart.x_axis.unit
    val = p.x_label + (f" {unit}" if unit and unit not in ("%",) else "")
    if name in ("year", "x") or name == "":
        return val
    return f"{name} {val}"


def y_text(chart: Chart, v: float) -> str:
    d = y_decimals(chart.y_axis)
    if chart.y_axis.scale == "log":
        d = 0 if abs(v) >= 100 else 2 if abs(v) < 10 else 1
    return with_unit(fmt(v, d), chart.y_axis.unit)


def turning_points(ys: list[float], tol: float) -> list[int]:
    """Indexes where the direction changes by more than tol (a zigzag filter)."""
    n = len(ys)
    turns = [0]
    direction, ext = 0, 0
    for i in range(1, n):
        if direction == 0:
            if ys[i] - ys[0] > tol:
                direction, ext = 1, i
            elif ys[0] - ys[i] > tol:
                direction, ext = -1, i
        elif direction == 1:
            if ys[i] >= ys[ext]:
                ext = i
            elif ys[ext] - ys[i] > tol:
                turns.append(ext)
                direction, ext = -1, i
        else:
            if ys[i] <= ys[ext]:
                ext = i
            elif ys[i] - ys[ext] > tol:
                turns.append(ext)
                direction, ext = 1, i
    if turns[-1] != n - 1:
        turns.append(n - 1)
    return turns


def phases(s: Series, span: float) -> list[tuple[str, int, int]]:
    """Monotone runs as (direction, start index, end index), ignoring small wiggles."""
    pts = s.points
    if len(pts) < 2:
        return []
    tol = FLAT_FRACTION * span if span > 0 else 0
    turns = turning_points([p.y for p in pts], tol)
    out: list[tuple[str, int, int]] = []
    for a, b in zip(turns, turns[1:]):
        dy = pts[b].y - pts[a].y
        d = "rises" if dy > tol else "falls" if dy < -tol else "stays level"
        if out and out[-1][0] == d:
            out[-1] = (d, out[-1][1], b)
        else:
            out.append((d, a, b))
    return out


def at(chart: Chart, p) -> str:
    """Preposition plus x: 'at step 7', 'in 2021', 'on Tue'."""
    if chart.x_axis.scale == "category":
        return f"for {x_text(chart, p)}"
    if x_name(chart) == "year":
        return f"in {x_text(chart, p)}"
    return f"at {x_text(chart, p)}"


def trend_sentence(chart: Chart, s: Series, subject: str = "It") -> str:
    pts = s.points
    span = max(p.y for p in pts) - min(p.y for p in pts)
    ph = phases(s, span)
    first, last = pts[0], pts[-1]
    if not ph:
        return ""
    if len(ph) == 1 and ph[0][0] == "stays level":
        return f"{subject} stays about level, near {y_text(chart, sum(p.y for p in pts) / len(pts))}."
    if len(ph) == 1:
        return f"{subject} {ph[0][0]} from {y_text(chart, first.y)} {at(chart, first)} to {y_text(chart, last.y)} {at(chart, last)}."
    if len(ph) <= 3:
        parts = []
        for k, (d, a, b) in enumerate(ph):
            end = pts[b]
            if d == "stays level":
                parts.append(f"stays level until {x_text(chart, end)}")
                continue
            if k < len(ph) - 1:
                kind = "a peak" if d == "rises" else "a low"
                parts.append(f"{d} to {kind} of {y_text(chart, end.y)} {at(chart, end)}")
            else:
                parts.append(f"{d} to {y_text(chart, end.y)} {at(chart, end)}")
        return f"{subject} starts at {y_text(chart, first.y)} {at(chart, first)}, " + ", then ".join(parts) + "."
    # Many turns: overall direction plus how bumpy.
    net = last.y - first.y
    direction = "rises overall" if net > FLAT_FRACTION * span else "falls overall" if net < -FLAT_FRACTION * span else "ends about where it started"
    return (
        f"{subject} {direction}, from {y_text(chart, first.y)} {at(chart, first)} to {y_text(chart, last.y)} "
        f"{at(chart, last)}, with {len(ph) - 1} changes of direction along the way."
    )


def crossings(a: Series, b: Series) -> list[tuple[float, str]]:
    """x positions where two line series cross, by linear interpolation on shared x values."""
    bx = {p.x: p.y for p in b.points}
    shared = [(p.x, p.x_label, p.y, bx[p.x]) for p in a.points if p.x in bx]
    out = []
    for (x0, l0, a0, b0), (x1, l1, a1, b1) in zip(shared, shared[1:]):
        d0, d1 = a0 - b0, a1 - b1
        if d0 == 0:
            out.append((x0, l0))
        elif d0 * d1 < 0:
            t = d0 / (d0 - d1)
            out.append((x0 + t * (x1 - x0), f"between {l0} and {l1}"))
    if shared and shared[-1][2] == shared[-1][3]:
        out.append((shared[-1][0], shared[-1][1]))
    return out


def summarize(chart: Chart) -> dict:
    if chart.status != "ok" or not chart.series:
        return {"text": chart.error or "This chart could not be read.", "sentences": []}
    kind = {"line": "line chart", "bar": "bar chart", "scatter": "scatter plot"}.get(chart.chart_type, "chart")
    n_series = len(chart.series)
    n_pts = sum(len(s.points) for s in chart.series)
    title = f', "{chart.title}"' if chart.title else ""
    sentences = []
    series_part = (
        f"one series of {n_pts} points" if n_series == 1
        else f"{n_series} series: {join_words([s.name for s in chart.series])}"
    )
    sentences.append(f"A {kind}{title}, with {series_part}.")

    xa, ya = chart.x_axis, chart.y_axis
    all_pts = [p for s in chart.series for p in s.points]
    if xa.scale == "category":
        cats = xa.categories
        xdesc = f"{len(cats)} categories from {cats[0]} to {cats[-1]}" if len(cats) > 2 else join_words(cats)
        sentences.append(f"Across: {xa.label + ', ' if xa.label else ''}{xdesc}.")
    else:
        sorted_pts = sorted(all_pts, key=lambda p: p.x)
        sentences.append(f"Across: {xa.label or 'x'}, from {sorted_pts[0].x_label} to {sorted_pts[-1].x_label}.")
    lo, hi = min(p.y for p in all_pts), max(p.y for p in all_pts)
    scale = " on a log scale" if ya.scale == "log" and "log" not in (ya.label or "").lower() else ""
    sentences.append(f"Up: {ya.label or 'value'}{scale}. Values range from {y_text(chart, lo)} to {y_text(chart, hi)}.")

    for s in chart.series:
        prefix = f"{s.name}: " if n_series > 1 else ""
        mx = max(s.points, key=lambda p: p.y)
        mn = min(s.points, key=lambda p: p.y)
        if chart.chart_type == "bar":
            line = f"{prefix}highest is {mx.x_label} at {y_text(chart, mx.y)}; lowest is {mn.x_label} at {y_text(chart, mn.y)}."
            if len(s.points) <= 8:
                line += " In order: " + ", ".join(f"{p.x_label} {y_text(chart, p.y)}" for p in s.points) + "."
            sentences.append(line[0].upper() + line[1:])
        else:
            sentences.append(trend_sentence(chart, s, s.name if n_series > 1 else "It"))
            mm = f"maximum {y_text(chart, mx.y)} {at(chart, mx)}; minimum {y_text(chart, mn.y)} {at(chart, mn)}."
            sentences.append(f"{prefix}{mm}" if prefix else mm[0].upper() + mm[1:])

    if n_series == 2 and chart.chart_type != "bar":
        a, b = chart.series
        cx = crossings(a, b)
        if cx:
            where = join_words([c[1] for c in cx[:3]])
            sentences.append(f"{a.name} and {b.name} cross {len(cx)} time{'s' if len(cx) != 1 else ''}: {where}.")
        else:
            higher = a if a.points[0].y > b.points[0].y else b
            sentences.append(f"{a.name} and {b.name} do not cross; {higher.name} stays higher.")

    if chart.confidence.message:
        sentences.append(chart.confidence.message)
    return {"text": " ".join(sentences), "sentences": sentences}
