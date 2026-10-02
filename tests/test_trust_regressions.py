"""Regressions for the false alarms measured by replaying live readings (job 2 in DECISIONS.md).

The live readings themselves are not in the repo, so each case is rebuilt from the
fixture readings with the measured error shape injected, or drawn with matplotlib.
"""

import copy
import random

import pytest
from PIL import Image

from app.models import Chart, ChartReading, GeometryReading
from app.pipeline import confidence as conf
from app.pipeline import trust
from app.pipeline.extract import normalize
from app.pipeline.risk import measure_image

import synthetic
from test_trust import FIX, ROOT

pytest.importorskip("matplotlib")


def run(name, reading_mut=None, geometry_mut=None, image=None):
    e = FIX[name]
    r, g = copy.deepcopy(e["reading"]), copy.deepcopy(e["geometry"])
    if reading_mut:
        reading_mut(r)
    if geometry_mut:
        geometry_mut(g)
    reading, geometry = ChartReading.model_validate(r), GeometryReading.model_validate(g)
    im = image or Image.open(ROOT / e["file"]).convert("RGB")
    kind, xa, ya, series, notes = normalize(reading)
    chart = Chart(id="c", document_id="d", chart_type=kind, x_axis=xa, y_axis=ya, series=series,
                  has_markers=reading.has_point_markers, image_size=[im.width, im.height])
    trust.assess(chart, reading, geometry, im, notes, "")
    return chart


def points(chart):
    return [p for s in chart.series for p in s.points]


# a) A straight sloped line is not a tilted photo -------------------------------------------


def _risk_codes(im):
    chart = Chart(id="c", document_id="d", has_markers=True)
    chart.x_axis.tick_count = chart.y_axis.tick_count = 6
    return {r.code for r in conf.risk_factors(chart, measure_image(im), None, (6, 6))}


@pytest.mark.parametrize("name", sorted(synthetic.ALL))
def test_clean_charts_with_sloped_lines_are_not_tilted(name):
    im, _ = synthetic.ALL[name]()
    stats = measure_image(im)
    assert stats.tilt_deg < conf.TILT_SEVERE_DEG, stats
    assert not {"tilted", "slightly_tilted"} & _risk_codes(im)


@pytest.mark.parametrize("name", ["h02c_phone_photo", "h05c_phone_photo", "h06c_phone_photo", "h08c_phone_photo"])
def test_phone_photos_are_still_tilted(name):
    stats = measure_image(Image.open(ROOT / FIX[name]["file"]).convert("RGB"))
    assert 3.0 < stats.tilt_deg < 4.5, stats
    assert "tilted" in _risk_codes(Image.open(ROOT / FIX[name]["file"]).convert("RGB"))


@pytest.mark.parametrize("name", ["linear_trend", "supply_demand", "despined_single_line"])
def test_a_rotated_chart_is_tilted(name):
    im = synthetic.ALL[name]()[0].rotate(3.5, expand=True, fillcolor="white")
    assert measure_image(im).tilt_deg > 3.0


def test_keystone_alone_does_not_make_a_chart_tilted():
    stats = measure_image(synthetic.ALL["scatter_with_regression"]()[0])
    stats.keystone_deg = 5.0  # a large spread of line angles, with no rotation
    chart = Chart(id="c", document_id="d", has_markers=True)
    chart.x_axis.tick_count = chart.y_axis.tick_count = 6
    assert "tilted" not in {r.code for r in conf.risk_factors(chart, stats, None, (6, 6))}


# b) Structural risks cap the level at medium; only failed checks make a point uncertain ------


def _small_noise(r, limit=0.02, seed=1):
    rng = random.Random(seed)
    span = r["y_axis"]["max"] - r["y_axis"]["min"]
    for s in r["series"]:
        for p in s["points"]:
            p["y"] += rng.choice([-1, 1]) * rng.uniform(0.3, 1.0) * limit * span


def test_hs1_read_within_two_percent_is_medium_with_no_uncertain_points():
    chart = run("hs1_sparse_ticks", lambda r: _small_noise(r, 0.02))
    assert chart.confidence.level == "medium"
    assert chart.confidence.uncertain_regions == []
    assert not any("uncertain" in p.flags for p in points(chart))
    assert chart.confidence.signals["risk_limited"]
    assert chart.confidence.reasons[0].startswith("Every point passed its checks, but")


def test_no_point_is_on_the_line_and_uncertain():
    # The verification view must never say "on the drawn line: Yes" next to "Uncertain" for a reason
    # that is not about that point.
    for name in ("hs1_sparse_ticks", "06_line_dense", "hs5_three_similar", "h06a_lowres"):
        chart = run(name, lambda r: _small_noise(r, 0.01))
        for p in points(chart):
            if "uncertain" in p.flags:
                assert set(p.flags) - {"uncertain"}, (name, p)


def test_tilted_photo_stays_low_with_every_point_uncertain():
    chart = run("h05c_phone_photo")
    assert chart.confidence.level == "low"
    assert all("uncertain" in p.flags for p in points(chart))
    assert "straightened" in chart.confidence.reasons[0]


# c) A noisy second reading does not cost a correct first reading -----------------------------


def _second_off(series_index, idxs, dy=50):
    def m(g):
        for i in idxs:
            g["series"][series_index]["points"][i]["position"][0] -= dy  # about 6% of the axis
    return m


@pytest.mark.parametrize("name,idxs", [("hs1_sparse_ticks", [18, 19]), ("02_line_peak", [12])])
def test_second_reading_off_but_first_on_the_line_keeps_full_confidence(name, idxs):
    chart = run(name, geometry_mut=_second_off(0, idxs))
    for i in idxs:
        p = chart.series[0].points[i]
        assert p.checks["crosscheck_dy_pct"] > 4
        assert "second_reading_differs" in p.flags and "crosscheck_disagree" not in p.flags
        assert p.confidence == 1.0
    assert any("second reading differs" in r for r in chart.confidence.reasons)
    if name == "02_line_peak":
        assert chart.confidence.level == "high"


def test_disagreement_with_the_first_reading_off_the_line_keeps_the_penalty():
    def wrong(r):
        r["series"][0]["points"][9]["y"] += 4.0  # about 10% of the axis
    chart = run("02_line_peak", wrong, _second_off(0, [9], dy=-50))
    p = chart.series[0].points[9]
    assert "pixel_off" in p.flags and "uncertain" in p.flags
    assert "second_reading_differs" not in p.flags


# d) End points -------------------------------------------------------------------------------


def test_last_point_at_the_end_of_the_line_is_on_the_line(monkeypatch):
    # Snapping and the image calibration would fix this calibration too; test the end search alone.
    monkeypatch.setenv("TICK_SNAP", "0")
    monkeypatch.setattr(trust, "calibration_from_image", lambda reading, image: None)

    def last_tick_right(g):
        g["x_ticks"][-1]["position"][1] += 8  # the calibration puts 20 m a few pixels past the line's end
    chart = run("hs1_sparse_ticks", geometry_mut=last_tick_right)
    last = chart.series[0].points[-1]
    assert last.x_label == "20" and last.y == pytest.approx(49.5)
    assert not {"pixel_off", "pixel_missing", "pixel_near"} & set(last.flags), last.checks
    assert last.checks.get("pixel_end_shift_px", 0) > 0


def test_end_search_does_not_rescue_a_wrong_last_value():
    def wrong(r):
        r["series"][0]["points"][-1]["y"] = 40.0  # true 49.5
    chart = run("hs1_sparse_ticks", wrong)
    assert {"pixel_off", "pixel_near"} & set(chart.series[0].points[-1].flags)


# e) Calibration: ticks snap to the drawn tick marks --------------------------------------------


def _ticks_offset(dy=30):  # 0-1000 units: about 16 px, the size of the measured 3.5 to 4.3% offset
    def m(g):
        for t in g["y_ticks"]:
            t["position"][0] += dy
    return m


def test_tick_snapping_removes_a_systematic_tick_offset(monkeypatch):
    monkeypatch.setattr(trust, "calibration_from_image", lambda reading, image: None)
    monkeypatch.setenv("TICK_SNAP", "0")
    before = run("02_line_peak", geometry_mut=_ticks_offset())
    near_before = sum(1 for p in points(before) if {"pixel_near", "pixel_off"} & set(p.flags))
    monkeypatch.setenv("TICK_SNAP", "1")
    after = run("02_line_peak", geometry_mut=_ticks_offset())
    near_after = sum(1 for p in points(after) if {"pixel_near", "pixel_off"} & set(p.flags))
    assert near_before >= 5 and near_after == 0
    assert after.confidence.signals["calibration"]["snapped"]["y"] >= 5
    assert after.confidence.level == "high"


def test_snapping_keeps_injected_errors_visible():
    def bump(r):
        for i in (5, 6, 7):
            r["series"][0]["points"][i]["y"] += 4.0
    chart = run("02_line_peak", bump, _ticks_offset())
    assert [i for i, p in enumerate(chart.series[0].points) if "uncertain" in p.flags] == [5, 6, 7]


# f) Reasons match the level --------------------------------------------------------------------


@pytest.mark.parametrize("name", sorted(FIX))
def test_reasons_do_not_contradict_the_level(name):
    chart = run(name)
    c = chart.confidence
    text = " ".join(c.reasons).lower()
    if c.level == "high":
        assert "failed a check" not in text and "uncertain" not in text and "disagree" not in text
        assert all(r.startswith("Noted, but the checks passed") for r in c.reasons
                   if any(r.endswith(f.text) or r[len("Noted, but the checks passed: "):].lower() == f.text.lower()
                          for f in c.risk_factors))
    else:
        first = c.reasons[0]
        assert ("failed a check" in first or first.startswith("Every point passed its checks, but")
                or "angle" in first), (c.level, first)
    if c.level == "medium" and not any("uncertain" in p.flags for p in points(chart)):
        assert "off by up to" not in text


# Without a second reading the axes are calibrated from the image, so the pixel check still runs.


def test_no_second_reading_still_checks_values_against_the_image():
    from test_trust import run as run_fixture

    def wrong(r):
        r["series"][0]["points"][2]["y"] = 3.5  # Wed is 2.1
    chart, _ = run_fixture("08_bar_decimal", wrong, drop_geometry=True)
    wed = chart.series[0].points[2]
    assert "pixel_off" in wed.flags and "uncertain" in wed.flags
    others = [p for i, p in enumerate(chart.series[0].points) if i != 2]
    assert not any("uncertain" in p.flags for p in others)
    assert chart.confidence.level == "medium"
    assert any("checked against the image only" in r for r in chart.confidence.reasons)


def test_image_calibration_matches_the_second_reading_on_clean_charts():
    from app.models import ChartReading, GeometryReading
    from app.pipeline.mapping import build_calibration, calibration_from_image

    for name in ("02_line_peak", "05_line_two_series", "07_bar_simple", "hs1_sparse_ticks"):
        e = FIX[name]
        im = Image.open(ROOT / e["file"]).convert("RGB")
        r = ChartReading.model_validate(e["reading"])
        ref = build_calibration(GeometryReading.model_validate(e["geometry"]), r, im.width, im.height, im)
        cal = calibration_from_image(r, im)
        assert cal is not None, name
        for v in (r.y_axis.min, r.y_axis.max):
            assert abs(cal.y.to_pixel(v) - ref.y.to_pixel(v)) < 1.0, name
