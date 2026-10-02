import pytest

from app.gemini import check_detection, check_geometry, check_reading
from app.models import ChartReading, DetectionResult, GeometryReading
from app.pipeline.extract import Unsupported, normalize


def reading(**over):
    base = {
        "is_chart": True, "chart_type": "line", "title": "T",
        "x_axis": {"label": "Step", "unit": "", "scale": "linear", "min": 0, "max": 4, "tick_labels": ["0", "2", "4"]},
        "y_axis": {"label": "Rate (mol/s)", "unit": "mol/s", "scale": "linear", "min": 0, "max": 50, "tick_labels": ["0", "25", "50"]},
        "has_point_markers": True,
        "series": [{"name": "Rate", "color_hex": "#d62728", "points": [
            {"x_label": "0", "x_value": 0, "y": 5}, {"x_label": "2", "x_value": 2, "y": 45}, {"x_label": "1", "x_value": 1, "y": 20}]}],
    }
    base.update(over)
    return ChartReading.model_validate(base)


def test_check_reading_rejects_empty_series():
    with pytest.raises(ValueError):
        check_reading(reading(series=[]))
    with pytest.raises(ValueError):
        check_reading(reading(series=[{"name": "a", "color_hex": "", "points": [{"x_label": "0", "x_value": 0, "y": 1}]}]))


def test_check_reading_accepts_not_a_chart():
    check_reading(reading(is_chart=False, series=[]))


def test_normalize_sorts_and_notes():
    kind, x, y, series, notes = normalize(reading())
    assert kind == "line"
    assert [p.x for p in series[0].points] == [0, 1, 2]
    assert any("sorted" in n for n in notes)
    assert y.tick_count == 3


def test_normalize_dedupes_x():
    r = reading(series=[{"name": "R", "color_hex": "", "points": [
        {"x_label": "0", "x_value": 0, "y": 1}, {"x_label": "0", "x_value": 0, "y": 2}, {"x_label": "1", "x_value": 1, "y": 3}]}])
    _, _, _, series, notes = normalize(r)
    assert len(series[0].points) == 2
    assert any("same x" in n for n in notes)


def test_normalize_bar_categories():
    r = reading(chart_type="bar", x_axis={"label": "Day", "unit": "", "scale": "category", "min": 0, "max": 2, "tick_labels": ["Mon", "Tue", "Wed"]},
                series=[{"name": "Rain", "color_hex": "", "points": [
                    {"x_label": "Tue", "x_value": 1, "y": 4.8}, {"x_label": "Mon", "x_value": 0, "y": 3.2}, {"x_label": "Wed", "x_value": 2, "y": 2.1}]}])
    _, x, _, series, _ = normalize(r)
    assert x.categories == ["Mon", "Tue", "Wed"]
    assert [p.x_label for p in series[0].points] == ["Mon", "Tue", "Wed"]
    assert x.scale == "category"


def test_unsupported_types():
    with pytest.raises(Unsupported):
        normalize(reading(chart_type="other"))
    with pytest.raises(Unsupported):
        normalize(reading(is_chart=False))


def test_axis_range_repaired_from_data():
    r = reading(y_axis={"label": "", "unit": "", "scale": "linear", "min": 10, "max": 10, "tick_labels": []})
    _, _, y, _, notes = normalize(r)
    assert y.min == 5 and y.max == 45
    assert any("range was missing" in n for n in notes)


def test_detection_and_geometry_checks():
    with pytest.raises(ValueError):
        check_detection(DetectionResult.model_validate({"charts": [{"box_2d": [500, 0, 100, 1000], "chart_type": "line", "title": ""}]}))
    check_detection(DetectionResult.model_validate({"charts": [{"box_2d": [100, 0, 500, 1000], "chart_type": "line", "title": ""}]}))
    with pytest.raises(ValueError):
        check_geometry(GeometryReading.model_validate({"plot_area": [0, 0, 0, 0], "x_ticks": [], "y_ticks": [], "series": []}))
