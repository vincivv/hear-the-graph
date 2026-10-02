from concurrent.futures import ThreadPoolExecutor

from PIL import Image

from app.gemini import CallMeta, ReadingFailed
from app.models import DetectionResult
from app.pipeline.detect import boxes_from_detection, find_charts


def det(*boxes):
    return DetectionResult.model_validate({"charts": [{"box_2d": b, "chart_type": "line", "title": "t"} for b in boxes]})


def test_boxes_convert_dedupe_and_drop_tiny():
    d = det([100, 100, 500, 600], [105, 102, 505, 598], [0, 0, 10, 10])
    out = boxes_from_detection(d, 1000, 500)
    assert len(out) == 1
    x0, y0, x1, y1 = out[0][0]
    assert (x0, y0, x1, y1) == (100.0, 50.0, 600.0, 250.0)


class FakeDetector:
    name = "gemini"

    def __init__(self, result=None, fail=False):
        self.result, self.fail, self.calls = result, fail, 0

    def detect(self, img, bucket):
        self.calls += 1
        if self.fail:
            raise ReadingFailed("boom")
        return self.result, CallMeta("live", "m", 0)


POOL = ThreadPoolExecutor(2)


def page(n=1, rects=(), draws=0, size=(1000, 600)):
    return (n, Image.new("RGB", size, "white"), list(rects), draws)


def test_single_image_is_read_whole_without_a_detection_call():
    p = FakeDetector(det([20, 20, 400, 400]))
    found = find_charts(p, [page()], "image", "uploads", POOL)
    assert len(found) == 1 and found[0].bbox == [0, 0, 1000, 600] and p.calls == 0


def test_single_image_with_one_big_chart_is_used_whole(monkeypatch):
    monkeypatch.setenv("DETECT_IN_IMAGES", "1")
    p = FakeDetector(det([20, 20, 980, 980]))
    found = find_charts(p, [page()], "image", "uploads", POOL)
    assert len(found) == 1 and found[0].bbox == [0, 0, 1000, 600] and found[0].method == "whole image"


def test_image_with_no_box_is_read_whole(monkeypatch):
    monkeypatch.setenv("DETECT_IN_IMAGES", "1")
    p = FakeDetector(det())
    found = find_charts(p, [page()], "image", "uploads", POOL)
    assert len(found) == 1 and found[0].method == "whole image (no box found)"


def test_pdf_page_crops_each_chart_with_padding():
    p = FakeDetector(det([100, 50, 500, 450], [100, 550, 500, 950]))
    found = find_charts(p, [page(rects=[[1, 1, 2, 2]])], "pdf", "uploads", POOL)
    assert len(found) == 2
    assert found[0].bbox[0] < found[1].bbox[0]  # left to right
    assert found[0].bbox[0] < 50  # padded


def test_text_only_pdf_pages_skip_the_model():
    p = FakeDetector(det())
    assert find_charts(p, [page(draws=1)], "pdf", "uploads", POOL) == []
    assert p.calls == 0


def test_detector_failure_falls_back_to_embedded_images(monkeypatch):
    monkeypatch.setenv("DETECT_IN_IMAGES", "1")
    p = FakeDetector(fail=True)
    found = find_charts(p, [page(rects=[[100, 100, 400, 300]])], "pdf", "uploads", POOL)
    assert len(found) == 1 and "detector failed" in found[0].method
    found = find_charts(p, [page()], "image", "uploads", POOL)
    assert len(found) == 1 and found[0].bbox == [0, 0, 1000, 600]
