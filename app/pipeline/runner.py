"""Runs the pipeline for one document and records each step for the progress view.

Upload -> render pages -> find charts -> crop -> two readings -> verify
-> confidence -> summary. Runs in a worker thread; the API streams the steps.
"""

from __future__ import annotations

import logging
import os
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from PIL import Image

from ..gemini import ReadingFailed
from ..imaging import load_image, pixel_hash, render_pdf, to_png
from ..models import Chart, Document, Step
from ..storage import Storage
from . import detect as detect_mod
from . import trust
from .extract import Unsupported, normalize
from .summary import summarize

log = logging.getLogger("hear.pipeline")


@dataclass
class ImageInput:
    im: Image.Image
    png: bytes = b""
    sha: str = ""

    @classmethod
    def from_image(cls, im: Image.Image) -> "ImageInput":
        return cls(im=im, png=to_png(im), sha=pixel_hash(im))


IMAGE_STEPS = [
    ("load", "Opening the file"),
    ("detect", "Finding charts"),
    ("read", "Reading values"),
    ("crosscheck", "Cross-checking with a second reading"),
    ("verify", "Verifying points against the image"),
    ("summary", "Writing summaries"),
]
PDF_STEPS = [("load", "Rendering pages")] + IMAGE_STEPS[1:]

BUSY_MESSAGES = {
    "overloaded": "Gemini is busy right now (Google's servers are overloaded), so this chart was not read. "
                  "Choose Try again in a minute.",
    "quota": "Gemini is busy: this app has reached its per-minute request limit, so this chart was not read. "
             "Choose Try again in a minute.",
    "quota_daily": "Gemini is busy: this app has used up today's request limit for its models, so this chart was not read. "
                   "Try again later, or ask the person running the app to switch models.",
}


def busy_message(reason: str) -> str:
    return BUSY_MESSAGES.get(reason, BUSY_MESSAGES["overloaded"])


@dataclass
class Pipeline:
    storage: Storage
    provider: object
    mode: str
    straighten_enabled: bool = True
    step_delay: float = 0.0  # fixture mode only: pace the steps so the demo shows them
    # Parallel Gemini requests. Fewer is gentler on a busy API; GEMINI_MAX_CONCURRENCY overrides.
    call_pool: ThreadPoolExecutor = field(
        default_factory=lambda: ThreadPoolExecutor(max_workers=max(1, int(os.getenv("GEMINI_MAX_CONCURRENCY", "4"))))
    )
    chart_pool: ThreadPoolExecutor = field(default_factory=lambda: ThreadPoolExecutor(max_workers=4))

    # -- progress -----------------------------------------------------------
    def _set(self, doc: Document, key: str, status: str, detail: str = "") -> None:
        if self.step_delay and status == "done":
            time.sleep(self.step_delay)
        for s in doc.steps:
            if s.key == key:
                s.status = status  # type: ignore[assignment]
                if detail or status in ("done", "running"):
                    s.detail = detail
        self.storage.save_document(doc)

    # -- entry point ----------------------------------------------------------
    def process(self, doc: Document, data: bytes) -> None:
        doc.status = "processing"
        doc.steps = [Step(key=k, label=l) for k, l in (PDF_STEPS if doc.kind == "pdf" else IMAGE_STEPS)]
        self.storage.save_document(doc)
        try:
            self._process(doc, data)
            doc.status = "done"
        except Exception as e:  # last-resort guard: never leave a document spinning
            log.error("pipeline failed: %s\n%s", e, traceback.format_exc())
            doc.status = "failed"
            doc.error = str(e) if isinstance(e, (Unsupported, ReadingFailed)) else "Something went wrong while processing this file. Try again, or try a different file."
            for s in doc.steps:
                if s.status == "running":
                    s.status = "failed"
        self.storage.save_document(doc)

    def _process(self, doc: Document, data: bytes) -> None:
        bucket = "samples" if doc.is_sample else "uploads"

        # 1. Pages
        self._set(doc, "load", "running")
        pages: list[tuple[int, Image.Image, list, int]] = []
        if doc.kind == "pdf":
            for page_no, im, rects, n_draw in render_pdf(data):
                pages.append((page_no, im, rects, n_draw))
                self._set(doc, "load", "running", f"Rendered page {page_no}")
        else:
            pages.append((1, load_image(data), [], 0))
        doc.pages = len(pages)
        for page_no, im, _, _ in pages:
            im.save(self.storage.path(doc.id, f"page-{page_no}.png"))
        self._set(doc, "load", "done", f"{len(pages)} page{'s' if len(pages) != 1 else ''}")

        # 2. Find charts
        self._set(doc, "detect", "running")
        found = detect_mod.find_charts(self.provider, pages, doc.kind, bucket, self.call_pool,
                                       progress=lambda d: self._set(doc, "detect", "running", d))
        if not found:
            self._set(doc, "detect", "done", "No charts found")
            for k in ("read", "crosscheck", "verify", "summary"):
                self._set(doc, k, "skipped")
            doc.error = (
                "No charts were found in this file. Hear the Graph reads line and bar charts. "
                "If a chart is there, try uploading it as an image."
            )
            return
        n = len(found)
        self._set(doc, "detect", "done", f"Found {n} chart{'s' if n != 1 else ''}")

        # 3-6. Read, cross-check, verify, summarize each chart
        charts: list[Chart | None] = [None] * n
        done_counts = {"read": 0, "crosscheck": 0, "verify": 0, "summary": 0}
        lock = threading.Lock()

        def tick(step: str):
            with lock:
                done_counts[step] += 1
                c = done_counts[step]
            self._set(doc, step, "running", f"Chart {c} of {n}")

        for k in ("read", "crosscheck", "verify", "summary"):
            self._set(doc, k, "running", f"Chart 0 of {n}")

        def work(i: int):
            f = found[i]
            chart = self.read_chart(doc, i, f, bucket, tick)
            charts[i] = chart

        list(self.chart_pool.map(work, range(n)))
        for k in ("read", "crosscheck", "verify", "summary"):
            ok = sum(1 for c in charts if c and c.status == "ok")
            self._set(doc, k, "done", f"{ok} of {n} charts" if k == "read" else f"Chart {n} of {n}")
        doc.chart_ids = [c.id for c in charts if c]

    # -- one chart --------------------------------------------------------------
    def read_chart(self, doc: Document, index: int, found, bucket: str, tick) -> Chart:
        chart = Chart(id=f"{doc.id}-c{index + 1}", document_id=doc.id, index=index, page=found.page,
                      bbox=found.bbox, chart_type=found.chart_type or "line", title=found.title or "")
        img = ImageInput.from_image(found.image)
        found.image.save(self.storage.chart_image_path(chart))
        chart.image_size = [found.image.width, found.image.height]
        chart.source = "fixture" if self.mode == "fixture" else "live"
        try:
            self._read_into(chart, img, bucket, tick)
        except (ReadingFailed, Unsupported) as e:
            chart.status = "failed"
            if isinstance(e, Unsupported) or "Fixture mode" in str(e):
                chart.error = str(e)
            elif getattr(e, "busy", False):
                chart.error = busy_message(getattr(e, "reason", ""))
                chart.retryable = True
            else:
                chart.error = (
                    "We could not read this chart. The model's answer was empty or malformed twice. "
                    "You can try again, or ask a helper to describe it."
                )
            chart.confidence.level = "low"
            chart.confidence.message = chart.error
            for step in ("read", "crosscheck", "verify", "summary"):
                tick(step)
        self.storage.save_chart(chart)
        return chart

    def retry_chart(self, chart: Chart, bucket: str) -> Chart:
        """Read one chart again from its saved crop, after Gemini was busy.

        Readings that succeeded before come from the cache, so only the missing
        ones are asked for. The new chart replaces the old one under the same id.
        """
        from .detect import Found

        image = Image.open(self.storage.chart_image_path(chart)).convert("RGB")
        found = Found(chart.page, chart.bbox, image, chart.chart_type, chart.title, "retry")
        doc = self.storage.get_document(chart.document_id)
        return self.read_chart(doc, chart.index, found, bucket, lambda step: None)

    def _read_into(self, chart: Chart, img: ImageInput, bucket: str, tick) -> None:
        t0 = time.monotonic()
        fa = self.call_pool.submit(self.provider.read_values, img, bucket)
        fb = self.call_pool.submit(self.provider.read_geometry, img, bucket)
        reading, meta_a = fa.result()
        meta_b = None
        try:
            geometry, meta_b = fb.result()
            geo_error = ""
        except ReadingFailed as e:
            geometry, geo_error = None, ("busy" if getattr(e, "busy", False) else str(e))
        # The two readings run in parallel, so "readings" is the wall time for both; each call's own
        # time includes the SDK's backoff. Cached calls carry the time measured when they were live.
        chart.timings = {
            "read_s": getattr(meta_a, "seconds", 0.0), "read_source": meta_a.source,
            "second_s": getattr(meta_b, "seconds", 0.0) if meta_b else None,
            "second_source": meta_b.source if meta_b else "failed",
            "second_model": meta_b.model if meta_b else "",
            "readings_wall_s": round(time.monotonic() - t0, 2),
        }
        tick("read")

        kind, x_axis, y_axis, series, notes = normalize(reading)
        chart.chart_type = kind
        chart.title = reading.title or chart.title
        chart.x_axis, chart.y_axis, chart.series = x_axis, y_axis, series
        chart.has_markers = reading.has_point_markers
        chart.model = meta_a.model
        chart.backend = meta_a.backend if meta_a.source == "cache" else getattr(self.provider, "backend", "")
        if meta_a.source == "cache":
            chart.source = "cache"
            when = time.strftime("%Y-%m-%d %H:%M", time.localtime(meta_a.created)) if meta_a.created else "earlier"
            chart.source_note = f"Saved model output from {when}, not a new reading."
        elif meta_a.source == "fixture":
            chart.source_note = "Fixture data from the answer key, not model output."
        if getattr(self.provider, "model_note", ""):
            chart.source_note = (chart.source_note + " " + self.provider.model_note).strip()

        result = trust.assess(chart, reading, geometry, img.im, notes, geo_error)
        chart.retryable = geo_error == "busy"
        tick("crosscheck")
        tick("verify")

        # Stretch: a tilted photo is straightened and read again.
        if self.straighten_enabled and result.tilted:
            trust.try_straighten(self, chart, img, bucket, notes)

        chart.summary = summarize(chart)
        chart.timings["total_s"] = round(time.monotonic() - t0, 2)  # readings, checks, any straightening, summary
        tick("summary")
