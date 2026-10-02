"""Straighten a tilted photo of a slide or chart (stretch goal).

Find the largest bright quadrilateral (the slide or paper), or failing that
the plot frame, and warp it to a rectangle with a perspective transform.
"""

from __future__ import annotations

import cv2
import numpy as np
from PIL import Image


def _order(pts: np.ndarray) -> np.ndarray:
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], dtype=np.float32)


def find_quad(rgb: np.ndarray) -> np.ndarray | None:
    h, w = rgb.shape[:2]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    best = None
    for c in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
        area = cv2.contourArea(c)
        if area < 0.25 * w * h or area > 0.98 * w * h:
            continue
        peri = cv2.arcLength(c, True)
        for eps in (0.01, 0.02, 0.03, 0.05):
            approx = cv2.approxPolyDP(c, eps * peri, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                best = approx.reshape(4, 2).astype(np.float32)
                break
        if best is not None:
            break
    return _order(best) if best is not None else None


def straighten(im: Image.Image) -> tuple[Image.Image, np.ndarray] | None:
    """Return the straightened image and the homography, or None if no quad was found."""
    rgb = np.asarray(im.convert("RGB"))
    quad = find_quad(rgb)
    if quad is None:
        return None
    tl, tr, br, bl = quad
    width = int(round(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl))))
    height = int(round(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr))))
    if width < 100 or height < 100:
        return None
    dst = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32)
    H = cv2.getPerspectiveTransform(quad, dst)
    out = cv2.warpPerspective(rgb, H, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return Image.fromarray(out), H
