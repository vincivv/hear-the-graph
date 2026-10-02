"""Snap the second reading's tick positions to tick marks and gridlines found in the image.

Gemini reports where each tick label sits to within a few pixels. A few pixels of
error in the ticks shifts the whole axis calibration, so correct values can look
"close to, but not on" the drawn line. The drawn tick marks and gridlines are exact,
so each reported tick is moved to the nearest one, when one is close enough.

The snapped calibration is used only if enough ticks snap and the fit is at least as
straight as before. Otherwise the reported positions are kept.
"""

from __future__ import annotations

import os

import cv2
import numpy as np

SNAP_FRACTION = 0.5  # of the tick spacing: the most the ticks may move on average (more: one tick off)
MIN_SCALE, MAX_SCALE = 0.8, 1.25  # how far the reported tick spacing may be from the drawn one
MIN_SNAPPED = 0.6  # share of numeric ticks that must find a mark


def enabled() -> bool:
    return os.getenv("TICK_SNAP", "1").strip().lower() not in ("0", "false", "no")


def _masks(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    neutral = hsv[..., 1] < 80  # axes, ticks and gridlines are gray or black; data series are colored
    dark = (gray < 160) & neutral
    light = (gray < 240) & neutral
    return dark, light


def _centers(flags: np.ndarray, weights: np.ndarray | None = None, max_run: int = 4) -> list[float]:
    """Centers of runs of True, skipping runs too thick to be a tick or a gridline."""
    out, i, n = [], 0, len(flags)
    while i < n:
        if not flags[i]:
            i += 1
            continue
        j = i
        while j < n and flags[j]:
            j += 1
        if j - i <= max_run:
            idx = np.arange(i, j)
            w = weights[i:j] if weights is not None else np.ones(j - i)
            out.append(float(np.average(idx, weights=w + 1e-9)))
        i = j
    return out


def _spine(dark: np.ndarray, axis: str, area: list[float]) -> int | None:
    """Column of the left spine (axis "y") or row of the bottom spine (axis "x")."""
    h, w = dark.shape
    x0, y0, x1, y1 = area
    if axis == "y":
        lo, hi = int(max(0, x0 - 0.05 * w)), int(min(w, x0 + 0.05 * w))
        rows = slice(int(max(0, y0)), int(min(h, y1)))
        if hi <= lo:
            return None
        counts = dark[rows, lo:hi].sum(axis=0)
        need = 0.6 * (rows.stop - rows.start)
    else:
        lo, hi = int(max(0, y1 - 0.05 * h)), int(min(h, y1 + 0.05 * h))
        cols = slice(int(max(0, x0)), int(min(w, x1)))
        if hi <= lo:
            return None
        counts = dark[lo:hi, cols].sum(axis=1)
        need = 0.6 * (cols.stop - cols.start)
    k = int(np.argmax(counts))
    return lo + k if counts[k] >= need else None


def candidates(rgb: np.ndarray, area: list[float], axis: str) -> list[float]:
    """Pixel positions (rows for the y axis, columns for the x axis) of tick marks and gridlines."""
    dark, light = _masks(rgb)
    h, w = dark.shape
    x0, y0, x1, y1 = area
    found: list[float] = []
    s = _spine(dark, axis, area)
    if s is not None:
        # Tick marks touch the spine from outside or inside; tick labels never do.
        if axis == "y":
            out_side = dark[:, max(0, s - 4):max(0, s - 2)].all(axis=1) if s >= 4 else np.zeros(h, bool)
            in_side = dark[:, s + 2:s + 4].all(axis=1) if s + 4 <= w else np.zeros(h, bool)
            flags = out_side | in_side
            flags[: int(max(0, y0 - 0.03 * h))] = False
            flags[int(min(h, y1 + 0.03 * h)):] = False
        else:
            out_side = dark[s + 2:s + 4, :].all(axis=0) if s + 4 <= h else np.zeros(w, bool)
            in_side = dark[max(0, s - 4):max(0, s - 2), :].all(axis=0) if s >= 4 else np.zeros(w, bool)
            flags = out_side | in_side
            flags[: int(max(0, x0 - 0.03 * w))] = False
            flags[int(min(w, x1 + 0.03 * w)):] = False
        found += _centers(flags)
    # Gridlines: thin neutral lines across most of the plot, counting only the parts not hidden
    # behind colored data (bars are drawn over the gridlines).
    ys = slice(int(max(0, y0)), int(min(h, y1 + 1)))
    xs = slice(int(max(0, x0)), int(min(w, x1 + 1)))
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    open_ = hsv[..., 1] < 80  # not covered by colored data
    if axis == "y" and xs.stop > xs.start:
        visible = open_[ys, xs].sum(axis=1)
        share = np.where(visible >= 0.25 * (xs.stop - xs.start), light[ys, xs].sum(axis=1) / np.maximum(visible, 1), 0)
        grid = _centers(share > 0.6, share)
        found += [ys.start + g for g in grid]
    elif axis == "x" and ys.stop > ys.start:
        visible = open_[ys, xs].sum(axis=0)
        share = np.where(visible >= 0.25 * (ys.stop - ys.start), light[ys, xs].sum(axis=0) / np.maximum(visible, 1), 0)
        grid = _centers(share > 0.6, share)
        found += [xs.start + g for g in grid]
    found.sort()
    merged: list[float] = []
    for f in found:  # a tick mark and its gridline are one candidate
        if merged and f - merged[-1] <= 2:
            merged[-1] = (merged[-1] + f) / 2
        else:
            merged.append(f)
    return merged


def snap_pairs(pairs: list[tuple[float, float]], cands: list[float]) -> list[tuple[float, float]] | None:
    """Move each (pixel, value) tick onto a drawn tick mark. None if too few snap.

    Reported ticks share their error: an offset, and often a scale error (live readings
    have put the ticks 9 to 11% too far apart). So the ticks are matched to the marks
    together. Every scale between MIN_SCALE and MAX_SCALE, anchored by one tick on one
    mark, predicts all ticks; the transform that lines up the most ticks with marks wins,
    and among equals the one that moves the ticks least. A scale and offset fitted on its
    matches then predicts every tick again, and each tick snaps to the mark nearest its
    prediction. Two ticks never share a mark, and on average a tick moves less than half
    the tick spacing (otherwise the match would be one tick off).
    """
    numeric = [(p, v) for p, v in pairs if v is not None]
    if len(numeric) < 2 or not cands:
        return None
    pix = sorted(p for p, _ in numeric)
    gaps = [b - a for a, b in zip(pix, pix[1:]) if b - a > 1]
    if not gaps:
        return None
    spacing = float(np.median(gaps))
    c = np.array(cands, dtype=float)
    p_arr = np.array([p for p, _ in numeric], dtype=float)
    radius = max(2.5, 0.06 * spacing)

    # All candidate transforms pred = a * p + b, as arrays.
    scales = np.arange(MIN_SCALE, MAX_SCALE + 1e-9, 0.005)
    a = np.repeat(scales, len(p_arr) * len(c))
    anchor_p = np.tile(np.repeat(p_arr, len(c)), len(scales))
    anchor_c = np.tile(c, len(p_arr) * len(scales))
    b = anchor_c - a * anchor_p
    pred = a[:, None] * p_arr[None, :] + b[:, None]  # (T, n)
    dist = np.abs(pred[:, :, None] - c[None, None, :]).min(axis=2)
    hits = (dist <= radius).sum(axis=1)
    move = np.abs(pred - p_arr[None, :]).mean(axis=1)
    ok = move <= SNAP_FRACTION * spacing
    if not ok.any():
        return None
    score = np.where(ok, hits * 1e6 - move, -np.inf)
    t = int(np.argmax(score))

    def assign(pred_row: np.ndarray, r: float) -> dict[int, int]:
        out: dict[int, int] = {}
        taken: set[int] = set()
        for i in np.argsort(np.abs(pred_row[:, None] - c[None, :]).min(axis=1)):
            k = int(np.argmin(np.abs(c - pred_row[i])))
            if abs(c[k] - pred_row[i]) <= r and k not in taken:
                taken.add(k)
                out[int(i)] = k
        return out

    best = assign(pred[t], radius)
    for _ in range(2):  # refine: least-squares scale and offset from the matches, then match again
        if len(best) < 2:
            break
        idx = np.array(sorted(best))
        fa, fb = np.polyfit(p_arr[idx], c[[best[i] for i in idx]], 1)
        if not MIN_SCALE <= fa <= MAX_SCALE:
            break
        m = assign(fa * p_arr + fb, radius)
        if len(m) < len(best):
            break
        best = m
    if len(best) < 2 or len(best) < MIN_SNAPPED * len(numeric):
        return None
    return [(float(c[k]), numeric[i][1]) for i, k in sorted(best.items())]


# ---------------------------------------------------------------------------
# Calibration from the image alone (when the second reading is missing)
# ---------------------------------------------------------------------------


def _longest_run(flags: np.ndarray) -> tuple[int, int]:
    """(start, length) of the longest run of True."""
    best, start, cur_start = (0, 0), 0, None
    for i, f in enumerate(list(flags) + [False]):
        if f and cur_start is None:
            cur_start = i
        elif not f and cur_start is not None:
            if i - cur_start > best[1]:
                best = (cur_start, i - cur_start)
            cur_start = None
    return best


def find_frame(rgb: np.ndarray) -> list[float] | None:
    """Plot area [x0, y0, x1, y1] from the left and bottom axis lines, or None if there are none."""
    dark, _ = _masks(rgb)
    h, w = dark.shape
    best_x = max(((x, *_longest_run(dark[:, x])) for x in range(int(w * 0.45))), key=lambda t: t[2], default=None)
    best_y = max(((y, *_longest_run(dark[y, :])) for y in range(int(h * 0.55), h)), key=lambda t: t[2], default=None)
    if not best_y or best_y[2] < 0.35 * w:
        return None
    y1, x_start, x_len = best_y
    if best_x and best_x[2] >= 0.35 * h:
        x0, y0_start, _ = best_x
        return [float(x0), float(y0_start), float(x_start + x_len - 1), float(y1)]
    # No left axis line (a common style with gridlines): the plot spans the bottom axis line, and its
    # top is the highest gridline as long as that line.
    _, light = _masks(rgb)
    tops = [y for y in range(0, int(y1)) if _longest_run(light[y, x_start:x_start + x_len])[1] >= 0.9 * x_len]
    if not tops:
        return None
    return [float(x_start), float(tops[0]), float(x_start + x_len - 1), float(y1)]


def fit_labels_to_marks(values: list[float], cands: list[float], descending: bool, log: bool):
    """Pair sorted tick values with a run of consecutive marks. Returns (pairs, residual) or None.

    The marks along an axis can include the far frame line and gridlines, so every run of
    len(values) consecutive marks is tried, and the straightest fit wins.
    """
    from .mapping import fit_axis

    vals = sorted(values, reverse=descending)
    n = len(vals)
    if n < 3 or len(cands) < n:
        return None
    best = None
    for s in range(len(cands) - n + 1):
        pairs = list(zip(cands[s:s + n], vals))
        fit = fit_axis(pairs, log)
        if fit is not None and (best is None or fit.residual < best[1]):
            best = (pairs, fit.residual)
    return best if best and best[1] <= 0.01 else None


def find_box(rgb: np.ndarray) -> list[float] | None:
    """The plot frame [x0, y0, x1, y1] as a full box (four axis lines), found even when the lines
    are faint, as on low-resolution images. None unless all four sides agree with each other."""
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    m = (cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY) < 230) & (hsv[..., 1] < 80)
    h, w = m.shape
    cols = [(x, *_longest_run(m[:, x])) for x in range(w)]
    rows = [(y, *_longest_run(m[y, :])) for y in range(h)]
    left = max(cols[: w // 2], key=lambda t: t[2])
    right = max(cols[w // 2:], key=lambda t: t[2])
    top = max(rows[: h // 2], key=lambda t: t[2])
    long_rows = [r for r in rows[h // 2:] if r[2] >= 0.9 * top[2]]
    if not long_rows:
        return None
    bottom = long_rows[-1]  # the lowest long line, not a zero line drawn across the plot
    v, hz = (left[2], right[2]), (top[2], bottom[2])
    if min(v) < 0.35 * h or min(hz) < 0.35 * w or min(v) < 0.85 * max(v) or min(hz) < 0.85 * max(hz):
        return None
    return [float(left[0]), float(top[0]), float(right[0]), float(bottom[0])]
