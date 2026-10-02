"""The built-in samples open from saved live readings (app/demo_cache) without calling Gemini."""

import time
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.skipif(not (ROOT / "app/demo_cache").exists(), reason="no demo cache")


def _client(monkeypatch, tmp_path, calls):
    import app.gemini as gemini

    def no_call(**kw):
        calls.append(kw.get("model"))
        raise AssertionError("a sample should not call Gemini")

    for v in ("GOOGLE_GENAI_USE_ENTERPRISE", "GOOGLE_GENAI_USE_VERTEXAI", "GEMINI_MODEL", "GEMINI_FALLBACK_MODEL",
              "SEED_CACHE_DIRS"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("APP_MODE", "live")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("LIMIT_DOCUMENTS_PER_HOUR", "0")
    monkeypatch.setattr(gemini, "make_client", lambda settings, http_options=None: SimpleNamespace(
        models=SimpleNamespace(get=lambda model: None, generate_content=no_call)))


def _open(c, sample: str) -> dict:
    doc = c.post(f"/api/samples/{sample}").json()["id"]
    for _ in range(200):
        d = c.get(f"/api/documents/{doc}").json()
        if d["status"] in ("done", "failed"):
            break
        time.sleep(0.1)
    return d


def test_samples_open_from_the_demo_cache_without_api_calls(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    from app.main import app

    calls = []
    _client(monkeypatch, tmp_path, calls)
    with TestClient(app) as c:
        assert c.get("/api/health").json()["mode"] == "live"
        for sample in ("two-lines", "phone-photo"):
            d = _open(c, sample)
            chart = c.get(f"/api/charts/{d['charts'][0]['id']}").json()
            assert chart["status"] == "ok" and chart["source"] == "cache"
            assert "Saved model output" in chart["source_note"]
            if sample == "phone-photo":
                assert chart["straightened"]["used"]  # the straightened copy's readings are saved too
    assert calls == []


def test_lecture_pdf_opens_from_the_demo_cache_without_api_calls(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    from app.main import app

    calls = []
    _client(monkeypatch, tmp_path, calls)
    with TestClient(app) as c:
        d = _open(c, "lecture")
        assert d["status"] == "done"
        charts = [c.get(f"/api/charts/{ch['id']}").json() for ch in d["charts"]]
        assert sorted(ch["page"] for ch in charts) == [2, 4, 5, 5]
        for chart in charts:
            assert chart["status"] == "ok" and chart["source"] == "cache", chart.get("error")
            assert "Saved model output" in chart["source_note"]
    assert calls == []
