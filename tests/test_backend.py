"""Choosing the backend: Gemini API key, or Gemini on Google Cloud with Application Default Credentials.

No network: clients are built but never called, and calls go to a fake SDK client.
"""

import json
from types import SimpleNamespace

import pytest

from app.config import load_settings
from app.gemini import GeminiProvider, ResponseCache, make_client

CLOUD_VARS = ("GOOGLE_GENAI_USE_ENTERPRISE", "GOOGLE_GENAI_USE_VERTEXAI", "GOOGLE_CLOUD_PROJECT",
              "GOOGLE_CLOUD_LOCATION", "GEMINI_API_KEY", "GOOGLE_API_KEY", "APP_MODE", "GEMINI_MODEL",
              "GEMINI_FALLBACK_MODEL")


@pytest.fixture
def env(monkeypatch, tmp_path):
    for v in CLOUD_VARS:
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    return monkeypatch


def test_api_key_path_is_unchanged(env):
    env.setenv("GEMINI_API_KEY", "k-123")
    s = load_settings()
    assert s.backend == "api_key" and s.app_mode == "live" and s.has_credentials
    api = make_client(s)._api_client
    assert not api.vertexai and api.api_key == "k-123" and api.project is None


def test_cloud_variables_start_live_mode_without_a_key(env):
    env.setenv("GOOGLE_GENAI_USE_ENTERPRISE", "true")
    env.setenv("GOOGLE_CLOUD_PROJECT", "my-proj")
    env.setenv("GOOGLE_CLOUD_LOCATION", "us-central1")
    s = load_settings()
    assert s.backend == "cloud" and s.app_mode == "live" and s.gemini_api_key == ""
    assert "Google Cloud" in s.backend_label and "my-proj" in s.backend_label
    api = make_client(s)._api_client
    assert api.vertexai is True and api.project == "my-proj" and api.location == "us-central1"
    assert api.api_key is None


def test_cloud_wins_over_a_key_and_location_defaults_to_global(env):
    env.setenv("GEMINI_API_KEY", "k-123")
    env.setenv("GOOGLE_GENAI_USE_VERTEXAI", "1")  # legacy name
    env.setenv("GOOGLE_CLOUD_PROJECT", "my-proj")
    s = load_settings()
    assert s.backend == "cloud" and s.google_cloud_location == "global"
    api = make_client(s)._api_client
    assert api.vertexai is True and api.api_key is None  # the key is never sent on the cloud path


def test_cloud_without_project_stays_in_fixture_mode(env):
    env.setenv("GOOGLE_GENAI_USE_ENTERPRISE", "true")
    s = load_settings()
    assert s.backend == "cloud" and not s.has_credentials and s.app_mode == "fixture"


def test_enterprise_false_keeps_the_key_path(env):
    env.setenv("GOOGLE_GENAI_USE_ENTERPRISE", "false")
    env.setenv("GOOGLE_GENAI_USE_VERTEXAI", "true")  # the newer variable wins, as in the SDK
    env.setenv("GEMINI_API_KEY", "k-123")
    assert load_settings().backend == "api_key"


VALID = json.dumps({
    "is_chart": True, "chart_type": "line", "title": "T",
    "x_axis": {"label": "", "unit": "", "scale": "linear", "min": 0, "max": 1, "tick_labels": []},
    "y_axis": {"label": "", "unit": "", "scale": "linear", "min": 0, "max": 1, "tick_labels": []},
    "has_point_markers": False,
    "series": [{"name": "s", "color_hex": "", "points": [{"x_label": "0", "x_value": 0, "y": 0.1}, {"x_label": "1", "x_value": 1, "y": 0.9}]}],
})


def _not_found():
    from google.genai import errors
    return errors.ClientError(404, {"error": {"code": 404, "message": "Publisher model not found", "status": "NOT_FOUND"}})


class FakeModels:
    def __init__(self, known):
        self.known, self.calls = known, []

    def get(self, model):
        if model not in self.known:
            raise _not_found()
        return SimpleNamespace(name=model)

    def generate_content(self, model, contents, config):
        self.calls.append(model)
        if model not in self.known:
            raise _not_found()
        return SimpleNamespace(text=VALID, function_calls=None)


def cloud_provider(env, tmp_path, known):
    env.setenv("GOOGLE_GENAI_USE_ENTERPRISE", "true")
    env.setenv("GOOGLE_CLOUD_PROJECT", "my-proj")
    s = load_settings()
    p = GeminiProvider(s, ResponseCache(tmp_path / "cache"))
    p.client = SimpleNamespace(models=FakeModels(known))
    return p


def test_model_missing_on_cloud_falls_through_the_chain(env, tmp_path):
    # The default model id does not exist on Google Cloud; the next one in the chain does.
    p = cloud_provider(env, tmp_path, known={"gemini-flash-latest"})
    ok, note = p.check()
    assert ok and p.model == "gemini-flash-latest" and "not found" in note
    img = SimpleNamespace(png=b"x", sha="h1")
    reading, meta = p.read_values(img, "uploads")
    assert p.client.models.calls == ["gemini-flash-latest"] and meta.backend == "cloud"
    cached = json.loads(next((tmp_path / "cache" / "uploads").glob("*.json")).read_text())
    assert cached["backend"] == "cloud" and cached["seconds"] >= 0


def test_model_missing_at_call_time_on_cloud(env, tmp_path):
    p = cloud_provider(env, tmp_path, known={"gemini-flash-lite-latest"})
    reading, meta = p.read_values(SimpleNamespace(png=b"x", sha="h2"), "uploads")
    assert p.client.models.calls == ["gemini-3.8-flash", "gemini-flash-latest", "gemini-flash-lite-latest"]
    assert meta.model == "gemini-flash-lite-latest" and p.model == "gemini-flash-lite-latest"


def test_cloud_with_no_credentials_says_how_to_fix_it(env, tmp_path):
    p = cloud_provider(env, tmp_path, known=set())

    class DefaultCredentialsError(Exception):
        pass

    def get(model):
        raise DefaultCredentialsError("no ADC")

    p.client.models.get = get
    ok, note = p.check()
    assert not ok and "application-default login" in note


def test_health_names_the_cloud_backend(env, tmp_path):
    from fastapi.testclient import TestClient

    import app.gemini as gemini
    from app.main import app

    env.setenv("GOOGLE_GENAI_USE_ENTERPRISE", "true")
    env.setenv("GOOGLE_CLOUD_PROJECT", "my-proj")
    env.setattr(gemini, "make_client", lambda settings, http_options=None: SimpleNamespace(
        models=FakeModels({"gemini-3.8-flash"})))
    with TestClient(app) as c:
        h = c.get("/api/health").json()
    assert h["mode"] == "live" and h["backend"] == "cloud" and "Google Cloud" in h["backend_label"]
    assert h["model"] == "gemini-3.8-flash"


def test_health_names_the_key_backend(env, tmp_path):
    from fastapi.testclient import TestClient

    import app.gemini as gemini
    from app.main import app

    env.setenv("GEMINI_API_KEY", "k-123")
    env.setattr(gemini, "make_client", lambda settings, http_options=None: SimpleNamespace(
        models=FakeModels({"gemini-3.8-flash"})))
    with TestClient(app) as c:
        h = c.get("/api/health").json()
    assert h["backend"] == "api_key" and h["backend_label"] == "Gemini API with an API key"
