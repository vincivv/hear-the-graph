"""Finding drawn marks ("ink") in a chart image.

Used by the pixel check (does the line or bar really pass where the reading
says?) and by the offline fixture builder.
"""

from __future__ import annotations

import cv2
import numpy as np


def hex_to_rgb(h: str) -> tuple[int, int, int] | None:
    h = (h or "").strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        return None
    try:
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except ValueError:
        return None


def generic_ink_mask(rgb: np.ndarray) -> np.ndarray:
    """Saturated or dark pixels: data marks, not white background or light gray gridlines."""
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    s = hsv[..., 1].astype(np.int16)
    v = hsv[..., 2].astype(np.int16)
    return ((s > 40) & (v > 50)) | (v < 90)


def color_mask(rgb: np.ndarray, color_hex: str, hue_tol: int = 12) -> np.ndarray:
    """Pixels that look like the given series color, tolerant of blur and photos."""
    target = hex_to_rgb(color_hex)
    if target is None:
        return generic_ink_mask(rgb)
    t = np.uint8([[list(target)]])
    th, ts, tv = cv2.cvtColor(t, cv2.COLOR_RGB2HSV)[0, 0].astype(np.int16)
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV).astype(np.int16)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    if ts < 60:  # black or gray series: match by darkness
        return (v < max(110, tv + 70)) & (s < 110)
    dh = np.abs(h - th)
    dh = np.minimum(dh, 180 - dh)
    # Blur and photos wash colors out toward gray, so saturation can be low;
    # gridlines and text are near zero saturation and stay excluded.
    return (dh <= hue_tol) & (s > 28) & (v > 40)


def plot_mask(shape: tuple[int, int], area: list[float] | None, pad: int = 2) -> np.ndarray:
    """Boolean mask of the plot area (x0, y0, x1, y1) in pixels."""
    h, w = shape
    m = np.zeros((h, w), dtype=bool)
    if not area:
        m[:] = True
        return m
    x0, y0, x1, y1 = (int(round(v)) for v in area)
    m[max(0, y0 - pad) : min(h, y1 + pad), max(0, x0 - pad) : min(w, x1 + pad)] = True
    return m


def nearest_ink_in_column(mask: np.ndarray, px: float, py: float, half_width: int = 2, y_range: tuple[int, int] | None = None) -> float | None:
    """Vertical distance (pixels) from (px, py) to the nearest ink pixel in a narrow column."""
    h, w = mask.shape
    x = int(round(px))
    x0, x1 = max(0, x - half_width), min(w, x + half_width + 1)
    if x0 >= x1:
        return None
    col = mask[:, x0:x1].any(axis=1)
    if y_range:
        lo, hi = max(0, y_range[0]), min(h, y_range[1])
        col = col.copy()
        col[:lo] = False
        col[hi:] = False
    ys = np.flatnonzero(col)
    if ys.size == 0:
        return None
    return float(np.min(np.abs(ys - py)))


def bar_end_in_column(mask: np.ndarray, px: float, baseline_py: float, positive: bool, half_width: int = 2) -> float | None:
    """Pixel row where the bar that crosses column px ends (top for positive bars)."""
    h, w = mask.shape
    x = int(round(px))
    x0, x1 = max(0, x - half_width), min(w, x + half_width + 1)
    if x0 >= x1:
        return None
    col = mask[:, x0:x1].mean(axis=1) > 0.5
    b = int(np.clip(round(baseline_py), 0, h - 1))
    # walk from the baseline outward along the bar; allow small gaps (edges, blur)
    step = -1 if positive else 1
    y = b
    # find the bar near the baseline first
    for _ in range(12):
        if 0 <= y < h and col[y]:
            break
        y += step
    else:
        return None
    gap = 0
    last = y
    while 0 <= y < h:
        if col[y]:
            last = y
            gap = 0
        else:
            gap += 1
            if gap > 3:
                break
        y += step
    return float(last)
