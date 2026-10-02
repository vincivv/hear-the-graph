"""The Gemini client's retry, cache and fallback logic, with a fake SDK client (no network)."""

import json

import pytest

from app.config import Settings
from app.gemini import GeminiProvider, ReadingFailed, ResponseCache


class FakeResp:
    def __init__(self, text):
        self.text = text
        self.function_calls = None


class FakeModels:
    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.calls = []

    def generate_content(self, model, contents, config):
        self.calls.append(model)
        out = self.outputs.pop(0)
        if isinstance(out, Exception):
            raise out
        return FakeResp(out)


class FakeClient:
    def __init__(self, outputs):
        self.models = FakeModels(outputs)


class Img:
    png = b"png-bytes"
    sha = "abc123"


VALID = json.dumps({
    "is_chart": True, "chart_type": "line", "title": "T",
    "x_axis": {"label": "", "unit": "", "scale": "linear", "min": 0, "max": 1, "tick_labels": []},
    "y_axis": {"label": "", "unit": "", "scale": "linear", "min": 0, "max": 1, "tick_labels": []},
    "has_point_markers": False,
    "series": [{"name": "s", "color_hex": "", "points": [{"x_label": "0", "x_value": 0, "y": 0.1}, {"x_label": "1", "x_value": 1, "y": 0.9}]}],
})


def provider(tmp_path, outputs):
    s = Settings(gemini_api_key="test", data_dir=tmp_path)
    p = GeminiProvider(s, ResponseCache(tmp_path / "cache"))
    p.client = FakeClient(outputs)
    return p


def test_retry_once_after_empty_then_succeed(tmp_path):
    p = provider(tmp_path, ["", VALID])
    reading, meta = p.read_values(Img, "uploads")
    assert reading.title == "T"
    assert meta.source == "live" and meta.attempts == 2


def test_two_malformed_answers_fail_plainly(tmp_path):
    p = provider(tmp_path, ["{not json", json.dumps({"is_chart": True, "series": []})])
    with pytest.raises(ReadingFailed):
        p.read_values(Img, "uploads")
    assert len(p.client.models.calls) == 2


def test_semantic_check_triggers_retry(tmp_path):
    bad = json.loads(VALID)
    bad["series"][0]["points"] = bad["series"][0]["points"][:1]
    p = provider(tmp_path, [json.dumps(bad), VALID])
    reading, meta = p.read_values(Img, "uploads")
    assert meta.attempts == 2


def test_cache_hit_is_labeled_cache(tmp_path):
    p = provider(tmp_path, [VALID])
    p.read_values(Img, "samples")
    p.client = FakeClient([])  # any call would fail
    reading, meta = p.read_values(Img, "samples")
    assert meta.source == "cache"


def test_missing_model_falls_back(tmp_path):
    from google.genai import errors

    nf = errors.ClientError(404, {"error": {"code": 404, "message": "not found", "status": "NOT_FOUND"}})
    p = provider(tmp_path, [nf, VALID])
    reading, meta = p.read_values(Img, "uploads")
    assert p.client.models.calls == ["gemini-3.8-flash", "gemini-flash-latest"]
    assert meta.model == "gemini-flash-latest"
    assert "not found" in p.model_note


def test_upload_cache_deleted_with_document(tmp_path):
    p = provider(tmp_path, [VALID])
    p.read_values(Img, "uploads")
    assert p.cache.delete_for_hashes({"abc123"}) == 1


def _busy():
    from google.genai import errors
    return errors.ServerError(503, {"error": {"code": 503, "message": "high demand", "status": "UNAVAILABLE"}})


def test_overloaded_model_falls_back_for_that_call(tmp_path):
    p = provider(tmp_path, [_busy(), VALID])
    reading, meta = p.read_values(Img, "uploads")
    assert p.client.models.calls == ["gemini-3.8-flash", "gemini-flash-latest"]
    assert meta.model == "gemini-flash-latest"
    assert p.model == "gemini-3.8-flash"  # only that call moved; the session keeps its model


def test_overloaded_everywhere_is_reported_as_busy(tmp_path):
    p = provider(tmp_path, [_busy(), _busy(), _busy()])
    with pytest.raises(ReadingFailed) as exc:
        p.read_values(Img, "uploads")
    assert exc.value.busy
    assert len(p.client.models.calls) == 3  # each model once; no extra immediate retry after the SDK's own backoff


def test_client_backs_off_on_overload(tmp_path):
    s = Settings(gemini_api_key="test", data_dir=tmp_path)
    p = GeminiProvider(s, ResponseCache(tmp_path / "cache"))
    opts = p.client._api_client._http_options.retry_options
    assert opts.attempts == 5 and 503 in opts.http_status_codes
    assert 429 not in opts.http_status_codes  # quota errors are handled by the client, not waited out blindly


def _quota(daily=False):
    from google.genai import errors
    msg = "Quota exceeded for metric: generate_content_free_tier_requests" + (", GenerateRequestsPerDayPerProjectPerModel" if daily else "")
    return errors.ClientError(429, {"error": {"code": 429, "message": msg, "status": "RESOURCE_EXHAUSTED"}})


def test_fallback_list_is_tried_in_order(tmp_path):
    s = Settings(gemini_api_key="test", data_dir=tmp_path, gemini_model="a", gemini_fallback_model="b, c,a")
    assert s.model_chain == ["a", "b", "c"]
    p = GeminiProvider(s, ResponseCache(tmp_path / "cache"))
    p.client = FakeClient([_busy(), _quota(), VALID])
    reading, meta = p.read_values(Img, "uploads")
    assert p.client.models.calls == ["a", "b", "c"] and meta.model == "c"


def test_busy_model_is_skipped_for_a_while(tmp_path):
    p = provider(tmp_path, [_quota(), VALID, VALID])
    p.read_values(Img, "uploads")
    Img2 = type("Img2", (), {"png": b"other", "sha": "def456"})
    p.read_values(Img2, "uploads")
    # The second call goes straight to the fallback instead of waiting on the busy model again.
    assert p.client.models.calls == ["gemini-3.8-flash", "gemini-flash-latest", "gemini-flash-latest"]


def test_quota_and_overload_are_told_apart(tmp_path):
    chain = ["gemini-3.8-flash", "gemini-flash-latest", "gemini-flash-lite-latest"]
    for errs, reason in (([_busy()] * 3, "overloaded"), ([_quota()] * 3, "quota"), ([_quota(True)] * 3, "quota_daily")):
        p = provider(tmp_path, errs)
        with pytest.raises(ReadingFailed) as exc:
            p.read_values(Img, "uploads")
        assert exc.value.busy and exc.value.reason == reason
        assert p.client.models.calls == chain


def test_daily_quota_model_is_not_asked_again(tmp_path):
    # Every model busy on the first call; the daily-quota model must not be retried on the next one.
    p = provider(tmp_path, [_quota(True), _busy(), _busy(), VALID])
    with pytest.raises(ReadingFailed):
        p.read_values(Img, "uploads")
    Img2 = type("Img2", (), {"png": b"other", "sha": "def456"})
    p.read_values(Img2, "uploads")
    assert p.client.models.calls[3:] == ["gemini-flash-latest"]  # soonest ready, not gemini-3.8-flash


def test_every_model_over_daily_quota_fails_fast(tmp_path):
    p = provider(tmp_path, [_quota(True)] * 3)
    with pytest.raises(ReadingFailed):
        p.read_values(Img, "uploads")
    with pytest.raises(ReadingFailed) as exc:
        p.read_values(type("I", (), {"png": b"x", "sha": "zzz"}), "uploads")
    assert exc.value.reason == "quota_daily" and len(p.client.models.calls) == 3  # no further requests


def test_per_minute_quota_waits_the_requested_delay(tmp_path, monkeypatch):
    from google.genai import errors
    from app import gemini

    slept = []
    monkeypatch.setattr(gemini.time, "sleep", lambda s: slept.append(s))
    q = errors.ClientError(429, {"error": {"code": 429, "message": "Quota exceeded per minute", "status": "RESOURCE_EXHAUSTED",
                                           "details": [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "21s"}]}})
    assert gemini.retry_delay(q) == 21.0
    s = Settings(gemini_api_key="test", data_dir=tmp_path, gemini_model="a", gemini_fallback_model="a")
    p = GeminiProvider(s, ResponseCache(tmp_path / "cache"))
    p.client = FakeClient([q, VALID])
    with pytest.raises(ReadingFailed):
        p.read_values(Img, "uploads")
    p.read_values(type("I", (), {"png": b"x", "sha": "q2"}), "uploads")
    assert slept and 15 < slept[0] <= 21
