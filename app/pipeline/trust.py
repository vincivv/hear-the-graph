"""Trust layer orchestration: run the checks, score confidence, and try to
straighten tilted photos (SPEC section 6)."""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass

from ..gemini import ReadingFailed
from ..models import Chart
from . import confidence as conf
from .checks import bar_centers, crosscheck, pixel_check, place_points, reconcile, sanity
from .extract import Unsupported, normalize
from .mapping import build_calibration, calibration_from_image
from .risk import ImageStats, measure_image
from .straighten import straighten

log = logging.getLogger("hear.trust")


UNUSABLE_TICK_RESIDUAL = 0.03  # live second readings fit their ticks within 0.003; one at 0.065 had two labels at one height


def _tick_range_margin(reading, chart):
    """When the reported axis range is exactly the first and last tick label, the drawn axis usually
    extends further (plot margins): allow one tick step beyond. None otherwise."""
    from .mapping import parse_number

    vals = sorted(v for v in (parse_number(t) for t in reading.y_axis.tick_labels) if v is not None)
    if len(vals) < 3:
        return None
    lo, hi = chart.y_axis.min, chart.y_axis.max
    step = min(b - a for a, b in zip(vals, vals[1:]))
    if step > 0 and abs(vals[0] - lo) <= 1e-9 * (abs(lo) + 1) and abs(vals[-1] - hi) <= 1e-9 * (abs(hi) + 1):
        return (lo - step, hi + step)
    return None


def _place_bars_from_image(chart: Chart, image, area) -> None:
    """Put each bar's check column on the bar actually drawn, when the bars can be counted.
    Grouped bars are drawn category by category, series in order within each group."""
    n = [len(s.points) for s in chart.series]
    if not n or len(set(n)) != 1:
        return
    centers = bar_centers(image, area, n[0] * len(chart.series))
    if centers is None:
        return
    k = len(chart.series)
    for si, s in enumerate(chart.series):
        for ci, p in enumerate(s.points):
            if p.pixel:
                p.pixel[0] = round(centers[ci * k + si], 1)


@dataclass
class Assessment:
    tilted: bool
    stats: ImageStats


def assess(chart: Chart, reading, geometry, image, notes, geo_error="") -> Assessment:
    w, h = image.size
    stats = measure_image(image)
    cal = None
    if geometry is not None:
        cal = build_calibration(geometry, reading, w, h, image, blurry=stats.sharpness < conf.BLURRY)
        if cal.y is not None and cal.y.method == "ticks" and cal.y.residual > UNUSABLE_TICK_RESIDUAL:
            # The second reading's own ticks contradict each other (two labels at one height), so its
            # positions cannot be converted to values: treat it as missing.
            geometry, geo_error = None, "inconsistent"
    if geometry is None:
        # No second reading: calibrate from the tick labels and the tick marks in the image, so the
        # values can at least be checked against the drawn line or bar.
        cal = calibration_from_image(reading, image)
    if cal is not None:
        chart.plot_area = [round(v, 1) for v in cal.plot_area]
    for s in chart.series:
        for p in s.points:
            p.flags = []
            p.checks = {}
    visible = None
    if cal is not None and cal.y is not None and cal.plot_area and chart.y_axis.scale != "log":
        visible = (cal.y.to_value(cal.plot_area[3]), cal.y.to_value(cal.plot_area[1]))
    if visible is None and chart.y_axis.scale == "linear":
        visible = _tick_range_margin(reading, chart)
    sanity_stats = sanity(chart, notes, visible)
    cross = pixel = None
    pix_source = ""
    if cal is not None and cal.y is not None:
        cross = crosscheck(chart, geometry, cal, w, h) if geometry is not None else None
        # The pixel check must not lean on the second reading it is meant to check. If its ticks were
        # not confirmed by tick marks in the image, calibrate from the first reading's tick labels and
        # the marks instead, when they can be found.
        pix_cal, pix_source = cal, ("image" if geometry is None else "second reading, snapped" if "y" in (cal.snapped or {})
                                    else "second reading")
        if geometry is not None and "y" not in (cal.snapped or {}):
            img_cal = calibration_from_image(reading, image)
            if img_cal is not None:
                pix_cal, pix_source = img_cal, "image"
                cal.conflicts = []  # the pixel check no longer depends on the unconfirmed ticks
        place_points(chart, geometry, pix_cal, w, h)
        if chart.x_axis.scale == "category":
            _place_bars_from_image(chart, image, pix_cal.plot_area)
        if pix_cal.conflicts:
            # The axes could not be pinned down in the image, so a value off the drawn mark would say
            # more about the calibration than about the value. Only the cross-check is used.
            pixel = None
            for s_ in chart.series:
                for p in s_.points:
                    p.checks.pop("pixel_off_pct", None)
        else:
            pixel = pixel_check(chart, image, pix_cal, tolerance_scale=2.0 if stats.sharpness < conf.BLURRY else 1.0)
        if cross is not None:
            cross["overruled_by_image"] = reconcile(chart)
    b_counts = (len(geometry.x_ticks), len(geometry.y_ticks)) if geometry is not None else None
    risks = conf.risk_factors(chart, stats, cal, b_counts, geo_error)
    chart.confidence = conf.assess(chart, risks, sanity_stats, cross, pixel, geo_error)
    chart.confidence.signals["second_reading"] = "ok" if geometry is not None else (
        geo_error if geo_error in ("busy", "inconsistent") else "failed")
    chart.confidence.signals["image"] = {k: (round(v, 2) if isinstance(v, float) else v) for k, v in asdict(stats).items()}
    if cal is not None:
        chart.confidence.signals["pixel_calibration"] = pix_source
        chart.confidence.signals["calibration"] = {
            "x": None if cal.x is None else {"method": cal.x.method, "ticks": cal.x.n_ticks, "residual": round(cal.x.residual, 4)},
            "y": None if cal.y is None else {"method": cal.y.method, "ticks": cal.y.n_ticks, "residual": round(cal.y.residual, 4)},
            "snapped": cal.snapped or {},
        }
    return Assessment(tilted=any(r.code == "tilted" for r in risks), stats=stats)


def try_straighten(pipeline, chart: Chart, img, bucket: str, notes) -> None:
    """Straighten a tilted photo, read it again, and keep whichever reading is better."""
    from .runner import ImageInput

    before = {"level": chart.confidence.level, "score": chart.confidence.score,
              "tilt_deg": chart.confidence.signals.get("image", {}).get("tilt_deg")}
    result = straighten(img.im)
    if result is None:
        chart.straightened = {"used": False, "before": before,
                              "note": "The photo looks tilted, but its edges could not be found to straighten it."}
        return
    out, _ = result
    store = pipeline.storage
    base = store.chart_image_path(chart)
    out.save(base.with_name(f"{chart.id}-straight.png"))
    img2 = ImageInput.from_image(out)
    import time

    t0 = time.monotonic()
    try:
        fb = pipeline.call_pool.submit(pipeline.provider.read_geometry, img2, bucket)
        reading2, _ = pipeline.provider.read_values(img2, bucket)
        try:
            geometry2, _ = fb.result()
            geo_err = ""
        except ReadingFailed as e:
            geometry2, geo_err = None, str(e)
        trial = chart.model_copy(deep=True)
        kind, xa, ya, series, notes2 = normalize(reading2)
        trial.chart_type, trial.x_axis, trial.y_axis, trial.series = kind, xa, ya, series
        trial.has_markers = reading2.has_point_markers
        trial.image_size = [out.width, out.height]
        assess(trial, reading2, geometry2, out, notes2, geo_err)
    except (ReadingFailed, Unsupported) as e:
        live_needed = "Fixture mode" in str(e)
        chart.straightened = {
            "used": False, "before": before,
            "note": ("A straightened copy was made. Reading it again needs live mode with Gemini, so the original reading is kept."
                     if live_needed else "A straightened copy was made, but it could not be read, so the original reading is kept."),
        }
        return
    after = {"level": trial.confidence.level, "score": trial.confidence.score,
             "tilt_deg": trial.confidence.signals.get("image", {}).get("tilt_deg"),
             "seconds": round(time.monotonic() - t0, 2)}
    rank = {"low": 0, "medium": 1, "high": 2}
    better = rank[after["level"]] > rank[before["level"]] or after["score"] > before["score"] + 0.05
    if not better:
        chart.straightened = {"used": False, "before": before, "after": after,
                              "note": "Straightening did not improve the reading, so the original reading is kept."}
        return
    # Adopt the straightened reading; keep the photo for the verification view.
    base.rename(base.with_name(f"{chart.id}-photo.png"))
    base.with_name(f"{chart.id}-straight.png").rename(base)
    for field in ("chart_type", "title", "x_axis", "y_axis", "series", "has_markers", "confidence", "plot_area", "image_size"):
        setattr(chart, field, getattr(trial, field))
    chart.title = reading2.title or chart.title
    chart.straightened = {
        "used": True, "before": before, "after": after,
        "note": f"Straightened the tilted photo and read it again. Confidence went from {before['level']} to {after['level']}.",
    }
    chart.confidence.reasons.insert(0, chart.straightened["note"])
