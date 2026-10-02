"""Configuration from environment variables (see .env.example and SPEC section 15)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

# Bump when any Gemini prompt or response schema changes; it is part of the cache key.
PROMPT_VERSION = "2026-10-02.1"

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_PDF_PAGES = 40

# Built-in samples: name -> (file in web/samples, label shown in the UI)
SAMPLES: dict[str, tuple[str, str]] = {
    "lecture": ("sample_lecture.pdf", "Sample lecture, 6 slides with 4 charts"),
    "clean-line": ("reaction_rate.png", "Clean line chart: reaction rate"),
    "two-lines": ("graduation_rates.png", "Two lines: graduation rate by program"),
    "bars": ("rainfall.png", "Bar chart: rainfall this week"),
    "sparse-ticks": ("signal_strength.png", "Hard case: no markers and few tick labels"),
    "phone-photo": ("phone_photo.png", "Hard case: tilted phone photo of a slide"),
}


DEFAULT_FALLBACKS = "gemini-flash-latest,gemini-flash-lite-latest"


def _truthy(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes")


@dataclass
class Settings:
    gemini_api_key: str = ""
    # "api_key": the Gemini Developer API with GEMINI_API_KEY.
    # "cloud": Gemini on Google Cloud (Vertex AI) with Application Default Credentials,
    # chosen by GOOGLE_GENAI_USE_ENTERPRISE=true (or the legacy GOOGLE_GENAI_USE_VERTEXAI=true).
    backend: str = "api_key"
    google_cloud_project: str = ""
    google_cloud_location: str = ""
    gemini_model: str = "gemini-3.8-flash"
    # Comma-separated, tried in order when a model is unknown, overloaded or over its quota.
    gemini_fallback_model: str = DEFAULT_FALLBACKS
    app_mode: str = "fixture"
    session_ttl_minutes: int = 60
    data_dir: Path = field(default_factory=lambda: ROOT / ".data")
    port: int = 8000

    @property
    def has_credentials(self) -> bool:
        if self.backend == "cloud":
            return bool(self.google_cloud_project)
        return bool(self.gemini_api_key)

    @property
    def backend_label(self) -> str:
        if self.backend == "cloud":
            return f"Gemini on Google Cloud (project {self.google_cloud_project}, location {self.google_cloud_location})"
        return "Gemini API with an API key"

    @property
    def model_chain(self) -> list[str]:
        """The configured model first, then each fallback, without duplicates."""
        out: list[str] = []
        for m in [self.gemini_model, *self.gemini_fallback_model.split(",")]:
            m = m.strip()
            if m and m not in out:
                out.append(m)
        return out

    @property
    def seed_cache_dirs(self) -> list[Path]:
        """Saved live readings shipped with the app (the built-in samples), read-only."""
        raw = os.getenv("SEED_CACHE_DIRS")
        if raw is not None:
            return [Path(p) if Path(p).is_absolute() else ROOT / p for p in raw.split(",") if p.strip()]
        d = ROOT / "app" / "demo_cache"
        return [d] if d.exists() else []

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"

    @property
    def sessions_dir(self) -> Path:
        return self.data_dir / "sessions"


def load_settings() -> Settings:
    key = os.getenv("GEMINI_API_KEY", "").strip()
    cloud = _truthy("GOOGLE_GENAI_USE_ENTERPRISE") or (
        not os.getenv("GOOGLE_GENAI_USE_ENTERPRISE", "").strip() and _truthy("GOOGLE_GENAI_USE_VERTEXAI")
    )
    settings = Settings(
        gemini_api_key=key,
        backend="cloud" if cloud else "api_key",
        google_cloud_project=os.getenv("GOOGLE_CLOUD_PROJECT", "").strip() if cloud else "",
        google_cloud_location=(os.getenv("GOOGLE_CLOUD_LOCATION", "").strip() or "global") if cloud else "",
    )
    mode = os.getenv("APP_MODE", "").strip().lower()
    if mode not in ("live", "fixture"):
        mode = "live" if settings.has_credentials else "fixture"
    if mode == "live" and not settings.has_credentials:
        mode = "fixture"
    data_dir = Path(os.getenv("DATA_DIR", "./.data"))
    if not data_dir.is_absolute():
        data_dir = ROOT / data_dir
    settings.gemini_model = os.getenv("GEMINI_MODEL", "").strip() or "gemini-3.8-flash"
    settings.gemini_fallback_model = os.getenv("GEMINI_FALLBACK_MODEL", "").strip() or DEFAULT_FALLBACKS
    settings.app_mode = mode
    settings.session_ttl_minutes = int(os.getenv("SESSION_TTL_MINUTES", "60") or 60)
    settings.data_dir = data_dir
    settings.port = int(os.getenv("PORT", "8000") or 8000)
    return settings
