from app.pipeline.summary import crossings, phases, summarize, turning_points

from factories import bar_chart, line_chart

PEAK = ([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [5.1, 5.4, 6.8, 10.4, 18.0, 29.3, 40.3, 45.0, 40.3, 29.3, 18.0, 10.4, 6.8])


def test_turning_points_ignore_small_wiggles():
    assert turning_points([0, 1, 2, 1.9, 3, 4], tol=0.5) == [0, 5]
    assert turning_points([0, 5, 10, 5, 0], tol=0.5) == [0, 2, 4]


def test_peak_summary_mentions_peak_max_min():
    c = line_chart({"Rate": PEAK})
    text = summarize(c)["text"]
    assert "rises to a peak of 45 mol/s at step 7" in text
    assert "then falls to 6.8 mol/s at step 12" in text
    assert "Maximum 45 mol/s at step 7" in text
    assert "minimum 5.1 mol/s at step 0" in text
    assert text.endswith("High confidence.")


def test_monotone_series_uses_from_to():
    c = line_chart({"H": ([0, 1, 2, 3], [1, 2, 3, 4])})
    assert "It rises from 1 mol/s at step 0 to 4 mol/s at step 3." in summarize(c)["text"]


def test_zigzag_reports_overall_direction():
    xs = list(range(12))
    ys = [0, 5, 1, 6, 2, 7, 3, 8, 4, 9, 5, 10]
    c = line_chart({"Z": (xs, ys)})
    assert "rises overall" in summarize(c)["text"]
    assert len(phases(c.series[0], 10)) > 3


def test_two_series_crossing():
    c = line_chart({"A": ([0, 1, 2], [0, 1, 2]), "B": ([0, 1, 2], [2, 1.5, 0])})
    cx = crossings(*c.series)
    assert len(cx) == 1 and "between 1 and 2" in cx[0][1]
    assert "A and B cross 1 time" in summarize(c)["text"]


def test_bar_summary_lists_values():
    c = bar_chart(["Mon", "Tue", "Wed"], {"Rain": [3.2, 4.8, 2.1]})
    text = summarize(c)["text"]
    assert "Highest is Tue at 4.8 mm; lowest is Wed at 2.1 mm." in text
    assert "In order: Mon 3.2 mm, Tue 4.8 mm, Wed 2.1 mm." in text
