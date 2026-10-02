"""Image and PDF helpers: normalize uploads, render pages, crop, fingerprint."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageOps

MAX_SIDE = 2000  # longer side of images we keep and send to the model
PDF_DPI = 144


class UnreadableFile(Exception):
    pass


def load_image(data: bytes) -> Image.Image:
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except Exception as e:
        raise UnreadableFile("This file could not be opened as an image.") from e
    im = ImageOps.exif_transpose(im)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        bg.alpha_composite(im)
        im = bg
    im = im.convert("RGB")
    if max(im.size) > MAX_SIDE:
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    return im


def to_png(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=False)
    return buf.getvalue()


def pixel_hash(im: Image.Image) -> str:
    import hashlib

    return hashlib.sha256(np.ascontiguousarray(np.asarray(im.convert("RGB"))).tobytes()).hexdigest()


def fingerprint(im: Image.Image) -> np.ndarray:
    """Small normalized grayscale thumbnail for near-duplicate matching."""
    g = np.asarray(im.convert("L").resize((48, 32), Image.BILINEAR), dtype=np.float32)
    g = g - g.mean()
    n = np.linalg.norm(g)
    return (g / n).ravel() if n > 0 else g.ravel()


def similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b))


def pdf_page_count(data: bytes) -> int:
    import pymupdf

    try:
        with pymupdf.open(stream=data, filetype="pdf") as doc:
            if doc.needs_pass:
                raise UnreadableFile("This PDF is password protected. Remove the password and upload it again.")
            return doc.page_count
    except UnreadableFile:
        raise
    except Exception as e:
        raise UnreadableFile("This PDF could not be opened. It may be damaged.") from e


def render_pdf(data: bytes, dpi: int = PDF_DPI):
    """Yield (page_number, PIL image, embedded image rects in pixels, drawing count)."""
    import pymupdf

    scale = dpi / 72.0
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        for page in doc:
            pix = page.get_pixmap(dpi=dpi, alpha=False)
            im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            rects = []
            for info in page.get_image_info():
                x0, y0, x1, y1 = info["bbox"]
                if (x1 - x0) * (y1 - y0) < 0.02 * page.rect.width * page.rect.height:
                    continue  # icons and logos
                rects.append([x0 * scale, y0 * scale, x1 * scale, y1 * scale])
            try:
                n_drawings = len(page.get_drawings())
            except Exception:
                n_drawings = 0
            yield page.number + 1, im, rects, n_drawings


def crop(im: Image.Image, box: list[float], pad_frac: float = 0.0) -> tuple[Image.Image, list[float]]:
    x0, y0, x1, y1 = box
    pw, ph = (x1 - x0) * pad_frac, (y1 - y0) * pad_frac
    x0 = max(0, int(round(x0 - pw)))
    y0 = max(0, int(round(y0 - ph)))
    x1 = min(im.width, int(round(x1 + pw)))
    y1 = min(im.height, int(round(y1 + ph)))
    return im.crop((x0, y0, x1, y1)), [x0, y0, x1, y1]
