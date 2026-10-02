"""Pixel <-> value mapping, fitted in code from tick label positions.

This is the "code converts pixels to values" half of the cross-check: Gemini
reports where tick labels and points are; we fit each axis from the ticks and
convert the point pixels into values ourselves.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

import numpy as np

_SUPERSCRIPT = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹⁻", "0123456789-")


def parse_number(label: str) -> float | None:
    """Parse a tick label such as '2,500', '−5', '10³', '10^3', '1e3', '50%', '$40', '0.5k'."""
    if label is None:
        return None
    s = str(label).strip()
    if not s:
        return None
    s = s.replace("−", "-").replace("–", "-").replace(" ", "").replace(" ", "")
    m = re.fullmatch(r"10([⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+)", s)
    if m:
        return 10.0 ** int(m.group(1).translate(_SUPERSCRIPT))
    m = re.fullmatch(r"10\^\{?(-?\d+)\}?", s)
    if m:
        return 10.0 ** int(m.group(1))
    s = re.sub(r"^[^\d\-+.]+", "", s)  # leading currency etc.
    mult = 1.0
    m = re.fullmatch(r"(-?[\d,]*\.?\d+(?:e-?\d+)?)\s*([kKmMbB%]?)[^\d]*", s)
    if not m:
        return None
    num, suf = m.group(1), m.group(2)
    if suf in ("k", "K"):
        mult = 1e3
    elif suf in ("m", "M"):
        mult = 1e6
    elif suf in ("b", "B"):
        mult = 1e9
    try:
        return float(num.replace(",", "")) * mult
    except ValueError:
        return None


def log_tick_values(labels: list[str]) -> list[float | None]:
    """Tick values on a log axis. Superscripts are sometimes lost ("10³" read as "103"): when every
    label is "10" followed by a small exponent and the exponents step by one, read them as powers."""
    vals = [parse_number(t) for t in labels]
    exps = []
    for t in labels:
        m = re.fullmatch(r"\s*10(-?\d)\s*", str(t or ""))
        exps.append(int(m.group(1)) if m else None)
    if len(exps) >= 2 and None not in exps and all(b - a == 1 for a, b in zip(sorted(exps), sorted(exps)[1:])):
        return [10.0 ** e for e in exps]
    return vals


@dataclass
class AxisFit:
    """value = inverse(a * pixel + b), where inverse is identity or 10**t for log axes."""

    a: float
    b: float
    log: bool
    n_ticks: int
    residual: float  # RMS tick residual as a fraction of the fitted axis span
    method: str  # "ticks" or "plot_area"

    def to_value(self, pixel: float) -> float:
        t = self.a * pixel + self.b
        return 10.0 ** t if self.log else t

    def to_pixel(self, value: float) -> float | None:
        if self.log:
            if value <= 0:
                return None
            value = math.log10(value)
        if self.a == 0:
            return None
        return (value - self.b) / self.a

    def t(self, value: float) -> float | None:
        """Value in fit space (log10 for log axes)."""
        if self.log:
            return math.log10(value) if value > 0 else None
        return value


def fit_axis(pairs: list[tuple[float, float]], log: bool, method: str = "ticks") -> AxisFit | None:
    """pairs are (pixel, value). Needs at least two distinct values."""
    pts = []
    for px, v in pairs:
        if v is None or not math.isfinite(v):
            continue
        if log:
            if v <= 0:
                continue
            v = math.log10(v)
        pts.append((px, v))
    if len({round(v, 9) for _, v in pts}) < 2:
        return None
    P = np.array(pts, dtype=float)
    A = np.vstack([P[:, 0], np.ones(len(P))]).T
    (a, b), *_ = np.linalg.lstsq(A, P[:, 1], rcond=None)
    pred = A @ np.array([a, b])
    span = float(P[:, 1].max() - P[:, 1].min()) or 1.0
    resid = float(np.sqrt(np.mean((pred - P[:, 1]) ** 2)) / span) if len(P) > 2 else 0.0
    return AxisFit(float(a), float(b), log, len(P), resid, method)


@dataclass
class Calibration:
    x: AxisFit | None
    y: AxisFit | None
    plot_area: list[float]  # [x0, y0, x1, y1] pixels
    notes: list[str]
    snapped: dict | None = None  # axis -> number of ticks moved onto drawn tick marks or gridlines
    conflicts: list | None = None  # axes whose tick calibration disagrees with the plot frame in the image


def norm_to_px(pos: list[float], w: int, h: int) -> tuple[float, float]:
    """[y, x] normalized 0-1000 -> (x, y) pixels."""
    return pos[1] / 1000.0 * w, pos[0] / 1000.0 * h


def _snapped_fit(fit: AxisFit | None, pairs, rgb, area, axis: str, log: bool, snapped: dict) -> AxisFit | None:
    """Refit an axis from ticks moved onto the drawn tick marks, if that is at least as good."""
    from . import snap

    if fit is None or fit.method != "ticks" or rgb is None or log:
        return fit  # log axes have unlabeled minor tick marks between the labeled ones
    moved = snap.snap_pairs(pairs, snap.candidates(rgb, area, axis))
    if moved is None:
        return fit
    new = fit_axis(moved, log)
    if new is None or new.residual > max(fit.residual, 0.01):
        return fit
    snapped[axis] = len(moved)
    return new


def build_calibration(geometry, reading, w: int, h: int, image=None, blurry: bool = False) -> Calibration:
    """Fit both axes from the geometry reading's tick positions.

    With the image, ticks are first snapped to the tick marks and gridlines drawn
    there (snap.py). Falls back to the plot area edges plus the axis range from the
    value reading when fewer than two tick labels parse as numbers.
    """
    from . import snap

    rgb = np.asarray(image.convert("RGB")) if image is not None and snap.enabled() else None
    snapped: dict = {}
    notes: list[str] = []
    y0, x0, y1, x1 = geometry.plot_area
    area = [x0 / 1000 * w, y0 / 1000 * h, x1 / 1000 * w, y1 / 1000 * h]

    x_fit = None
    if reading.x_axis.scale != "category":
        pairs = []
        xvals = (log_tick_values([t.label for t in geometry.x_ticks]) if reading.x_axis.scale == "log"
                 else [parse_number(t.label) for t in geometry.x_ticks])
        for t, v in zip(geometry.x_ticks, xvals):
            px, _ = norm_to_px(t.position, w, h)
            pairs.append((px, v))
        x_fit = fit_axis(pairs, reading.x_axis.scale == "log")
        x_fit = _snapped_fit(x_fit, pairs, rgb, area, "x", reading.x_axis.scale == "log", snapped)
        if x_fit is None:
            x_fit = fit_axis([(area[0], reading.x_axis.min), (area[2], reading.x_axis.max)], reading.x_axis.scale == "log", "plot_area")
            if x_fit:
                notes.append("x axis mapped from the plot edges because tick labels could not be used")

    pairs = []
    yvals = (log_tick_values([t.label for t in geometry.y_ticks]) if reading.y_axis.scale == "log"
             else [parse_number(t.label) for t in geometry.y_ticks])
    for t, v in zip(geometry.y_ticks, yvals):
        _, py = norm_to_px(t.position, w, h)
        pairs.append((py, v))
    y_fit = fit_axis(pairs, reading.y_axis.scale == "log")
    y_fit = _snapped_fit(y_fit, pairs, rgb, area, "y", reading.y_axis.scale == "log", snapped)
    if y_fit is None:
        y_fit = fit_axis([(area[3], reading.y_axis.min), (area[1], reading.y_axis.max)], reading.y_axis.scale == "log", "plot_area")
        if y_fit:
            notes.append("y axis mapped from the plot edges because tick labels could not be used")
    conflicts = _frame_conflicts(rgb, x_fit, y_fit, reading, snapped, CONFLICT_PCT * (2 if blurry else 1)) if rgb is not None else []
    return Calibration(x_fit, y_fit, _area_with_axes(area, x_fit, y_fit, reading, w, h), notes, snapped, conflicts)


# Tick calibration and frame further apart than this (% of the axis): do not trust either. Doubled on
# blurry images, where the frame lines themselves are less precise (as the pixel check's tolerance).
CONFLICT_PCT = 2.0


def _frame_conflicts(rgb, x_fit, y_fit, reading, snapped: dict, limit_pct: float = CONFLICT_PCT) -> list[str]:
    """Axes whose calibration could not be confirmed by tick marks and disagrees with the plot frame.

    When tick marks cannot be found (low resolution, blur), the plot frame and the axis limits of the
    first reading give an independent calibration. If the two disagree, it is not known which one is
    right, so the pixel check cannot be trusted on that axis.
    """
    from . import snap

    box = snap.find_box(rgb)
    if box is None:
        return []
    x0, y0, x1, y1 = box
    out = []
    for name, fit, ax, lo_px, hi_px in (("x", x_fit, reading.x_axis, x0, x1), ("y", y_fit, reading.y_axis, y1, y0)):
        if fit is None or fit.method != "ticks" or name in snapped or ax.scale != "linear" or not ax.max > ax.min:
            continue
        frame = fit_axis([(lo_px, ax.min), (hi_px, ax.max)], False, "frame")
        if frame is None:
            continue
        span = abs(hi_px - lo_px) or 1.0
        diff = max(abs(fit.to_pixel(v) - frame.to_pixel(v)) for v in (ax.min, ax.max)) / span * 100
        if diff > limit_pct:
            out.append(name)
    return out


def _area_with_axes(area: list[float], x_fit, y_fit, reading, w: int, h: int) -> list[float]:
    """The reported plot area, grown to cover the axis ranges mapped through the calibration.

    Live readings have put the plot area's top edge 60 px below the real one, which hid the
    first point from the pixel check. The tick calibration is the more precise of the two.
    """
    x0, y0, x1, y1 = area
    for fit, lo, hi, is_x in ((x_fit, reading.x_axis.min, reading.x_axis.max, True),
                              (y_fit, reading.y_axis.min, reading.y_axis.max, False)):
        if fit is None or fit.method != "ticks" or lo is None or hi is None or not hi > lo:
            continue
        ends = [fit.to_pixel(v) for v in (lo, hi)]
        if any(e is None or not math.isfinite(e) for e in ends):
            continue
        a, b = min(ends), max(ends)
        if is_x:
            x0, x1 = min(x0, a), max(x1, b)
        else:
            y0, y1 = min(y0, a), max(y1, b)
    return [max(0.0, x0), max(0.0, y0), min(float(w), x1), min(float(h), y1)]


def calibration_from_image(reading, image) -> Calibration | None:
    """Fit the axes without a second reading: the first reading's tick labels, matched to the
    tick marks and gridlines found in the image. None when the axes cannot be found."""
    from . import snap

    rgb = np.asarray(image.convert("RGB"))
    h, w = rgb.shape[:2]
    area = snap.find_frame(rgb)
    if area is None:
        return None
    fits = {}
    for axis, ax in (("x", reading.x_axis), ("y", reading.y_axis)):
        if ax.scale == "category":
            fits[axis] = None
            continue
        if ax.scale == "log":
            return None  # minor tick marks on log axes are easily matched to the wrong labels
        values = [v for v in (parse_number(t) for t in ax.tick_labels) if v is not None]
        log = False
        found = snap.fit_labels_to_marks(values, snap.candidates(rgb, area, axis), descending=axis == "y", log=log)
        fits[axis] = fit_axis(found[0], log, "image_ticks") if found else None
    if fits["y"] is None or (reading.x_axis.scale != "category" and fits["x"] is None):
        return None
    return Calibration(fits["x"], fits["y"], _area_with_axes(area, fits["x"], fits["y"], reading, w, h),
                       ["axes calibrated from the tick labels and the tick marks in the image"])
