"""Gemini client: chart detection, two independent readings, and operation choice.

Every call goes through `_generate`, which
- caches the raw response on disk by image hash, task, model and prompt version,
- validates the JSON against a Pydantic model plus a semantic check,
- retries once on empty or malformed output, then raises ReadingFailed,
- falls back to GEMINI_FALLBACK_MODEL if the configured model id is not found.

The answer keys in test_data are never read here.
"""

from __future__ import annotations

import hashlib
import json
import re
import logging
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from pydantic import BaseModel, ValidationError

from .config import PROMPT_VERSION, Settings
from .models import ChartReading, DetectionResult, GeometryReading

log = logging.getLogger("hear.gemini")


class ReadingFailed(Exception):
    """The model output was empty or invalid twice in a row, or the call failed.

    busy is True when Gemini was overloaded or rate limited even after backing off,
    so the message to the student is "try again", not "this chart cannot be read".
    reason says which: "overloaded" (503 and similar), "quota" (429, per-minute limit)
    or "quota_daily" (429, the key's daily limit for the model).
    """

    def __init__(self, message: str = "", busy: bool = False, reason: str = ""):
        super().__init__(message)
        self.busy = busy
        self.reason = reason or ("overloaded" if busy else "")


def busy_reason(e) -> str:
    """Why a transient API error happened, in the terms the student message uses."""
    if getattr(e, "code", None) != 429:
        return "overloaded"
    text = str(e).lower()
    return "quota_daily" if ("perday" in text or "per day" in text or "daily" in text) else "quota"


# Overloaded, rate limited or temporarily failing.
TRANSIENT_CODES = (408, 429, 500, 502, 503, 504)
# The SDK backs off and retries these. Not 429: a daily quota cannot recover by waiting
# 30 seconds, and a per-minute quota says how long to wait, so 429 is handled in _call.
SDK_RETRY_CODES = (408, 500, 502, 503, 504)

# After a model stays busy, later calls skip it for a while and go straight to the next
# model in the chain. A model over its daily quota is not tried again during its cooldown.
COOLDOWN_SECONDS = {"overloaded": 60.0, "quota": 60.0, "quota_daily": 3600.0}
MAX_QUOTA_WAIT = 65.0  # longest wait for a per-minute quota when no other model is ready


def retry_delay(e) -> float | None:
    """Seconds the API asks to wait (RetryInfo.retryDelay on a 429), if it says."""
    m = re.search(r"retryDelay['\"]?\s*[:=]\s*['\"]?(\d+(?:\.\d+)?)s", str(getattr(e, "details", "")) + str(e))
    return float(m.group(1)) if m else None


@dataclass
class CallMeta:
    source: str  # "live" or "cache"
    model: str
    created: float
    attempts: int = 1
    seconds: float = 0.0  # wall time of the live request(s), including SDK backoff; for a cache hit, as first measured
    backend: str = ""  # "api_key" or "cloud"; empty for entries saved before this was recorded


# ---------------------------------------------------------------------------
# Prompts. Kept short and free of JSON examples: the response schema already
# defines the shape, and duplicating it in the prompt lowers quality.
# ---------------------------------------------------------------------------

DETECT_PROMPT = """Find every chart or graph in this slide image: line charts, bar charts,
scatter plots and other data plots. Ignore photos, tables, logos, flow diagrams and decoration.
For each chart give box_2d as [ymin, xmin, ymax, xmax] normalized to 0-1000, covering the whole
chart including its title, axis labels, tick labels and legend. Give chart_type as one of
line, bar, scatter, other, and the chart title exactly as printed (empty string if none).
If the image has no chart, return an empty list."""

READ_PROMPT = """Read this chart for a blind student who needs exact values.
- chart_type: line, bar, scatter or other. is_chart is false if the image is not a data chart.
- title: as printed, or empty.
- For each axis: label and unit as printed; scale is linear, log, or category (category for
  text labels such as names, days, or years used as bar categories); min and max are the axis
  values at the edges of the plot area; tick_labels lists every tick label printed on that axis,
  in order, exactly as printed.
- has_point_markers: true only if individual data points are drawn as visible markers
  (dots, squares, triangles) or as separate bars.
- series: one entry per series, named as in the legend (or by the y axis label if there is no
  legend), with color_hex of the drawn line or bars.
- points: every data point in order of increasing x. For a line, a point is each vertex where
  the line changes direction, or each marker. For bars, one point per bar.
  x_value is the numeric x value; on a category axis use the 0-based category index and put the
  category text in x_label. For numeric axes also write the x value as text in x_label.
  y is the value in data units. On a log axis give the real value, not its logarithm.
Read values as precisely as the gridlines and tick labels allow. Do not round to tick values."""

GEOMETRY_PROMPT = """Do not read any data values. Report only positions in the image.
All coordinates are normalized to 0-1000 relative to the full image, as [y, x] for points
and [ymin, xmin, ymax, xmax] for boxes.
- plot_area: the rectangle inside the axes where the data is drawn.
- x_ticks: each labeled tick on the x axis. label is the tick text exactly as printed; position
  is where the tick mark meets the axis line.
- y_ticks: the same for the y axis.
- series: one entry per series, in legend order. For each data point, position is the center of
  the marker or the line vertex; for a bar, the center of the bar's top edge (bottom edge for a
  bar below zero). x_label is the nearest x tick label or the bar's category.
List points in order of increasing x."""

QA_SYSTEM = """You help a blind student ask questions about one chart. You never state numbers
yourself. Pick exactly one function that answers the question, with arguments taken from the
chart description. Use x values exactly as listed for the chart. If no function can answer the
question from this chart's data, call cannot_answer with a short reason."""


def _axis_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "label": {"type": "string"},
            "unit": {"type": "string"},
            "scale": {"type": "string", "enum": ["linear", "log", "category"]},
            "min": {"type": "number"},
            "max": {"type": "number"},
            "tick_labels": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["label", "unit", "scale", "min", "max", "tick_labels"],
    }


DETECT_SCHEMA = {
    "type": "object",
    "properties": {
        "charts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "box_2d": {"type": "array", "items": {"type": "number"}, "minItems": 4, "maxItems": 4},
                    "chart_type": {"type": "string", "enum": ["line", "bar", "scatter", "other"]},
                    "title": {"type": "string"},
                },
                "required": ["box_2d", "chart_type", "title"],
            },
        }
    },
    "required": ["charts"],
}

READ_SCHEMA = {
    "type": "object",
    "properties": {
        "is_chart": {"type": "boolean"},
        "chart_type": {"type": "string", "enum": ["line", "bar", "scatter", "other"]},
        "title": {"type": "string"},
        "x_axis": _axis_schema(),
        "y_axis": _axis_schema(),
        "has_point_markers": {"type": "boolean"},
        "series": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "color_hex": {"type": "string"},
                    "points": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "x_label": {"type": "string"},
                                "x_value": {"type": "number"},
                                "y": {"type": "number"},
                            },
                            "required": ["x_label", "x_value", "y"],
                        },
                    },
                },
                "required": ["name", "color_hex", "points"],
            },
        },
    },
    "required": ["is_chart", "chart_type", "title", "x_axis", "y_axis", "has_point_markers", "series"],
}

_POS = {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}
_TICKS = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {"label": {"type": "string"}, "position": _POS},
        "required": ["label", "position"],
    },
}
GEOMETRY_SCHEMA = {
    "type": "object",
    "properties": {
        "plot_area": {"type": "array", "items": {"type": "number"}, "minItems": 4, "maxItems": 4},
        "x_ticks": _TICKS,
        "y_ticks": _TICKS,
        "series": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "points": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"x_label": {"type": "string"}, "position": _POS},
                            "required": ["x_label", "position"],
                        },
                    },
                },
                "required": ["name", "points"],
            },
        },
    },
    "required": ["plot_area", "x_ticks", "y_ticks", "series"],
}


# ---------------------------------------------------------------------------
# Semantic validation (beyond the schema)
# ---------------------------------------------------------------------------


def check_detection(d: DetectionResult) -> None:
    for c in d.charts:
        y0, x0, y1, x1 = c.box_2d
        if not (0 <= y0 < y1 <= 1000 and 0 <= x0 < x1 <= 1000):
            raise ValueError(f"bad box {c.box_2d}")


def check_reading(r: ChartReading) -> None:
    if not r.is_chart:
        return
    if not r.series:
        raise ValueError("no series")
    if not any(len(s.points) >= 2 for s in r.series):
        raise ValueError("fewer than two points")
    if len(r.series) > 12 or any(len(s.points) > 400 for s in r.series):
        raise ValueError("implausible number of series or points")


def check_geometry(g: GeometryReading) -> None:
    y0, x0, y1, x1 = g.plot_area
    if not (y1 > y0 and x1 > x0):
        raise ValueError("empty plot area")
    if not g.series or not any(s.points for s in g.series):
        raise ValueError("no point positions")


# ---------------------------------------------------------------------------
# Disk cache
# ---------------------------------------------------------------------------


class ResponseCache:
    """JSON responses keyed by image hash + task + model + prompt version.

    Samples go to cache/samples (kept); uploads go to cache/uploads and are
    removed with their document or after the session TTL.
    """

    def __init__(self, root: Path, seed_dirs: list[Path] | tuple = ()):
        self.root = root
        # Read-only saved live readings (the built-in samples' demo cache, or the eval's live cache),
        # looked up by image and task whatever model was configured when they were saved.
        self.seed_dirs = [Path(d) for d in seed_dirs]
        self._seed: dict | None = None

    def _seed_index(self) -> dict:
        if self._seed is None:
            entries = []
            for d in self.seed_dirs:
                for p in sorted(d.glob("**/*.json")):
                    try:
                        entries.append((p.stem, json.loads(p.read_text())))
                    except (json.JSONDecodeError, OSError):
                        continue
            models = {e.get("model", "") for _, e in entries}
            idx: dict = {}
            for stem, e in entries:
                h, task = e.get("content_hash"), e.get("task")
                if not h or not task:
                    continue
                # Only entries saved with the current prompts: the file name is the key of one of the
                # models these entries were read with.
                if e.get("prompt_version") != PROMPT_VERSION and not any(self.key(task, m, h) == stem for m in models):
                    continue
                if (h, task) not in idx or e.get("created", 0) > idx[(h, task)].get("created", 0):
                    idx[(h, task)] = {**e, "_file": stem}
            self._seed = idx
        return self._seed

    def get_seed(self, content_hash: str, task: str) -> dict | None:
        return self._seed_index().get((content_hash, task)) if self.seed_dirs else None

    def _path(self, bucket: str, key: str) -> Path:
        return self.root / bucket / f"{key}.json"

    @staticmethod
    def key(task: str, model: str, content_hash: str, extra: str = "") -> str:
        raw = f"{PROMPT_VERSION}|{task}|{model}|{content_hash}|{extra}"
        return hashlib.sha256(raw.encode()).hexdigest()[:40]

    def get(self, bucket: str, key: str) -> dict | None:
        for b in (bucket, "samples", "uploads"):
            p = self._path(b, key)
            if p.exists():
                try:
                    return json.loads(p.read_text())
                except json.JSONDecodeError:
                    p.unlink(missing_ok=True)
        return None

    def put(self, bucket: str, key: str, value: dict, content_hash: str) -> None:
        p = self._path(bucket, key)
        p.parent.mkdir(parents=True, exist_ok=True)
        value = {**value, "content_hash": content_hash, "prompt_version": PROMPT_VERSION}
        p.write_text(json.dumps(value))

    def delete_for_hashes(self, hashes: set[str]) -> int:
        n = 0
        d = self.root / "uploads"
        if not d.exists():
            return 0
        for p in d.glob("*.json"):
            try:
                if json.loads(p.read_text()).get("content_hash") in hashes:
                    p.unlink()
                    n += 1
            except (json.JSONDecodeError, OSError):
                continue
        return n

    def sweep_uploads(self, ttl_seconds: float) -> None:
        d = self.root / "uploads"
        if not d.exists():
            return
        now = time.time()
        for p in d.glob("*.json"):
            if now - p.stat().st_mtime > ttl_seconds:
                p.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


def make_client(settings: Settings, http_options=None):
    """A google-genai client for the configured backend.

    API key: the Gemini Developer API, exactly as before. Google Cloud: the same SDK
    with enterprise=True, a project and a location; credentials come from Application
    Default Credentials (the Cloud Run service account, or `gcloud auth
    application-default login` on a laptop). No key is sent on that path.
    """
    from google import genai

    if settings.backend == "cloud":
        return genai.Client(
            enterprise=True,
            project=settings.google_cloud_project,
            location=settings.google_cloud_location,
            http_options=http_options,
        )
    return genai.Client(api_key=settings.gemini_api_key, http_options=http_options)


class GeminiProvider:
    name = "gemini"

    def __init__(self, settings: Settings, cache: ResponseCache):
        from google import genai  # imported lazily so fixture mode works without network

        self.settings = settings
        self.cache = cache
        from google.genai import types

        # Back off and retry when Gemini is overloaded (503) or rate limited (429):
        # waits of about 2, 4, 8 and 16 seconds with jitter, then the next model is tried.
        http_options = types.HttpOptions(
            timeout=180_000,
            retry_options=types.HttpRetryOptions(
                attempts=5, initial_delay=2.0, max_delay=30.0, http_status_codes=list(SDK_RETRY_CODES)
            ),
        )
        self.client = make_client(settings, http_options)
        self.backend = settings.backend
        self.backend_label = settings.backend_label
        self.chain = settings.model_chain
        self.model = self.chain[0]
        self._model_lock = threading.Lock()
        self._missing: set[str] = set()
        self._cool_until: dict[str, float] = {}
        self._cool_reason: dict[str, str] = {}
        self.model_note = ""

    # -- model chain -----------------------------------------------------------
    def _mark_missing(self, model: str) -> None:
        with self._model_lock:
            self._missing.add(model)
            usable = [m for m in self.chain if m not in self._missing]
            if usable and self.model == model:
                log.warning("model %s not found, using %s", model, usable[0])
                self.model = usable[0]
                self.model_note = f"Model {self.settings.gemini_model} was not found; using {self.model} instead."

    def _cool_down(self, model: str, reason: str, seconds: float | None = None) -> None:
        with self._model_lock:
            self._cool_until[model] = time.monotonic() + (seconds or COOLDOWN_SECONDS.get(reason, 60.0))
            self._cool_reason[model] = reason

    def _models_to_try(self) -> list[str]:
        """Usable models in order: ready ones first, then those cooling down, soonest ready first.

        A model over its daily quota is left out while it cools down: asking it again only
        returns the same 429.
        """
        now = time.monotonic()
        with self._model_lock:
            usable = [m for m in self.chain if m not in self._missing]
            ready = [m for m in usable if self._cool_until.get(m, 0.0) <= now]
            cooling = sorted((m for m in usable if m not in ready and self._cool_reason.get(m) != "quota_daily"),
                             key=lambda m: self._cool_until.get(m, 0.0))
            return ready + cooling

    def _wait_for_quota(self, model: str) -> None:
        """Before retrying a model over its per-minute quota, wait out what the API asked for."""
        with self._model_lock:
            left = self._cool_until.get(model, 0.0) - time.monotonic()
            reason = self._cool_reason.get(model)
        if reason == "quota" and 0 < left <= MAX_QUOTA_WAIT:
            log.info("all models busy; waiting %.0f s for %s's per-minute quota", left, model)
            time.sleep(left)

    # -- health ---------------------------------------------------------------
    def check(self) -> tuple[bool, str]:
        """Cheap calls that prove the key works and find which configured model ids exist."""
        from google.genai import errors

        found = []
        for model in self.chain:
            try:
                self.client.models.get(model=model)
                found.append(model)
            except errors.APIError as e:
                if e.code == 404:
                    self._missing.add(model)
                    continue
                if self.backend == "cloud":
                    return False, (f"Google Cloud rejected the request ({e.code} {e.status}). Check that the Vertex AI API "
                                   "is enabled and the service account has the Vertex AI User role.")
                return False, f"Gemini rejected the key or request ({e.code} {e.status})."
            except Exception as e:  # network errors, or no Google Cloud credentials on this machine
                if self.backend == "cloud" and "Credentials" in type(e).__name__:
                    return False, ("No Google Cloud credentials were found. On a laptop run "
                                   "`gcloud auth application-default login`; on Cloud Run attach a service account.")
                return False, f"Could not reach Gemini: {type(e).__name__}."
        if not found:
            return False, "None of the configured models were found (GEMINI_MODEL, GEMINI_FALLBACK_MODEL)."
        with self._model_lock:
            self.model = found[0]
        log.info("models available: %s", ", ".join(found))
        if found[0] != self.settings.gemini_model:
            self.model_note = f"Model {self.settings.gemini_model} was not found; using {found[0]} instead."
        return True, self.model_note

    # -- core call -----------------------------------------------------------
    def _call(self, contents: list, config) -> tuple[Any, str]:
        """One request. Returns (response, model that answered).

        Models are tried in chain order. A model id the API does not know is dropped
        for the session. A model that is still overloaded or over quota after the SDK's
        backoff is skipped for a while, and this call moves on to the next model.
        """
        from google.genai import errors

        last: Exception | None = None
        now = time.monotonic()
        for model in self._models_to_try():
            if self._cool_until.get(model, 0.0) > now:
                self._wait_for_quota(model)
            try:
                return self.client.models.generate_content(model=model, contents=contents, config=config), model
            except errors.APIError as e:
                if e.code == 404:
                    self._mark_missing(model)
                elif e.code in TRANSIENT_CODES:
                    reason = busy_reason(e)
                    log.warning("model %s busy (%s, %s); trying the next model", model, e.code, reason)
                    self._cool_down(model, reason, retry_delay(e) if reason == "quota" else None)
                else:
                    raise
                last = e
        if last is None:
            if any(r == "quota_daily" for r in self._cool_reason.values()):
                raise ReadingFailed("Every model is over its daily quota.", busy=True, reason="quota_daily")
            raise ReadingFailed("No configured Gemini model is available.")
        raise last

    def _generate(
        self,
        task: str,
        image: bytes,
        content_hash: str,
        prompt: str,
        schema: dict,
        model_cls: type[BaseModel],
        check: Callable[[Any], None],
        bucket: str,
    ) -> tuple[Any, CallMeta]:
        from google.genai import errors, types

        key = self.cache.key(task, self.model, content_hash)
        hit = self.cache.get(bucket, key) or self.cache.get_seed(content_hash, task)
        if hit is not None:
            try:
                obj = model_cls.model_validate(hit["response"])
                check(obj)
                return obj, CallMeta("cache", hit.get("model", self.model), hit.get("created", 0.0),
                                     seconds=hit.get("seconds", 0.0), backend=hit.get("backend", ""))
            except (ValidationError, ValueError, KeyError):
                pass  # stale or bad entry: read again

        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_json_schema=schema,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )
        last_err = ""
        busy = False
        reason = ""
        t0 = time.monotonic()
        for attempt in (1, 2):
            text_prompt = prompt
            if attempt == 2:
                text_prompt += (
                    "\n\nYour previous answer was empty or did not match the schema "
                    f"({last_err[:200]}). Answer again with valid JSON only."
                )
            contents = [types.Part.from_bytes(data=image, mime_type="image/png"), text_prompt]
            try:
                resp, used_model = self._call(contents, config)
                raw = (resp.text or "").strip()
                if not raw:
                    raise ValueError("empty response")
                data = json.loads(raw)
                obj = model_cls.model_validate(data)
                check(obj)
            except (json.JSONDecodeError, ValidationError, ValueError) as e:
                last_err = f"{type(e).__name__}: {e}"
                log.warning("%s attempt %d invalid: %s", task, attempt, last_err[:300])
                continue
            except errors.APIError as e:
                last_err = f"API error {e.code} {e.status}"
                log.warning("%s attempt %d API error: %s", task, attempt, str(e)[:200])
                if e.code in TRANSIENT_CODES:
                    busy, reason = True, busy_reason(e)  # every model already backed off; asking again now would not help
                    break
                if e.code in (400, 401, 403):
                    break
                continue
            except ReadingFailed:
                raise  # every model is unavailable: asking again now would not help
            except Exception as e:  # network
                last_err = f"{type(e).__name__}: {e}"
                log.warning("%s attempt %d failed: %s", task, attempt, last_err)
                continue
            now = time.time()
            took = round(time.monotonic() - t0, 2)
            self.cache.put(bucket, key, {"response": obj.model_dump(), "model": used_model, "created": now, "task": task,
                                         "seconds": took, "backend": self.backend}, content_hash)
            return obj, CallMeta("live", used_model, now, attempt, took, self.backend)
        raise ReadingFailed(last_err or "no valid response", busy=busy, reason=reason)

    # -- tasks ---------------------------------------------------------------
    def detect(self, img, bucket: str):
        return self._generate("detect", img.png, img.sha, DETECT_PROMPT, DETECT_SCHEMA, DetectionResult, check_detection, bucket)

    def read_values(self, img, bucket: str):
        return self._generate("read", img.png, img.sha, READ_PROMPT, READ_SCHEMA, ChartReading, check_reading, bucket)

    def read_geometry(self, img, bucket: str):
        return self._generate("geometry", img.png, img.sha, GEOMETRY_PROMPT, GEOMETRY_SCHEMA, GeometryReading, check_geometry, bucket)

    def choose_operation(self, question: str, context: str, declarations: list[dict], content_hash: str, bucket: str):
        """Function calling: the model picks one operation and its arguments."""
        from google.genai import types

        key = self.cache.key("qa", self.model, content_hash, question.strip().lower())
        hit = self.cache.get(bucket, key)
        if hit is not None:
            return hit["response"]["name"], hit["response"]["args"], CallMeta(
                "cache", hit.get("model", ""), hit.get("created", 0), seconds=hit.get("seconds", 0.0), backend=hit.get("backend", ""))

        tool = types.Tool(
            function_declarations=[
                types.FunctionDeclaration(name=d["name"], description=d["description"], parameters_json_schema=d["parameters"])
                for d in declarations
            ]
        )
        config = types.GenerateContentConfig(
            system_instruction=QA_SYSTEM,
            tools=[tool],
            tool_config=types.ToolConfig(function_calling_config=types.FunctionCallingConfig(mode="ANY")),
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )
        contents = f"Chart description:\n{context}\n\nStudent question: {question}"
        from google.genai import errors

        last = ""
        t0 = time.monotonic()
        for _ in (1, 2):
            try:
                resp, used_model = self._call([contents], config)
                calls = resp.function_calls or []
                if calls:
                    name = calls[0].name
                    args = dict(calls[0].args or {})
                    now = time.time()
                    took = round(time.monotonic() - t0, 2)
                    self.cache.put(bucket, key, {"response": {"name": name, "args": args}, "model": used_model, "created": now,
                                                 "seconds": took, "backend": self.backend}, content_hash)
                    return name, args, CallMeta("live", used_model, now, seconds=took, backend=self.backend)
                last = "no function call"
            except errors.APIError as e:
                last = f"API error {e.code} {e.status}"
                log.warning("qa failed: %s", last)
                if e.code in TRANSIENT_CODES:
                    raise ReadingFailed(last, busy=True, reason=busy_reason(e)) from e
            except ReadingFailed:
                raise
            except Exception as e:
                last = f"{type(e).__name__}: {e}"
                log.warning("qa failed: %s", last)
        raise ReadingFailed(last)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
