"""Risk factors measured from the image itself and from the readings.

Image measurements (tilt, keystone, resolution, sharpness) run in code with
OpenCV, so they work the same in live and fixture mode. Tilt is measured on
the page's own structure (axes, gridlines, edges, text): colored data series
are masked out first.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image


@dataclass
class ImageStats:
    width: int
    height: int
    tilt_deg: float  # dominant deviation of long straight lines from horizontal/vertical
    keystone_deg: float  # spread of those deviations; reported, but not evidence of a photo on its own

    sharpness: float  # variance of the Laplacian on a fixed-size copy
    n_lines: int


def _weighted_median(values: np.ndarray, weights: np.ndarray) -> float:
    order = np.argsort(values)
    v, w = values[order], weights[order]
    c = np.cumsum(w)
    return float(v[np.searchsorted(c, c[-1] / 2)])


def measure_image(im: Image.Image) -> ImageStats:
    rgb = np.asarray(im.convert("RGB"))
    h, w = rgb.shape[:2]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    # Work at a fixed scale so thresholds mean the same for every image size.
    scale = 900.0 / max(h, w)
    g = cv2.resize(gray, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
    sharp = float(cv2.Laplacian(g, cv2.CV_64F).var())

    edges = cv2.Canny(g, 50, 150)
    # Tilt is a property of the page: axes, gridlines, slide edges and text. Strongly colored
    # pixels are data series, and a sloped data line is not evidence of a tilted photo.
    small = cv2.resize(rgb, (g.shape[1], g.shape[0]), interpolation=cv2.INTER_AREA)
    colored = (cv2.cvtColor(small, cv2.COLOR_RGB2HSV)[..., 1] > 70).astype(np.uint8)
    edges[cv2.dilate(colored, np.ones((5, 5), np.uint8)) > 0] = 0
    min_len = int(0.22 * min(g.shape))
    lines = cv2.HoughLinesP(edges, 1, np.pi / 720, threshold=60, minLineLength=min_len, maxLineGap=6)
    devs, lens, mids = [], [], []
    if lines is not None:
        for x1, y1, x2, y2 in lines.reshape(-1, 4):
            dx, dy = x2 - x1, y2 - y1
            length = math.hypot(dx, dy)
            a = math.degrees(math.atan2(dy, dx))  # -180..180
            a = (a + 90) % 180 - 90  # -90..90
            if abs(a) <= 15:
                devs.append(a)
                mids.append((float(y1 + y2) / 2, "h"))  # offset across a near-horizontal line
            elif abs(a) >= 75:
                devs.append(a - 90 if a > 0 else a + 90)
                mids.append((float(x1 + x2) / 2, "v"))
            else:
                continue
            lens.append(length)
    if not devs:
        return ImageStats(w, h, 0.0, 0.0, sharp, 0)
    d = np.array(devs)
    L = np.array(lens)
    med = _weighted_median(d, L)
    spread = float(np.sqrt(np.average((d - med) ** 2, weights=L)))
    # A rotated page rotates many separate lines the same way. Segments of one long line
    # (a single sloped data line, found piecewise by Hough) count once.
    support = _distinct_lines([m for m, dv in zip(mids, devs) if abs(dv - med) <= 0.75])
    tilt = abs(med) if support >= 2 else 0.0
    return ImageStats(w, h, tilt, spread, sharp, len(devs))


def _distinct_lines(mids: list[tuple[float, str]], gap: float = 12.0) -> int:
    """Number of separate lines among Hough segments, by family and offset (pixels at 900 px)."""
    n = 0
    for fam in ("h", "v"):
        offs = sorted(o for o, f in mids if f == fam)
        last = None
        for o in offs:
            if last is None or o - last > gap:
                n += 1
            last = o
    return n
