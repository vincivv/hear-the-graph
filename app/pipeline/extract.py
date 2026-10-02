"""Turn a validated value reading into the chart record's axes and series."""

from __future__ import annotations

import math

from ..models import Axis, ChartReading, Point, Series
from .fmt import decimals_for, fmt
from .mapping import parse_number

SUPPORTED = ("line", "bar", "scatter")


class Unsupported(Exception):
    pass


def chart_kind(reading: ChartReading) -> str:
    t = (reading.chart_type or "").lower()
    if not reading.is_chart:
        raise Unsupported("This image does not look like a data chart.")
    if t not in SUPPORTED:
        raise Unsupported(
            f"This looks like a {t or 'kind of'} chart. Hear the Graph can read line and bar charts so far."
        )
    return t


def normalize(reading: ChartReading) -> tuple[str, Axis, Axis, list[Series], list[str]]:
    """Returns (kind, x_axis, y_axis, series, notes). Notes feed the sanity check."""
    kind = chart_kind(reading)
    notes: list[str] = []
    categorical = kind == "bar" or reading.x_axis.scale == "category"

    # Categories in order of the model's category index.
    categories: list[str] = []
    if categorical:
        seen: dict[str, float] = {}
        for s in reading.series:
            for p in s.points:
                label = (p.x_label or fmt(p.x_value)).strip()
                if label not in seen:
                    seen[label] = p.x_value
        categories = sorted(seen, key=lambda k: seen[k])

    series: list[Series] = []
    for i, s in enumerate(reading.series):
        name = (s.name or "").strip() or (reading.y_axis.label or f"Series {i + 1}")
        pts: list[Point] = []
        raw_x = []
        for p in s.points:
            if not (math.isfinite(p.y) and math.isfinite(p.x_value)):
                notes.append(f"{name}: a value was not a number and was dropped")
                continue
            if categorical:
                label = (p.x_label or fmt(p.x_value)).strip()
                x = float(categories.index(label))
            else:
                x = float(p.x_value)
                parsed = parse_number(p.x_label) if p.x_label else None
                label = p.x_label.strip() if parsed is not None and abs(parsed - x) < 1e-6 * max(1, abs(x)) else fmt(x, 4)
            raw_x.append(x)
            pts.append(Point(x=x, x_label=label, y=float(p.y)))
        if any(b < a for a, b in zip(raw_x, raw_x[1:])):
            notes.append(f"{name}: points were not in x order and were sorted")
        pts.sort(key=lambda q: q.x)
        dedup: list[Point] = []
        for q in pts:
            if dedup and abs(dedup[-1].x - q.x) < 1e-9:
                notes.append(f"{name}: two points had the same x value; kept the first")
                continue
            dedup.append(q)
        if len(dedup) >= 1:
            series.append(Series(name=name, color=s.color_hex or "", points=dedup))

    if not series or not any(len(s.points) >= 2 for s in series):
        raise Unsupported("The chart was read, but fewer than two data points came back.")

    def axis(raw, values: list[float], cats: list[str], is_x: bool) -> Axis:
        lo, hi = raw.min, raw.max
        if not (math.isfinite(lo) and math.isfinite(hi)) or lo >= hi:
            lo, hi = min(values), max(values)
            if lo == hi:
                lo, hi = lo - 1, hi + 1
            notes.append(f"{'x' if is_x else 'y'} axis range was missing and was taken from the data")
        n_ticks = sum(1 for t in raw.tick_labels if (t or "").strip())
        return Axis(
            label=raw.label,
            unit=raw.unit,
            min=float(lo),
            max=float(hi),
            scale="category" if (is_x and categorical) else raw.scale if raw.scale != "category" else "linear",
            tick_count=n_ticks,
            categories=cats,
        )

    xs = [p.x for s in series for p in s.points]
    ys = [p.y for s in series for p in s.points]
    x_axis = axis(reading.x_axis, xs, categories, True)
    if categorical:
        x_axis.min, x_axis.max = -0.5, len(categories) - 0.5
    y_axis = axis(reading.y_axis, ys, [], False)
    return kind, x_axis, y_axis, series, notes


def y_decimals(y_axis: Axis) -> int:
    if y_axis.scale == "log":
        return 2
    return decimals_for(y_axis.max - y_axis.min)
