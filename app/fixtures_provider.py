"""Fixture mode: serves answer-key readings for the built-in test charts.

It has the same methods as GeminiProvider, so the pipeline runs unchanged. It
never pretends to be a model: every chart it produces is marked source="fixture"
and the UI shows a banner. It cannot read any other file.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

from .gemini import CallMeta, ReadingFailed
from .imaging import fingerprint, pixel_hash
from .models import ChartReading, GeometryReading

FIXTURE_FILE = Path(__file__).parent / "fixtures" / "fixtures.json"
MATCH_THRESHOLD = 0.95


class NoFixture(ReadingFailed):
    pass


class FixtureProvider:
    name = "fixture"
    model = "fixture data (answer key)"
    model_note = ""

    def __init__(self, path: Path = FIXTURE_FILE):
        data = json.loads(path.read_text())
        self.entries = data["charts"]
        self._by_hash = {e["pixel_sha256"]: e for e in self.entries}
        self._fps = np.array([e["fingerprint"] for e in self.entries], dtype=np.float32)

    def match(self, im: Image.Image) -> tuple[dict | None, float]:
        e = self._by_hash.get(pixel_hash(im))
        if e:
            return e, 1.0
        fp = fingerprint(im)
        sims = self._fps @ fp
        aspect = im.width / im.height
        best, best_s = None, -1.0
        for e, s in zip(self.entries, sims):
            ew, eh = e["size"]
            if abs(ew / eh - aspect) / aspect > 0.06:
                continue
            if s > best_s:
                best, best_s = e, float(s)
        if best is not None and best_s >= MATCH_THRESHOLD:
            return best, best_s
        return None, best_s

    def _entry(self, im: Image.Image) -> dict:
        e, s = self.match(im)
        if e is None:
            raise NoFixture(
                "Fixture mode can only read the built-in test charts. Add a Gemini API key to read your own files."
            )
        return e

    def check(self) -> tuple[bool, str]:
        return True, ""

    def detect(self, img, bucket):
        # Fixture mode has no detector; the pipeline uses embedded-image placement instead.
        return None, CallMeta("fixture", self.model, 0.0)

    def read_values(self, img, bucket):
        e = self._entry(img.im)
        return ChartReading.model_validate(e["reading"]), CallMeta("fixture", self.model, 0.0)

    def read_geometry(self, img, bucket):
        e = self._entry(img.im)
        return GeometryReading.model_validate(e["geometry"]), CallMeta("fixture", self.model, 0.0)

    def choose_operation(self, *a, **k):
        raise ReadingFailed("fixture mode uses the rule-based chooser")
