"""The trust layer on real test images, with the first reading perturbed the way
Gemini was measured to fail. The geometry reading and the image are untouched,
so the cross-check and the pixel check must find the bad values on their own."""

import copy
import json
from pathlib import Path

import pytest
from PIL import Image

from app.models import Chart, ChartReading, GeometryReading
from app.pipeline import trust
from app.pipeline.confidence import UNCERTAIN
from app.pipeline.extract import normalize

ROOT = Path(__file__).resolve().parent.parent
FIX = {e["name"]: e for e in json.loads((ROOT / "app/fixtures/fixtures.json").read_text())["charts"]}


def run(name, mutate=None, drop_geometry=False):
    e = FIX[name]
    reading = copy.deepcopy(e["reading"])
    if mutate:
        mutate(reading)
    reading = ChartReading.model_validate(reading)
    geometry = None if drop_geometry else GeometryReading.model_validate(e["geometry"])
    im = Image.open(ROOT / e["file"]).convert("RGB")
    kind, xa, ya, series, notes = normalize(reading)
    chart = Chart(id="c", document_id="d", chart_type=kind, x_axis=xa, y_axis=ya, series=series,
                  has_markers=reading.has_point_markers, image_size=[im.width, im.height])
    a = trust.assess(chart, reading, geometry, im, notes, "failed" if drop_geometry else "")
    return chart, a


CLEAN = ["01_line_rising", "02_line_peak", "03_line_decay", "04_line_negative", "05_line_two_series",
         "06_line_dense", "07_bar_simple", "08_bar_decimal", "09_bar_negative", "10_bar_offset_axis"]


@pytest.mark.parametrize("name", CLEAN)
def test_clean_charts_are_high(name):
    chart, _ = run(name)
    assert chart.confidence.level == "high", chart.confidence.reasons
    assert all(p.confidence >= UNCERTAIN for s in chart.series for p in s.points)


@pytest.mark.parametrize("name", ["h02a_lowres", "h02b_jpeg_blur", "h05b_jpeg_blur", "h06b_jpeg_blur", "hs2_grouped_bars",
                                  "hs3_log_scale", "hs4_hand_drawn", "hs5_three_similar"])
def test_measured_good_cases_are_not_flagged(name):
    chart, _ = run(name)
    assert chart.confidence.level == "high", chart.confidence.reasons


def test_sparse_ticks_without_markers_is_flagged_but_not_drowned():
    # Structural risks alone lower the chart to medium; with every check passing, no point is uncertain.
    chart, _ = run("hs1_sparse_ticks")
    codes = {r.code for r in chart.confidence.risk_factors}
    assert {"no_markers", "few_ticks_x", "few_ticks_y", "unanchored"} <= codes
    assert chart.confidence.level == "medium"
    assert chart.confidence.reasons[0].startswith("Every point passed its checks, but")
    assert chart.confidence.uncertain_regions == []
    assert not any("uncertain" in p.flags for p in chart.series[0].points)


@pytest.mark.parametrize("name", ["h02c_phone_photo", "h05c_phone_photo", "h06c_phone_photo", "h08c_phone_photo"])
def test_tilted_photos_are_flagged(name):
    chart, a = run(name)
    assert a.tilted
    assert chart.confidence.level == "low"
    assert any("angle" in r for r in chart.confidence.reasons)


def test_hs1_style_x_shift_near_peak_is_localized():
    # Measured failure: points shifted along x near the peak. Shift values at x=3..8 one step right.
    def mutate(r):
        pts = r["series"][0]["points"]
        ys = [p["y"] for p in pts]
        for i in range(3, 9):
            pts[i]["y"] = ys[i - 1]
    chart, _ = run("hs1_sparse_ticks", mutate)
    pts = chart.series[0].points
    bad = {i for i, p in enumerate(pts) if {"crosscheck_disagree", "pixel_off", "pixel_near"} & set(p.flags)}
    assert bad and bad <= set(range(2, 10)), bad
    assert any("disagree" in r for r in chart.confidence.reasons)


def test_h05c_style_growing_error_and_value_above_axis():
    # Measured failure on the tilted photo: error grows left to right; 72.4 on an axis that tops out at 70.
    def mutate(r):
        for s in r["series"]:
            n = len(s["points"])
            for i, p in enumerate(s["points"]):
                p["y"] += 2.6 * i / (n - 1)
        r["series"][0]["points"][-1]["y"] = 72.4
    chart, _ = run("05_line_two_series", mutate)
    assert chart.confidence.level == "low"
    last = chart.series[0].points[-1]
    assert "out_of_range" in last.flags and "uncertain" in last.flags
    assert any("outside the axis range" in r for r in chart.confidence.reasons)
    # Early points, where the error is small, keep higher confidence than late ones.
    a = chart.series[0].points
    assert a[0].confidence > a[-2].confidence


def test_local_misreading_becomes_an_uncertain_region():
    def mutate(r):
        for i in (5, 6, 7):
            r["series"][0]["points"][i]["y"] += 4.0  # about 10% of the axis
    chart, _ = run("02_line_peak", mutate)
    regs = chart.confidence.uncertain_regions
    assert len(regs) == 1 and regs[0].start_index == 5 and regs[0].end_index == 7
    assert regs[0].text == "values from step 5 to step 7"
    assert chart.confidence.level in ("medium", "low")
    untouched = [p for i, p in enumerate(chart.series[0].points) if i not in (5, 6, 7)]
    assert all("uncertain" not in p.flags for p in untouched)


def test_wrong_bar_value_caught_by_pixel_check():
    def mutate(r):
        r["series"][0]["points"][2]["y"] = 3.5  # Wed is 2.1
    chart, _ = run("08_bar_decimal", mutate)
    wed = chart.series[0].points[2]
    assert "pixel_off" in wed.flags and "crosscheck_disagree" in wed.flags
    assert wed.checks["pixel_y"] == pytest.approx(2.1, abs=0.15)


def test_missing_second_reading_lowers_confidence_and_says_so():
    chart, _ = run("02_line_peak", drop_geometry=True)
    assert chart.confidence.level != "high"
    assert any("second reading failed" in r for r in chart.confidence.reasons)


def test_regions_whole_chart_text():
    chart, _ = run("h05c_phone_photo")
    assert [r.text for r in chart.confidence.uncertain_regions] == ["all values"]
