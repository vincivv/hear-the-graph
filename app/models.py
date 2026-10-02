"""Data model (SPEC section 9) and the shapes of the Gemini readings.

Two groups of models live here:
- Readings: what Gemini (or the fixture provider) returns. Validated strictly.
- Records: what the API serves to the browser.
"""

from __future__ import annotations

import time
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

# ---------------------------------------------------------------------------
# Readings (model output). Coordinates are normalized to 0-1000, [y, x] order,
# which is Gemini's native convention for spatial understanding.
# ---------------------------------------------------------------------------


class DetectedChart(BaseModel):
    box_2d: list[float] = Field(min_length=4, max_length=4)
    chart_type: str = "other"
    title: str = ""


class DetectionResult(BaseModel):
    charts: list[DetectedChart] = Field(default_factory=list)


class RawPoint(BaseModel):
    x_label: str = ""
    x_value: float
    y: float


class RawSeries(BaseModel):
    name: str = ""
    color_hex: str = ""
    points: list[RawPoint] = Field(default_factory=list)


class RawAxis(BaseModel):
    label: str = ""
    unit: str = ""
    scale: Literal["linear", "log", "category"] = "linear"
    min: float = 0.0
    max: float = 1.0
    tick_labels: list[str] = Field(default_factory=list)

    @field_validator("scale", mode="before")
    @classmethod
    def _norm_scale(cls, v):
        v = str(v or "linear").lower()
        if v.startswith("log"):
            return "log"
        if v.startswith("cat"):
            return "category"
        return "linear"


class ChartReading(BaseModel):
    """First reading: Gemini reads values directly (structured output)."""

    is_chart: bool = True
    chart_type: str = "line"
    title: str = ""
    x_axis: RawAxis
    y_axis: RawAxis
    has_point_markers: bool = False
    series: list[RawSeries] = Field(default_factory=list)


class GeoTick(BaseModel):
    label: str
    position: list[float] = Field(min_length=2, max_length=2)  # [y, x]


class GeoPoint(BaseModel):
    x_label: str = ""
    position: list[float] = Field(min_length=2, max_length=2)  # [y, x]


class GeoSeries(BaseModel):
    name: str = ""
    points: list[GeoPoint] = Field(default_factory=list)


class GeometryReading(BaseModel):
    """Second reading: pixel positions only. Code converts them to values."""

    plot_area: list[float] = Field(min_length=4, max_length=4)  # [ymin, xmin, ymax, xmax]
    x_ticks: list[GeoTick] = Field(default_factory=list)
    y_ticks: list[GeoTick] = Field(default_factory=list)
    series: list[GeoSeries] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Records served by the API
# ---------------------------------------------------------------------------

Level = Literal["high", "medium", "low"]


class Step(BaseModel):
    key: str
    label: str
    status: Literal["pending", "running", "done", "failed", "skipped"] = "pending"
    detail: str = ""


class Axis(BaseModel):
    label: str = ""
    unit: str = ""
    min: float = 0.0
    max: float = 1.0
    scale: Literal["linear", "log", "category"] = "linear"
    tick_count: int = 0
    categories: list[str] = Field(default_factory=list)


class Point(BaseModel):
    x: float
    x_label: str
    y: float
    pixel: Optional[list[float]] = None  # [x, y] in chart image pixels
    confidence: float = 1.0
    flags: list[str] = Field(default_factory=list)
    checks: dict = Field(default_factory=dict)


class Series(BaseModel):
    name: str
    color: str = ""
    points: list[Point]


class RiskFactor(BaseModel):
    code: str
    text: str
    weight: float


class Region(BaseModel):
    series: str
    start_index: int
    end_index: int
    text: str


class Confidence(BaseModel):
    level: Level = "high"
    score: float = 1.0
    message: str = ""
    reasons: list[str] = Field(default_factory=list)
    uncertain_regions: list[Region] = Field(default_factory=list)
    risk_factors: list[RiskFactor] = Field(default_factory=list)
    signals: dict = Field(default_factory=dict)


class Chart(BaseModel):
    id: str
    document_id: str
    index: int = 0
    page: int = 1
    bbox: list[float] = Field(default_factory=list)  # [x0, y0, x1, y1] in page pixels
    image_size: list[int] = Field(default_factory=list)  # [w, h]
    status: Literal["ok", "failed"] = "ok"
    error: str = ""
    # Gemini was busy for this chart (not read, or the second reading skipped), so reading it again may help.
    retryable: bool = False
    chart_type: str = "line"
    title: str = ""
    x_axis: Axis = Field(default_factory=Axis)
    y_axis: Axis = Field(default_factory=Axis)
    has_markers: bool = False
    series: list[Series] = Field(default_factory=list)
    confidence: Confidence = Field(default_factory=Confidence)
    summary: dict = Field(default_factory=dict)
    source: Literal["live", "cache", "fixture"] = "live"
    source_note: str = ""
    model: str = ""
    backend: str = ""  # "api_key" or "cloud" for live and cached readings
    timings: dict = Field(default_factory=dict)  # seconds: read_s, second_s, readings_wall_s, total_s
    plot_area: list[float] = Field(default_factory=list)  # [x0, y0, x1, y1] pixels
    straightened: Optional[dict] = None


class Document(BaseModel):
    id: str
    filename: str
    kind: Literal["pdf", "image"]
    status: Literal["queued", "processing", "done", "failed"] = "queued"
    error: str = ""
    pages: int = 0
    steps: list[Step] = Field(default_factory=list)
    chart_ids: list[str] = Field(default_factory=list)
    created: float = Field(default_factory=time.time)
    is_sample: bool = False
    mode: str = "fixture"


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    series: Optional[str] = None


class Answer(BaseModel):
    question: str
    answer: str
    operation: str
    arguments: dict = Field(default_factory=dict)
    values: list[dict] = Field(default_factory=list)
    confidence: Level = "high"
    confidence_note: str = ""
    answerable: bool = True
    chooser: Literal["gemini", "rules"] = "rules"
    chooser_note: str = ""
