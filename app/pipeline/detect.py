"""Find charts on each page and crop them.

Live mode asks Gemini for bounding boxes on PDF pages. If that fails, or in
fixture mode, the PDF's own embedded-image placements are used, which is exact
for slides that contain chart images. A single uploaded image is read whole by
default, which saves one request per upload; DETECT_IN_IMAGES=1 asks for boxes
there too (useful for screenshots with several charts).
"""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from PIL import Image

from ..gemini import ReadingFailed
from ..imaging import crop
from .extract import Unsupported

WHOLE_IMAGE_FRACTION = 0.6
MIN_AREA_FRACTION = 0.02
PAD = 0.03


@dataclass
class Found:
    page: int
    bbox: list[float]
    image: Image.Image
    chart_type: str = ""
    title: str = ""
    method: str = ""


def _iou(a, b) -> float:
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


def boxes_from_detection(det, w: int, h: int) -> list[tuple[list[float], str, str]]:
    out = []
    for c in det.charts:
        y0, x0, y1, x1 = c.box_2d
        box = [x0 / 1000 * w, y0 / 1000 * h, x1 / 1000 * w, y1 / 1000 * h]
        if (box[2] - box[0]) * (box[3] - box[1]) < MIN_AREA_FRACTION * w * h:
            continue
        if any(_iou(box, o[0]) > 0.6 for o in out):
            continue
        out.append((box, c.chart_type, c.title))
    return out


def find_charts(provider, pages, kind: str, bucket: str, pool: ThreadPoolExecutor, progress=None) -> list[Found]:
    from .runner import ImageInput  # local import avoids a cycle

    fixture = getattr(provider, "name", "") == "fixture"

    def one(page):
        page_no, im, rects, n_draw = page
        w, h = im.size
        if fixture:
            if kind == "image":
                entry, _ = provider.match(im)
                if entry is None:
                    raise Unsupported(
                        "Fixture mode can only read the built-in test charts. Add a Gemini API key to read your own files."
                    )
                return [Found(page_no, [0, 0, w, h], im, method="whole image")]
            return [Found(page_no, r, crop(im, r)[0], method="embedded image") for r in rects]

        if kind == "image" and os.getenv("DETECT_IN_IMAGES", "0").strip().lower() not in ("1", "true", "yes"):
            return [Found(page_no, [0, 0, w, h], im, method="whole image")]
        if kind == "pdf" and not rects and n_draw < 10:
            return []  # text-only slide: no call needed
        try:
            det, _ = provider.detect(ImageInput.from_image(im), bucket)
            boxes = boxes_from_detection(det, w, h)
        except ReadingFailed:
            boxes = None
        if boxes is None:  # detector failed: fall back to what we can see in code
            if kind == "image":
                return [Found(page_no, [0, 0, w, h], im, method="whole image (detector failed)")]
            return [Found(page_no, r, crop(im, r)[0], method="embedded image (detector failed)") for r in rects]
        if kind == "image" and not boxes:
            # The student chose this image, so read it whole; the reading itself says if it is not a chart.
            return [Found(page_no, [0, 0, w, h], im, method="whole image (no box found)")]
        if kind == "image" and len(boxes) == 1:
            b = boxes[0][0]
            if (b[2] - b[0]) * (b[3] - b[1]) >= WHOLE_IMAGE_FRACTION * w * h:
                return [Found(page_no, [0, 0, w, h], im, boxes[0][1], boxes[0][2], "whole image")]
        found = []
        for box, ctype, title in boxes:
            c, cbox = crop(im, box, PAD)
            found.append(Found(page_no, cbox, c, ctype, title, "gemini"))
        return found

    results: list[Found] = []
    for i, res in enumerate(pool.map(one, pages)):
        results.extend(sorted(res, key=lambda f: (round(f.bbox[1] / 40), f.bbox[0])))
        if progress and len(pages) > 1:
            progress(f"Page {i + 1} of {len(pages)}: {len(results)} found so far")
    return results
