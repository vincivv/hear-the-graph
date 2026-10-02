"""The live code path end to end, with a fake Gemini SDK client.

The real GeminiProvider runs (prompts, schemas, JSON parsing, validation, retry,
cache, function calling); only the network call is replaced. The fake answers
detection from the PDF's own image placements and readings from the fixture
file, as JSON text the way the API returns it. This proves the plumbing, not
the model.
"""

import io
import json
from pathlib import Path
from types import SimpleNamespace

from PIL import Image

from app.config import Settings
from app.fixtures_provider import FixtureProvider
from app.gemini import GeminiProvider, ResponseCache
from app.imaging import pixel_hash, render_pdf
from app.models import Document
from app.pipeline.detect import PAD
from app.pipeline.qa import answer_question
from app.pipeline.runner import Pipeline
from app.storage import Storage

ROOT = Path(__file__).resolve().parent.parent
PDF = (ROOT / "test_data/pdf/sample_lecture.pdf").read_bytes()


def pad_geometry(g, m):
    """Map normalized coordinates of the inner (unpadded) image to the padded crop."""
    if not m:
        return g
    f = lambda v: (m + v / 1000 * (1 - 2 * m)) * 1000
    return {
        "plot_area": [f(v) for v in g["plot_area"]],
        "x_ticks": [{**t, "position": [f(v) for v in t["position"]]} for t in g["x_ticks"]],
        "y_ticks": [{**t, "position": [f(v) for v in t["position"]]} for t in g["y_ticks"]],
        "series": [{**s, "points": [{**p, "position": [f(v) for v in p["position"]]} for p in s["points"]]} for s in g["series"]],
    }


class FakeModels:
    def __init__(self):
        self.fixture = FixtureProvider()
        self.pages = {}
        for _, im, rects, _ in render_pdf(PDF):
            w, h = im.size
            self.pages[pixel_hash(im)] = [[r[1] / h * 1000, r[0] / w * 1000, r[3] / h * 1000, r[2] / w * 1000] for r in rects]
        self.calls = []

    def generate_content(self, model, contents, config):
        if isinstance(contents[0], str) and contents[0].startswith("Chart description"):
            self.calls.append("qa")
            call = SimpleNamespace(name="max", args={})
            return SimpleNamespace(text=None, function_calls=[call])
        part, prompt = contents
        im = Image.open(io.BytesIO(part.inline_data.data)).convert("RGB")
        if prompt.startswith("Find every chart"):
            self.calls.append("detect")
            boxes = self.pages.get(pixel_hash(im), [])
            data = {"charts": [{"box_2d": b, "chart_type": "line", "title": ""} for b in boxes]}
        else:
            task = "read" if prompt.startswith("Read this chart") else "geometry"
            self.calls.append(task)
            entry, _ = self.fixture.match(im)
            m = 0.0
            if entry is None:  # the pipeline pads crops by 3%; look inside the padding
                m = PAD / (1 + 2 * PAD)
                w, h = im.size
                entry, _ = self.fixture.match(im.crop((round(m * w), round(m * h), round((1 - m) * w), round((1 - m) * h))))
            data = entry["reading"] if task == "read" else pad_geometry(entry["geometry"], m)
        return SimpleNamespace(text=json.dumps(data), function_calls=None)


def make(tmp_path):
    s = Settings(gemini_api_key="test", data_dir=tmp_path)
    gp = GeminiProvider(s, ResponseCache(tmp_path / "cache"))
    gp.client = SimpleNamespace(models=FakeModels())
    store = Storage(tmp_path / "sessions", 60)
    return gp, store, Pipeline(store, gp, "live")


def test_pdf_through_live_provider_then_cache(tmp_path):
    gp, store, pipe = make(tmp_path)
    doc = Document(id="d1", filename="sample_lecture.pdf", kind="pdf", is_sample=True)
    store.doc_dir("d1")
    pipe.process(doc, PDF)
    charts = [store.get_chart(c) for c in doc.chart_ids]
    assert doc.status == "done"
    assert sorted(c.page for c in charts) == [2, 4, 5, 5]
    assert all(c.source == "live" and c.status == "ok" for c in charts)
    assert all(c.confidence.level == "high" for c in charts)
    calls = gp.client.models.calls
    assert calls.count("detect") == 3  # text-only slides 1, 3 and 6 never reach the model
    assert calls.count("read") == 4 and calls.count("geometry") == 4

    # Same file again: served from the cache and labeled as such.
    gp.client.models.calls.clear()
    doc2 = Document(id="d2", filename="sample_lecture.pdf", kind="pdf", is_sample=True)
    store.doc_dir("d2")
    pipe.process(doc2, PDF)
    assert gp.client.models.calls == []
    charts2 = [store.get_chart(c) for c in doc2.chart_ids]
    assert all(c.source == "cache" and "not a new reading" in c.source_note for c in charts2)


def test_question_uses_function_calling(tmp_path):
    gp, store, pipe = make(tmp_path)
    doc = Document(id="d3", filename="x.png", kind="image")
    store.doc_dir("d3")
    pipe.process(doc, (ROOT / "web/samples/reaction_rate.png").read_bytes())
    chart = store.get_chart(doc.chart_ids[0])
    a = answer_question(chart, "what's the peak?", None, gp, "uploads")
    assert a.chooser == "gemini" and a.operation == "max" and "45 mol/s" in a.answer


def test_overloaded_gemini_says_try_again(tmp_path):
    from google.genai import errors

    gp, store, pipe = make(tmp_path)

    def busy(*a, **k):
        raise errors.ServerError(503, {"error": {"code": 503, "message": "high demand", "status": "UNAVAILABLE"}})

    gp.client.models.generate_content = busy
    doc = Document(id="d4", filename="x.png", kind="image")
    store.doc_dir("d4")
    pipe.process(doc, (ROOT / "web/samples/reaction_rate.png").read_bytes())
    chart = store.get_chart(doc.chart_ids[0])
    assert chart.status == "failed" and "Gemini is busy" in chart.error and "Try again" in chart.error


def test_busy_second_reading_is_named_and_retried_later(tmp_path):
    from google.genai import errors

    gp, store, pipe = make(tmp_path)
    real = gp.client.models.generate_content

    def geometry_busy(model, contents, config):
        if isinstance(contents[-1], str) and contents[-1].startswith("Do not read any data values"):
            raise errors.ServerError(503, {"error": {"code": 503, "message": "high demand", "status": "UNAVAILABLE"}})
        return real(model, contents, config)

    gp.client.models.generate_content = geometry_busy
    doc = Document(id="d5", filename="x.png", kind="image")
    store.doc_dir("d5")
    png = (ROOT / "web/samples/reaction_rate.png").read_bytes()
    pipe.process(doc, png)
    chart = store.get_chart(doc.chart_ids[0])
    assert chart.status == "ok" and chart.confidence.level != "high"
    assert chart.confidence.signals["second_reading"] == "busy"
    assert any("Gemini was busy" in r for r in chart.confidence.reasons)

    # Later the API recovers: the first reading comes from the cache, only the second is asked for.
    gp.client.models.generate_content = real
    gp.client.models.calls.clear()
    doc2 = Document(id="d6", filename="x.png", kind="image")
    store.doc_dir("d6")
    pipe.process(doc2, png)
    chart2 = store.get_chart(doc2.chart_ids[0])
    assert chart2.confidence.level == "high" and chart2.confidence.signals["second_reading"] == "ok"
    assert gp.client.models.calls == ["geometry"]  # an uploaded image is read whole: no detection call


def test_busy_chart_can_be_read_again(tmp_path, monkeypatch):
    from google.genai import errors

    from app import gemini
    monkeypatch.setattr(gemini.time, "sleep", lambda s: None)  # the per-minute quota wait

    gp, store, pipe = make(tmp_path)
    real = gp.client.models.generate_content

    def quota(*a, **k):
        raise errors.ClientError(429, {"error": {"code": 429, "message": "Quota exceeded", "status": "RESOURCE_EXHAUSTED"}})

    gp.client.models.generate_content = quota
    doc = Document(id="d7", filename="x.png", kind="image")
    store.doc_dir("d7")
    pipe.process(doc, (ROOT / "web/samples/reaction_rate.png").read_bytes())
    chart = store.get_chart(doc.chart_ids[0])
    assert chart.status == "failed" and chart.retryable and "request limit" in chart.error

    gp.client.models.generate_content = real
    again = pipe.retry_chart(chart, "uploads")
    assert again.id == chart.id and again.status == "ok" and not again.retryable
    assert store.get_chart(chart.id).status == "ok"
