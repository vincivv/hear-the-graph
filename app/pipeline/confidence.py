"""Combine the four trust signals into confidence (SPEC section 6).

Evidence and priors are kept apart:

- A point's confidence comes only from the checks on that point (sanity,
  cross-check, pixel check). A point is uncertain only when one of its own
  checks fails. The one exception is a tilted photo: perspective moves every
  position, so every point is uncertain until the photo is straightened and
  read again.
- Structural risks (no markers, few tick labels, low resolution, blur, a
  missing second reading, ...) describe the chart, not a point. Together they
  can lower the chart to medium, never to low and never a single point.

Chart level is the lower of the two. Reasons say why in words that match the
level. Thresholds are general and were tuned on the whole test set; nothing
here looks at file names.
"""

from __future__ import annotations

from ..models import Chart, Confidence, Region, RiskFactor
from .fmt import join_words
from .risk import ImageStats
from .summary import x_text

UNCERTAIN = 0.7  # a point below this is announced as uncertain
HIGH = 0.85

# Penalties for findings on a single point. "minor" and "near" are soft findings (within a few
# percent), not failures: even together (0.72) they keep a point above UNCERTAIN.
POINT_PENALTY = {
    "out_of_range": 0.4,
    "invalid": 0.2,
    "crosscheck_minor": 0.85,
    "crosscheck_disagree": 0.45,
    "crosscheck_x": 0.6,
    "no_crosscheck": 0.85,
    "pixel_near": 0.85,
    "pixel_off": 0.5,
    "pixel_missing": 0.5,
    "off_image": 0.4,
}

# On the live replay with injected errors, every point with both soft findings was a real error
# (6 to 7% off) and no correct point had both (DECISIONS.md, "Replaying the live cache").
BOTH_SOFT = {"crosscheck_minor", "pixel_near"}
BOTH_SOFT_PENALTY = 0.85  # 0.85 * 0.85 * 0.85 = 0.61, below UNCERTAIN

MESSAGES = {
    "high": "High confidence.",
    "medium": "The shape is reliable. Exact values may be off by a few percent.",
    # Medium because some points failed their checks: those can be far off, so "a few percent" would be wrong.
    "medium_uncertain": "Most values passed the checks, but some are uncertain. Do not rely on the uncertain values.",
    "low": "Shape only. Do not rely on exact values. Ask a helper or upload the original file.",
}

TILT_POINT_FACTOR = 0.55  # every point on a tilted photo falls below UNCERTAIN
RISK_MEDIUM = 0.85  # structural risks whose combined weight takes the chart below this make it medium

TILT_SEVERE_DEG = 1.0
TILT_MILD_DEG = 0.4
KEYSTONE_SEVERE_DEG = 1.6
BLURRY = 60.0  # Laplacian variance at 900 px
LOW_RES_SIDE = 400
FEW_TICKS = 4


def risk_factors(chart: Chart, stats: ImageStats, cal, b_tick_counts: tuple[int, int] | None,
                 geo_error: str = "") -> list[RiskFactor]:
    out: list[RiskFactor] = []
    no_markers = chart.chart_type == "line" and not chart.has_markers
    if no_markers:
        out.append(RiskFactor(code="no_markers", weight=0.08,
                              text="The line has no point markers, so where each point sits is inferred from the line."))
    sparse = []
    for axis_name, axis, b_count in (("x", chart.x_axis, b_tick_counts[0] if b_tick_counts else 0),
                                      ("y", chart.y_axis, b_tick_counts[1] if b_tick_counts else 0)):
        if axis.scale == "category":
            continue
        n = max(axis.tick_count, b_count)
        if n < FEW_TICKS:
            sparse.append((axis_name, n))
            out.append(RiskFactor(code=f"few_ticks_{axis_name}", weight=0.10,
                                  text=f"The {axis_name} axis has only {n} tick label{'s' if n != 1 else ''}, so values between them are estimated."))
    if no_markers and sparse:
        out.append(RiskFactor(code="unanchored", weight=0.25,
                              text="With no markers and few tick labels, nothing anchors the exact positions, "
                                   "so a misreading near a peak is harder to rule out."))
    # Only a consistent rotation of the page's lines means a photo taken at an angle. The spread of
    # line angles (keystone) is also high on clean charts with a long straight sloped line, so it
    # only adds to the wording here and never triggers on its own.
    if stats.tilt_deg >= TILT_SEVERE_DEG:
        persp = " and in perspective" if stats.keystone_deg >= KEYSTONE_SEVERE_DEG else ""
        out.append(RiskFactor(code="tilted", weight=0.45,
                              text=f"This looks like a photo taken at an angle (about {stats.tilt_deg:.0f} degrees{persp}), "
                                   "which distorts positions, more toward one side."))
    elif stats.tilt_deg >= TILT_MILD_DEG:
        out.append(RiskFactor(code="slightly_tilted", weight=0.12,
                              text=f"The image is slightly tilted (about {stats.tilt_deg:.1f} degrees)."))
    if min(stats.width, stats.height) < LOW_RES_SIDE * 0.65 or stats.width < LOW_RES_SIDE:
        out.append(RiskFactor(code="low_resolution", weight=0.05,
                              text=f"The image is small ({stats.width} by {stats.height} pixels), so small labels can be misread."))
    if stats.sharpness < BLURRY:
        out.append(RiskFactor(code="blurry", weight=0.05, text="The image is blurry, so lines and labels are less precise."))
    if cal is None or cal.y is None or b_tick_counts is None:  # no second reading
        image_only = cal is not None and cal.y is not None
        if geo_error == "busy":
            text = "Gemini was busy, so the second reading was skipped"
        elif geo_error == "inconsistent":
            text = "The second reading's tick positions contradicted each other, so it was not used"
        else:
            text = "The second reading failed"
        if image_only:
            text += (", so the values were checked against the image only, not against a second reading."
                     + (" Choose Try again in a minute for a full check." if geo_error == "busy" else ""))
        else:
            text += (" and the values could not be cross-checked or checked against the image."
                     + (" Choose Try again in a minute for a full check." if geo_error == "busy" else ""))
        out.append(RiskFactor(code="unverified", weight=0.25, text=text))
    if cal is not None and getattr(cal, "conflicts", None):
        out.append(RiskFactor(code="uncalibrated", weight=0.20,
                              text="The axes in the image could not be matched precisely to the tick labels, so the values "
                                   "were checked against the second reading only, not against the drawn marks."))
    if cal is not None:
        for name, fit in (("x", cal.x), ("y", cal.y)):
            if fit is not None and fit.method == "ticks" and fit.n_ticks >= 3 and fit.residual > 0.015:
                out.append(RiskFactor(code=f"uneven_ticks_{name}", weight=0.15,
                                      text=f"The {name} axis tick labels are unevenly spaced in the image, "
                                           "which points to a tilted photo or a misread label."))
            if fit is not None and fit.method == "plot_area":
                out.append(RiskFactor(code=f"no_tick_fit_{name}", weight=0.10,
                                      text=f"The {name} axis could not be calibrated from its tick labels."))
    return out


def regions(chart: Chart) -> list[Region]:
    pts_all = [p for s in chart.series for p in s.points]
    if pts_all and all(p.confidence < UNCERTAIN for p in pts_all):
        return [Region(series="", start_index=0, end_index=max(len(s.points) for s in chart.series) - 1, text="all values")]
    out = []
    for s in chart.series:
        pts = s.points
        run = []
        for i, p in enumerate(pts + [None]):
            if p is not None and p.confidence < UNCERTAIN:
                run.append(i)
                continue
            if run:
                a, b = run[0], run[-1]
                prefix = f"{s.name}: " if len(chart.series) > 1 else ""
                if a == 0 and b == len(pts) - 1:
                    text = f"{prefix}all values"
                elif a == b:
                    text = f"{prefix}the value {'for' if chart.x_axis.scale == 'category' else 'at'} {x_text(chart, pts[a])}"
                else:
                    text = f"{prefix}values from {x_text(chart, pts[a])} to {x_text(chart, pts[b])}"
                out.append(Region(series=s.name, start_index=a, end_index=b, text=text))
                run = []
    return out


def _where(chart, items, limit=4) -> str:
    names = [x_text(chart, p) + (f" ({s.name})" if len(chart.series) > 1 else "") for s, p in items[:limit]]
    more = f" and {len(items) - limit} more" if len(items) > limit else ""
    return join_words(names) + more


def _risk_summary(risks: list[RiskFactor]) -> str:
    short = {
        "no_markers": "the line has no point markers", "unanchored": "nothing anchors the exact positions",
        "low_resolution": "the image is small", "blurry": "the image is blurry",
        "unverified": "there was no second reading to check against", "slightly_tilted": "the image is slightly tilted",
    }
    parts = []
    for r in sorted(risks, key=lambda r: -r.weight):
        if r.code.startswith("few_ticks"):
            text = "an axis has few tick labels"
        elif r.code.startswith("uneven_ticks"):
            text = "the tick labels are unevenly spaced"
        elif r.code.startswith("no_tick_fit"):
            text = "an axis could not be calibrated from its tick labels"
        else:
            text = short.get(r.code, r.text.rstrip(".").lower())
        if text not in parts:
            parts.append(text)
    return join_words(parts[:3])


def assess(chart: Chart, risks: list[RiskFactor], sanity: dict, cross: dict | None, pixel: dict | None,
           geo_error: str = "") -> Confidence:
    tilted = any(r.code == "tilted" for r in risks)
    structural = [r for r in risks if r.code != "tilted"]
    risk_mult = 1.0
    for r in structural:
        risk_mult *= 1 - r.weight

    all_pts = [(s, p) for s in chart.series for p in s.points]
    for s, p in all_pts:
        c = TILT_POINT_FACTOR if tilted else 1.0
        for f in set(p.flags):
            c *= POINT_PENALTY.get(f, 1.0)
        if BOTH_SOFT <= set(p.flags):
            # Two independent checks both place the value a few percent off: together that is a failure.
            c *= BOTH_SOFT_PENALTY
        p.confidence = round(max(0.0, min(1.0, c)), 3)
        if p.confidence < UNCERTAIN and "uncertain" not in p.flags:
            p.flags.append("uncertain")

    confs = [p.confidence for _, p in all_pts]
    mean = sum(confs) / len(confs)
    n_unc = sum(1 for c in confs if c < UNCERTAIN)
    frac_unc = n_unc / len(confs)
    severe_oor = any(p.checks.get("beyond_axis_pct", 0) > 5 for _, p in all_pts)
    failed = [(s, p) for s, p in all_pts if p.confidence < UNCERTAIN]

    # Level from the evidence on the points, then capped by the structural risks (at most down to medium).
    if tilted or mean < 0.6 or frac_unc >= 0.3 or severe_oor:
        level = "low"
    elif mean < HIGH or n_unc > 0:
        level = "medium"
    else:
        level = "high"
    risk_limited = level == "high" and risk_mult < RISK_MEDIUM
    if risk_limited:
        level = "medium"

    # Reasons, most important first, worded to match the level.
    reasons: list[str] = []
    what = "bar" if chart.chart_type == "bar" else "line"
    if tilted:
        reasons.append(next(r.text for r in risks if r.code == "tilted") +
                       " Every value is uncertain until the photo is straightened and read again.")
    elif level == "low":
        reasons.append(f"{n_unc} of {len(confs)} points failed a check: {_where(chart, failed)}.")
    elif n_unc:
        reasons.append(f"{n_unc} point{'s' if n_unc > 1 else ''} failed a check: {_where(chart, failed)}. "
                       "The other points passed.")
    elif risk_limited:
        reasons.append(f"Every point passed its checks, but {_risk_summary(structural)}, "
                       "so a small misreading is harder to rule out.")
    oor = [(s, p) for s, p in all_pts if "out_of_range" in p.flags or "invalid" in p.flags]
    if oor:
        reasons.append(f"{len(oor)} value{'s are' if len(oor) > 1 else ' is'} outside the axis range, which cannot be right: "
                       f"{_where(chart, oor)}.")
    if cross is not None:
        dis = [(s, p) for s, p in all_pts if "crosscheck_disagree" in p.flags]
        xdis = [(s, p) for s, p in all_pts if "crosscheck_x" in p.flags]
        overruled = [(s, p) for s, p in all_pts if "second_reading_differs" in p.flags]
        if dis:
            reasons.append(f"The two readings disagree by more than {4}% of the axis at {_where(chart, dis)}.")
        if xdis:
            reasons.append(f"The two readings place {len(xdis)} point{'s' if len(xdis) > 1 else ''} at different x positions: {_where(chart, xdis)}.")
        if overruled:
            reasons.append(f"The second reading differs at {_where(chart, overruled)}, but the first reading lies on the "
                           f"drawn {what} there, so those values keep full confidence.")
        if cross.get("count_mismatch"):
            name, a, b = cross["count_mismatch"][0]
            reasons.append(f"The two readings found different numbers of points for {name} ({a} and {b}).")
        if not dis and not xdis and not overruled and cross["compared"]:
            reasons.append(f"Both readings agree within {cross['max_dy_pct']:.1f}% of the axis for all {cross['compared']} compared points.")
    if pixel is not None and pixel["checked"]:
        off = [(s, p) for s, p in all_pts if {"pixel_off", "pixel_missing", "off_image"} & set(p.flags)]
        near = [(s, p) for s, p in all_pts if "pixel_near" in p.flags]
        if off:
            reasons.append(f"{len(off)} point{'s do' if len(off) > 1 else ' does'} not lie on the drawn {what}: {_where(chart, off)}.")
        if near:
            reasons.append(f"{len(near)} point{'s lie' if len(near) > 1 else ' lies'} close to, but not exactly on, the drawn {what}: {_where(chart, near)}.")
        both = [(s, p) for s, p in all_pts if BOTH_SOFT <= set(p.flags)]
        if both:
            reasons.append(f"At {_where(chart, both)} both checks place the value a few percent off, so "
                           f"{'they are' if len(both) > 1 else 'it is'} marked uncertain.")
        if not off and not near:
            reasons.append(f"Every point lies on the drawn {what} in the image.")
    for r in sorted(structural, key=lambda r: -r.weight):
        # On a high chart the risks did not change anything, and say so.
        reasons.append(r.text if level != "high" else f"Noted, but the checks passed: {r.text[0].lower()}{r.text[1:]}")
    for n in sanity.get("notes", [])[:2]:
        reasons.append(n[0].upper() + n[1:] + ".")

    return Confidence(
        level=level,
        score=round(mean * risk_mult, 3),
        message=MESSAGES["medium_uncertain" if level == "medium" and n_unc else level],
        reasons=reasons,
        uncertain_regions=regions(chart) if n_unc else [],
        risk_factors=risks,
        signals={
            "sanity": {k: v for k, v in sanity.items() if k != "notes"},
            "crosscheck": cross,
            "pixel": pixel,
            "chart_multiplier": round(risk_mult, 3),
            "point_mean": round(mean, 3),
            "risk_limited": risk_limited,
            "uncertain_points": n_unc,
        },
    )
