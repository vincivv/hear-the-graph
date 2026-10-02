"""Questions about a chart, answered by a fixed set of calculations (SPEC section 10).

Gemini only chooses the operation and its arguments by function calling. Code
computes every number and writes the sentence. The model never sees y values,
so it cannot slip a number into the answer. In fixture mode, or if Gemini
cannot be reached, a small rule-based chooser picks the operation instead and
the answer says so.
"""

from __future__ import annotations

import hashlib
import logging
import math
import os
import re
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout

from ..models import Answer, Chart, Series
from .fmt import join_words
from .mapping import parse_number
from .summary import at, crossings, summarize, x_name, x_text, y_text

log = logging.getLogger("hear.qa")

UNCERTAIN = 0.7

# A student is waiting for the answer: if Gemini has not chosen the operation by then (busy,
# backing off, or waiting out a per-minute quota), the rule chooser answers instead. The call
# keeps running and caches its choice, so asking the same question again uses Gemini's.
_CHOOSER_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="qa-chooser")


def chooser_deadline() -> float:
    try:
        return max(1.0, float(os.getenv("QA_DEADLINE_SECONDS", "12") or 12))
    except ValueError:
        return 12.0


class CannotAnswer(Exception):
    pass


# ---------------------------------------------------------------------------
# Function declarations for Gemini
# ---------------------------------------------------------------------------


def declarations(chart: Chart) -> list[dict]:
    names = [s.name for s in chart.series]
    series = {"type": "string", "enum": names, "description": "Series name. Omit to use all series or the only series."}
    xdesc = "An x value exactly as listed in the chart description" + (" (a category)" if chart.x_axis.scale == "category" else "")
    xparam = {"type": "string", "description": xdesc}

    def fn(name, desc, props=None, required=None):
        return {"name": name, "description": desc,
                "parameters": {"type": "object", "properties": props or {}, "required": required or []}}

    decls = [
        fn("max", "Highest value and where it occurs.", {"series": series}),
        fn("min", "Lowest value and where it occurs.", {"series": series}),
        fn("value_at", "The value at a given x.", {"x": xparam, "series": series}, ["x"]),
        fn("x_where", "Where (at which x) the data reaches a given value.",
           {"y": {"type": "number", "description": "The value to look for, in the y axis units."}, "series": series}, ["y"]),
        fn("trend", "How the data changes between two x values (or over the whole chart if omitted).",
           {"from": xparam, "to": xparam, "series": series}),
        fn("slope", "Average rate of change between two x values (or over the whole chart if omitted).",
           {"from": xparam, "to": xparam, "series": series}),
        fn("average", "Mean of the values, optionally between two x values.", {"from": xparam, "to": xparam, "series": series}),
        fn("range", "Difference between the highest and lowest value.", {"series": series}),
        fn("describe", "A general description or summary of the chart."),
        fn("cannot_answer", "Use when the question cannot be answered from this chart's data.",
           {"reason": {"type": "string", "description": "Short reason, without numbers."}}, ["reason"]),
    ]
    if len(names) >= 2:
        decls += [
            fn("compare", "Compare two series at one x value.",
               {"series_a": series, "series_b": series, "x": xparam}, ["series_a", "series_b", "x"]),
            fn("crossings", "Where two series cross each other.",
               {"series_a": series, "series_b": series}, ["series_a", "series_b"]),
        ]
    return decls


def context(chart: Chart) -> str:
    """What the model is told about the chart: structure only, no y values."""
    xs = []
    for s in chart.series:
        for p in s.points:
            if p.x_label not in xs:
                xs.append(p.x_label)
    return "\n".join([
        f"Title: {chart.title or '(none)'}",
        f"Type: {chart.chart_type}",
        f"X axis: {chart.x_axis.label or '(unlabeled)'}; scale {chart.x_axis.scale}; unit {chart.x_axis.unit or 'none'}",
        f"X values: {', '.join(xs)}",
        f"Y axis: {chart.y_axis.label or '(unlabeled)'}; scale {chart.y_axis.scale}; unit {chart.y_axis.unit or 'none'}",
        f"Series: {', '.join(s.name for s in chart.series)}",
    ])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def find_series(chart: Chart, name: str | None) -> Series | None:
    if not name:
        return None
    n = str(name).strip().lower()
    for s in chart.series:
        if s.name.strip().lower() == n:
            return s
    for s in chart.series:
        if n in s.name.lower() or s.name.lower() in n:
            return s
    raise CannotAnswer(f"There is no series called {name}. The series are {join_words([s.name for s in chart.series])}.")


def series_list(chart: Chart, name: str | None) -> list[Series]:
    s = find_series(chart, name)
    return [s] if s else list(chart.series)


def resolve_x(chart: Chart, raw) -> float:
    """Turn an x argument (number or label) into a chart x position."""
    if raw is None or raw == "":
        raise CannotAnswer("Which x value do you mean?")
    text = str(raw).strip()
    if chart.x_axis.scale == "category":
        cats = chart.x_axis.categories
        for i, c in enumerate(cats):
            if c.lower() == text.lower():
                return float(i)
        for i, c in enumerate(cats):
            if c.lower().startswith(text.lower()[:3]) and len(text) >= 3:
                return float(i)
        raise CannotAnswer(f"{text} is not one of the categories. They are {join_words(cats)}.")
    v = parse_number(text)
    if v is None:
        for s in chart.series:
            for p in s.points:
                if p.x_label.lower() == text.lower():
                    return p.x
        raise CannotAnswer(f"I could not find {text} on the x axis.")
    return v


def level_of(c: float) -> str:
    return "high" if c >= 0.85 else "medium" if c >= UNCERTAIN else "low"


def combine_confidence(chart: Chart, points) -> tuple[str, str]:
    """Answer confidence: the weakest point used, capped by the chart level."""
    order = {"high": 2, "medium": 1, "low": 0}
    if not points:
        return chart.confidence.level, ""
    worst = min(points, key=lambda p: p.confidence)
    lvl = level_of(worst.confidence)
    if order[chart.confidence.level] < order[lvl]:
        lvl = chart.confidence.level
    uncertain = [p for p in points if p.confidence < UNCERTAIN or "uncertain" in p.flags]
    # The level itself is shown and spoken separately; the note says why.
    if lvl == "high":
        note = ""
    elif uncertain:
        names = join_words([x_text(chart, p) for p in uncertain[:3]])
        note = f"The value {'at ' if chart.x_axis.scale != 'category' else 'for '}{names} is uncertain."
    else:
        note = chart.confidence.message
    return lvl, note


def interp(chart: Chart, s: Series, x: float) -> tuple[float, list, bool]:
    """Value at x: exact point, or linear interpolation between neighbors."""
    pts = s.points
    for p in pts:
        if abs(p.x - x) <= 1e-9 * max(1.0, abs(x)):
            return p.y, [p], True
    if x < pts[0].x or x > pts[-1].x:
        raise CannotAnswer(
            f"{x:g} is outside the chart. {s.name} runs from {x_text(chart, pts[0])} to {x_text(chart, pts[-1])}."
        )
    for a, b in zip(pts, pts[1:]):
        if a.x < x < b.x:
            t = (x - a.x) / (b.x - a.x)
            return a.y + t * (b.y - a.y), [a, b], False
    raise CannotAnswer("That x value is not on the chart.")


def x_say(chart: Chart, x: float, s: Series | None = None) -> str:
    """An x position in words: 'step 2', '2021', 'Tue', 'step 2.5'."""
    for ser in ([s] if s else chart.series):
        for p in ser.points:
            if abs(p.x - x) <= 1e-9 * max(1.0, abs(x)):
                return x_text(chart, p)
    name = x_name(chart)
    num = f"{x:.3g}" if abs(x) < 1000 else f"{x:.0f}"
    return num if name in ("year", "x") or chart.x_axis.scale == "category" else f"{name} {num}"


def amount(chart: Chart, v: float) -> str:
    """A difference in y units. Percent differences are percentage points."""
    if chart.y_axis.unit == "%":
        return y_text(chart, v).rstrip("%") + " percentage points"
    return y_text(chart, v)


def pv(p, s: Series) -> dict:
    return {"series": s.name, "x": p.x, "x_label": p.x_label, "y": p.y, "confidence": round(p.confidence, 3)}


def subset(s: Series, x0: float | None, x1: float | None):
    if x0 is None and x1 is None:
        return s.points
    lo = x0 if x0 is not None else s.points[0].x
    hi = x1 if x1 is not None else s.points[-1].x
    if lo > hi:
        lo, hi = hi, lo
    return [p for p in s.points if lo - 1e-9 <= p.x <= hi + 1e-9]


def opt_x(chart, args, key):
    v = args.get(key)
    return resolve_x(chart, v) if v not in (None, "") else None


# ---------------------------------------------------------------------------
# Operations: each returns (answer text, points used, values)
# ---------------------------------------------------------------------------


def op_max(chart, args, low=False):
    word = "lowest" if low else "highest"
    best = []
    for s in series_list(chart, args.get("series")):
        p = (min if low else max)(s.points, key=lambda q: q.y)
        best.append((s, p))
    s, p = (min if low else max)(best, key=lambda sp: sp[1].y)
    who = f"{s.name} has the {word} value: " if len(best) > 1 else f"The {word} value is "
    text = f"{who}{y_text(chart, p.y)} {at(chart, p)}." if len(best) > 1 else f"{who}{y_text(chart, p.y)}, {at(chart, p)}."
    ties = [q for q in s.points if q is not p and q.y == p.y]
    if ties:
        text += f" It is also {y_text(chart, p.y)} {join_words([at(chart, q) for q in ties])}."
    return text, [p], [pv(p, s)]


def op_value_at(chart, args):
    x = resolve_x(chart, args.get("x"))
    out, used, vals = [], [], []
    for s in series_list(chart, args.get("series")):
        y, pts, exact = interp(chart, s, x)
        used += pts
        name = f"{s.name}: " if len(chart.series) > 1 and not args.get("series") else ""
        if exact:
            out.append(f"{name}{y_text(chart, y)} {at(chart, pts[0])}")
        else:
            out.append(f"{name}about {y_text(chart, y)} at {x_say(chart, x, s)}, estimated between "
                       f"{x_text(chart, pts[0])} and {x_text(chart, pts[1])}")
        vals += [pv(p, s) for p in pts]
    text = "; ".join(out) + "."
    return text[0].upper() + text[1:], used, vals


def op_x_where(chart, args):
    target = args.get("y")
    if target is None or not isinstance(target, (int, float)) or not math.isfinite(float(target)):
        raise CannotAnswer("Which value should I look for?")
    target = float(target)
    out, used, vals = [], [], []
    span = max(p.y for s in chart.series for p in s.points) - min(p.y for s in chart.series for p in s.points)
    for s in series_list(chart, args.get("series")):
        hits = []
        if chart.chart_type == "bar" or chart.x_axis.scale == "category":
            close = [p for p in s.points if abs(p.y - target) <= 0.02 * (span or 1)]
            for p in close:
                hits.append(p.x_label)
                used.append(p)
                vals.append(pv(p, s))
            if not hits:
                p = min(s.points, key=lambda q: abs(q.y - target))
                used.append(p)
                vals.append(pv(p, s))
                out.append(f"{'No bar in ' + s.name if len(chart.series) > 1 else 'No bar'} is at {y_text(chart, target)}. "
                           f"The closest is {p.x_label} at {y_text(chart, p.y)}")
                continue
        else:
            pts = s.points
            for a, b in zip(pts, pts[1:]):
                if a.y == target:
                    hits.append(x_text(chart, a))
                    used.append(a)
                    vals.append(pv(a, s))
                elif (a.y - target) * (b.y - target) < 0:
                    t = (target - a.y) / (b.y - a.y)
                    xv = a.x + t * (b.x - a.x)
                    hits.append(f"about {x_say(chart, xv)} (between {a.x_label} and {b.x_label})")
                    used += [a, b]
                    vals += [pv(a, s), pv(b, s)]
            if pts and pts[-1].y == target:
                hits.append(pts[-1].x_label)
                used.append(pts[-1])
                vals.append(pv(pts[-1], s))
        name = f"{s.name} " if len(chart.series) > 1 else "It "
        if hits:
            times = "" if len(hits) == 1 else " twice" if len(hits) == 2 else f" {len(hits)} times"
            if chart.chart_type == "bar" or chart.x_axis.scale == "category":
                where = f" in {s.name}" if len(chart.series) > 1 else ""
                out.append(f"{join_words(hits)} {'is' if len(hits) == 1 else 'are'} at {y_text(chart, target)}{where}")
            else:
                out.append(f"{name}reaches {y_text(chart, target)}{times}: {join_words(hits)}")
        else:
            lo, hi = min(p.y for p in s.points), max(p.y for p in s.points)
            out.append(f"{name}never reaches {y_text(chart, target)}. It stays between {y_text(chart, lo)} and {y_text(chart, hi)}")
    return "; ".join(out) + ".", used, vals


def _endpoints(chart, s, args):
    x0, x1 = opt_x(chart, args, "from"), opt_x(chart, args, "to")
    if x0 is None:
        x0 = s.points[0].x
    if x1 is None:
        x1 = s.points[-1].x
    if x0 > x1:
        x0, x1 = x1, x0
    y0, p0, _ = interp(chart, s, x0)
    y1, p1, _ = interp(chart, s, x1)
    return x0, x1, y0, y1, p0, p1


def op_trend(chart, args):
    out, used, vals = [], [], []
    for s in series_list(chart, args.get("series")):
        x0, x1, y0, y1, p0, p1 = _endpoints(chart, s, args)
        inside = subset(s, x0, x1)
        used += p0 + p1 + inside
        vals += [pv(p, s) for p in inside]
        span = (max(p.y for p in s.points) - min(p.y for p in s.points)) or 1
        dy = y1 - y0
        ups = sum(1 for a, b in zip(inside, inside[1:]) if b.y > a.y)
        downs = sum(1 for a, b in zip(inside, inside[1:]) if b.y < a.y)
        if abs(dy) < 0.04 * span:
            word = "stays about level"
        elif dy > 0:
            word = "rises"
        else:
            word = "falls"
        pct = f" ({abs(dy) / abs(y0) * 100:.0f}%)" if y0 and abs(y0) > 1e-9 and chart.y_axis.unit != "%" else ""
        mixed = " with some ups and downs" if ups and downs else ""
        name = s.name if len(chart.series) > 1 else "It"
        xs0, xs1 = x_say(chart, x0, s), x_say(chart, x1, s)
        if word == "stays about level":
            out.append(f"From {xs0} to {xs1}, {name.lower() if name == 'It' else name} stays about level{mixed}, "
                       f"from {y_text(chart, y0)} to {y_text(chart, y1)}")
        else:
            out.append(f"From {xs0} to {xs1}, {name.lower() if name == 'It' else name} {word}{mixed}, "
                       f"from {y_text(chart, y0)} to {y_text(chart, y1)}, a change of {amount(chart, abs(dy))}{pct}")
    return "; ".join(out) + ".", used, vals


def op_slope(chart, args):
    if chart.x_axis.scale == "category":
        raise CannotAnswer("This chart has categories on the x axis, so a rate of change per unit is not meaningful. Ask for the trend instead.")
    out, used, vals = [], [], []
    for s in series_list(chart, args.get("series")):
        x0, x1, y0, y1, p0, p1 = _endpoints(chart, s, args)
        if x1 == x0:
            raise CannotAnswer("I need two different x values to compute a rate of change.")
        used += p0 + p1
        vals += [pv(p, s) for p in p0 + p1]
        slope = (y1 - y0) / (x1 - x0)
        if chart.y_axis.scale == "log" and y0 > 0 and y1 > 0:
            factor = (y1 / y0) ** (1 / (x1 - x0))
            rate = f"it grows by a factor of about {factor:.3g} per {x_name(chart)}"
        else:
            unit_x = chart.x_axis.unit or x_name(chart)
            rate = f"the average rate of change is {y_text(chart, slope)} per {unit_x}"
        name = f"For {s.name}, " if len(chart.series) > 1 else ""
        out.append(f"{name}from {x_say(chart, x0, s)} to {x_say(chart, x1, s)}, {rate}")
    text = "; ".join(out) + "."
    return text[0].upper() + text[1:], used, vals


def op_average(chart, args):
    out, used, vals = [], [], []
    x0, x1 = opt_x(chart, args, "from"), opt_x(chart, args, "to")
    for s in series_list(chart, args.get("series")):
        pts = subset(s, x0, x1)
        if not pts:
            raise CannotAnswer("There are no points in that range.")
        used += pts
        vals += [pv(p, s) for p in pts]
        mean = sum(p.y for p in pts) / len(pts)
        name = f"{s.name}: " if len(chart.series) > 1 else ""
        rng = f" from {pts[0].x_label} to {pts[-1].x_label}" if (x0 is not None or x1 is not None) else ""
        out.append(f"{name}the average of the {len(pts)} plotted values{rng} is {y_text(chart, mean)}")
    text = "; ".join(out) + "."
    return text[0].upper() + text[1:], used, vals


def op_range(chart, args):
    out, used, vals = [], [], []
    for s in series_list(chart, args.get("series")):
        hi = max(s.points, key=lambda p: p.y)
        lo = min(s.points, key=lambda p: p.y)
        used += [hi, lo]
        vals += [pv(hi, s), pv(lo, s)]
        name = f"{s.name}: " if len(chart.series) > 1 else ""
        out.append(f"{name}values go from {y_text(chart, lo.y)} {at(chart, lo)} to {y_text(chart, hi.y)} {at(chart, hi)}, "
                   f"a range of {amount(chart, hi.y - lo.y)}")
    text = "; ".join(out) + "."
    return text[0].upper() + text[1:], used, vals


def _two(chart, args):
    a = find_series(chart, args.get("series_a"))
    b = find_series(chart, args.get("series_b"))
    if a is None or b is None:
        if len(chart.series) == 2:
            a, b = chart.series
        else:
            raise CannotAnswer("Which two series should I compare?")
    if a is b:
        raise CannotAnswer("Those are the same series. Name two different series.")
    return a, b


def op_compare(chart, args):
    a, b = _two(chart, args)
    x = resolve_x(chart, args.get("x"))
    ya, pa, _ = interp(chart, a, x)
    yb, pb, _ = interp(chart, b, x)
    label = (pa[0].x_label if len(pa) == 1 else f"{x:g}")
    where = f"in {label}" if x_name(chart) == "year" else f"at {x_name(chart) + ' ' if chart.x_axis.scale != 'category' else ''}{label}"
    if abs(ya - yb) < 1e-12:
        text = f"{where[0].upper() + where[1:]}, {a.name} and {b.name} are equal at {y_text(chart, ya)}."
    else:
        hi, lo = (a, b) if ya > yb else (b, a)
        text = (f"{where[0].upper() + where[1:]}, {a.name} is {y_text(chart, ya)} and {b.name} is {y_text(chart, yb)}. "
                f"{hi.name} is higher by {amount(chart, abs(ya - yb))}.")
    return text, pa + pb, [pv(p, a) for p in pa] + [pv(p, b) for p in pb]


def op_crossings(chart, args):
    a, b = _two(chart, args)
    if chart.chart_type == "bar":
        diff = [(p, q) for p, q in zip(a.points, b.points)]
        higher = [p.x_label for p, q in diff if p.y > q.y]
        return (f"Bars do not cross, but {a.name} is higher at {join_words(higher) or 'no category'}.",
                a.points + b.points, [])
    cx = crossings(a, b)
    used = a.points + b.points
    if not cx:
        hi = a if a.points[0].y > b.points[0].y else b
        return f"{a.name} and {b.name} do not cross. {hi.name} stays higher across the whole chart.", used, []
    where = join_words([c[1] for c in cx])
    return f"{a.name} and {b.name} cross {len(cx)} time{'s' if len(cx) != 1 else ''}: {where}.", used, []


def op_describe(chart, args):
    return summarize(chart)["text"], [p for s in chart.series for p in s.points], []


OPS = {
    "max": lambda c, a: op_max(c, a),
    "min": lambda c, a: op_max(c, a, low=True),
    "value_at": op_value_at,
    "x_where": op_x_where,
    "trend": op_trend,
    "slope": op_slope,
    "average": op_average,
    "range": op_range,
    "compare": op_compare,
    "crossings": op_crossings,
    "describe": op_describe,
}


# ---------------------------------------------------------------------------
# Rule-based chooser (fixture mode and fallback)
# ---------------------------------------------------------------------------

_NUM = r"[-−]?\d[\d,]*(?:\.\d+)?"


def rule_choose(chart: Chart, question: str) -> tuple[str, dict]:
    q = question.lower().strip()
    args: dict = {}
    for s in sorted(chart.series, key=lambda s: -len(s.name)):
        if s.name.lower() in q:
            args.setdefault("_named", []).append(s.name)
    named = args.pop("_named", [])
    if len(named) == 1:
        args["series"] = named[0]

    # x mentions: categories or numbers that are x values
    xs_found: list[str] = []
    if chart.x_axis.scale == "category":
        for c in chart.x_axis.categories:
            if re.search(rf"\b{re.escape(c.lower())}\b", q):
                xs_found.append(c)
    nums = [n.replace("−", "-").replace(",", "") for n in re.findall(_NUM, q)]
    xvals = {p.x for s in chart.series for p in s.points}
    xmin, xmax = min(xvals), max(xvals)
    num_x = [n for n in nums if chart.x_axis.scale != "category" and xmin <= float(n) <= xmax]
    # "at 20", "in 2021", "for step 3": an x value even when it is outside the chart
    xname = re.escape(x_name(chart))
    explicit = re.findall(rf"\b(?:at|in|on|for|during)\s+(?:the\s+)?(?:{xname}\s+)?({_NUM})", q)
    if chart.x_axis.scale != "category":
        for n in explicit:
            n = n.replace("−", "-").replace(",", "")
            if n not in num_x:
                num_x.append(n)
    # "above 10", "drop below 10", "reach 30": a value on the y axis, even if it is also an x value
    thresholds = [n.replace("−", "-").replace(",", "") for n in
                  re.findall(rf"\b(?:above|below|over|under|exceeds?|exceeded|past|than|reach(?:es)?|hits?)\s+({_NUM})", q)]
    num_x = [n for n in num_x if n not in thresholds]
    num_y = [n for n in nums if n not in num_x]

    def has(*words):
        return any(re.search(rf"\b{w}", q) for w in words)

    if has("predict", "forecast", "future", "tomorrow") or (has("will") and has("next", "later", "after")):
        return "cannot_answer", {"reason": "The chart only shows the values drawn on it, so it cannot tell what comes next."}
    if has("describe", "summar", "overview", "what does", "tell me about", "what is this", "what's this"):
        return "describe", {}
    if len(chart.series) >= 2 and has("cross", "intersect", "overtake", "pass each", "meet"):
        a, b = (named + [s.name for s in chart.series if s.name not in named])[:2]
        return "crossings", {"series_a": a, "series_b": b}
    if len(chart.series) >= 2 and (has("compare", "difference between", "differ", "versus", "vs", "more than", "less than")
                                   or (has("which", "who") and has("higher", "lower", "more", "less", "bigger", "larger", "ahead"))):
        x = (xs_found or num_x or [None])[0]
        if x is not None:
            a, b = (named + [s.name for s in chart.series if s.name not in named])[:2]
            return "compare", {"series_a": a, "series_b": b, "x": x}
    if has("slope", "rate of change", "how fast", "steep", "per "):
        xs = xs_found or num_x
        return "slope", {**args, **({"from": xs[0], "to": xs[1]} if len(xs) >= 2 else {})}
    if has("average", "mean", "typical"):
        xs = xs_found or num_x
        return "average", {**args, **({"from": xs[0], "to": xs[1]} if len(xs) >= 2 else {})}
    if has("range", "spread", "how much does it vary"):
        return "range", args
    if has("max", "highest", "peak", "largest", "biggest", "most", "top", "greatest", "best"):
        return "max", args
    if has("min", "lowest", "smallest", "least", "fewest", "bottom", "worst"):
        return "min", args
    if num_y and (has("when", "where", "at what", "which", "what day", "what year") and
                  (has("reach", "hit", "equal", "cross", "get to", "is it", "become", "had", "has", "have", "was", "is",
                       "above", "below", "over", "under", "exceed", "pass", "first"))):
        y = float(num_y[0])
        return "x_where", {**args, "y": y}
    if has("trend", "change", "increase", "decrease", "go up", "go down", "rise", "fall", "grow", "drop", "between"):
        xs = xs_found or num_x
        return "trend", {**args, **({"from": xs[0], "to": xs[1]} if len(xs) >= 2 else {})}
    if xs_found or num_x:
        return "value_at", {**args, "x": (xs_found or num_x)[0]}
    return "cannot_answer", {"reason": "I could not match this question to a calculation on this chart."}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

HELP = ("Try asking for the maximum, the minimum, the value at a point, when it reaches a value, "
        "the trend or rate of change between two points, the average, or a comparison of two series.")


def run_operation(chart: Chart, name: str, args: dict) -> tuple[str, list, list]:
    if name not in OPS:
        raise CannotAnswer(args.get("reason") or "This question cannot be answered from the chart's data.")
    return OPS[name](chart, args)


def answer_question(chart: Chart, question: str, series: str | None, provider, bucket: str) -> Answer:
    chooser, chooser_note = "rules", "Matched by simple rules, because fixture mode does not call Gemini."
    name, args = None, {}
    if provider is not None:
        try:
            ctx_text = context(chart)
            ctx_hash = hashlib.sha256(ctx_text.encode()).hexdigest()
            job = _CHOOSER_POOL.submit(provider.choose_operation, question, ctx_text, declarations(chart), ctx_hash, bucket)
            name, args, meta = job.result(timeout=chooser_deadline())
            chooser = "gemini"
            chooser_note = "Gemini chose the calculation; code computed the answer."
            if meta.source == "cache":
                chooser_note += " (Saved choice from an earlier identical question.)"
        except FutureTimeout:
            log.warning("gemini chooser slower than %.0f s; rules answer", chooser_deadline())
            chooser_note = "Gemini was slow to answer, so simple rules matched the question."
        except Exception as e:  # fall back to rules, and say so
            log.warning("gemini chooser failed: %s", e)
            chooser_note = ("Gemini was busy, so simple rules matched the question." if getattr(e, "busy", False)
                            else "Gemini could not be reached, so simple rules matched the question.")
    if name is None:
        name, args = rule_choose(chart, question)
    if series and "series" not in args and name not in ("compare", "crossings", "describe"):
        args["series"] = series
    args = {k: v for k, v in args.items() if v not in (None, "")}

    try:
        text, used, vals = run_operation(chart, name, args)
    except CannotAnswer as e:
        msg = str(e)
        if name == "cannot_answer":
            msg = f"I can't answer that from this chart. {msg} {HELP}"
        return Answer(question=question, answer=msg, operation=name, arguments=args, values=[],
                      confidence=chart.confidence.level, confidence_note="", answerable=False,
                      chooser=chooser, chooser_note=chooser_note)
    lvl, note = combine_confidence(chart, used)
    return Answer(question=question, answer=text, operation=name, arguments=args, values=vals,
                  confidence=lvl, confidence_note=note, answerable=True, chooser=chooser, chooser_note=chooser_note)
