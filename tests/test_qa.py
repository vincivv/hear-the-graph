import pytest

from app.pipeline.qa import CannotAnswer, answer_question, declarations, rule_choose, run_operation

from factories import bar_chart, line_chart

PEAK = ([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [5.1, 5.4, 6.8, 10.4, 18.0, 29.3, 40.3, 45.0, 40.3, 29.3, 18.0, 10.4, 6.8])


@pytest.fixture
def peak():
    return line_chart({"Rate": PEAK})


def test_max_min(peak):
    text, used, vals = run_operation(peak, "max", {})
    assert "45 mol/s" in text and "step 7" in text and vals[0]["y"] == 45.0
    text, _, vals = run_operation(peak, "min", {})
    assert vals[0]["y"] == 5.1


def test_value_at_exact_and_interpolated(peak):
    text, used, _ = run_operation(peak, "value_at", {"x": "7"})
    assert text == "45 mol/s at step 7."
    text, used, _ = run_operation(peak, "value_at", {"x": "2.5"})
    assert "about 8.6 mol/s" in text.lower() and "estimated between step 2 and step 3" in text
    assert len(used) == 2


def test_value_at_outside_range_is_refused(peak):
    with pytest.raises(CannotAnswer):
        run_operation(peak, "value_at", {"x": "20"})


def test_x_where_finds_both_crossings(peak):
    text, used, _ = run_operation(peak, "x_where", {"y": 30})
    assert "twice" in text and "step 5.06" in text and "step 8.94" in text


def test_x_where_never(peak):
    text, _, _ = run_operation(peak, "x_where", {"y": 100})
    assert "never reaches" in text


def test_trend_and_slope(peak):
    text, _, _ = run_operation(peak, "trend", {"from": "2", "to": "7"})
    assert "rises" in text and "38.2 mol/s" in text
    text, _, _ = run_operation(peak, "slope", {"from": "3", "to": "6"})
    assert "10 mol/s per step" in text


def test_log_slope_reports_growth_factor():
    c = line_chart({"C": ([0, 1, 2], [10, 100, 1000])}, y_unit="", log=True)
    text, _, _ = run_operation(c, "slope", {})
    assert "factor of about 10 per step" in text


def test_average_range(peak):
    text, _, vals = run_operation(peak, "average", {})
    assert f"{sum(PEAK[1]) / 13:.1f}" in text and len(vals) == 13
    text, _, _ = run_operation(peak, "range", {})
    assert "range of 39.9 mol/s" in text


def test_compare_and_crossings():
    c = line_chart({"A": ([2020, 2021], [50, 60]), "B": ([2020, 2021], [55, 58])}, x_label="Year", y_unit="%")
    text, _, _ = run_operation(c, "compare", {"series_a": "A", "series_b": "B", "x": "2020"})
    assert "In 2020" in text and "B is higher by 5 percentage points" in text
    text, _, _ = run_operation(c, "crossings", {"series_a": "A", "series_b": "B"})
    assert "cross 1 time" in text


def test_bar_category_lookup():
    c = bar_chart(["Mon", "Tue", "Wed"], {"Rain": [3.2, 4.8, 2.1]})
    text, _, _ = run_operation(c, "value_at", {"x": "tue"})
    assert text == "4.8 mm for Tue."
    with pytest.raises(CannotAnswer):
        run_operation(c, "value_at", {"x": "Sunday"})
    with pytest.raises(CannotAnswer):
        run_operation(c, "slope", {})


def test_unknown_series_is_refused(peak):
    with pytest.raises(CannotAnswer):
        run_operation(peak, "max", {"series": "Nope"})


def test_rule_chooser():
    c = line_chart({"A": ([2020, 2021], [50, 60]), "B": ([2020, 2021], [55, 58])}, x_label="Year", y_unit="%")
    assert rule_choose(c, "where is the maximum?")[0] == "max"
    assert rule_choose(c, "which is higher in 2021?") == ("compare", {"series_a": "A", "series_b": "B", "x": "2021"})
    assert rule_choose(c, "when do they cross?")[0] == "crossings"
    assert rule_choose(c, "what was A in 2020?") == ("value_at", {"series": "A", "x": "2020"})
    assert rule_choose(c, "who drew this?")[0] == "cannot_answer"


def test_answer_confidence_uses_weakest_point():
    c = line_chart({"Rate": PEAK}, conf={("Rate", 7): 0.4})
    a = answer_question(c, "where is the maximum?", None, None, "uploads")
    assert a.confidence == "low" and "is uncertain" in a.confidence_note and "step 7" in a.confidence_note
    a = answer_question(c, "what is the value at 2?", None, None, "uploads")
    assert a.confidence == "high"


def test_unanswerable_says_so(peak):
    a = answer_question(peak, "what color is the line?", None, None, "uploads")
    assert not a.answerable and "can't answer" in a.answer and a.values == []


def test_declarations_hide_y_values(peak):
    from app.pipeline.qa import context
    ctx = context(peak)
    assert "45" not in ctx and "40.3" not in ctx
    names = [d["name"] for d in declarations(peak)]
    assert {"max", "min", "value_at", "x_where", "trend", "slope", "average", "range", "describe", "cannot_answer"} <= set(names)


class FakeProvider:
    def __init__(self, name, args):
        self.out = (name, args)

    def choose_operation(self, question, context, decls, h, bucket):
        from app.gemini import CallMeta
        return self.out[0], self.out[1], CallMeta("live", "m", 0)


def test_gemini_choice_is_used_and_numbers_come_from_code(peak):
    a = answer_question(peak, "peak?", None, FakeProvider("max", {}), "uploads")
    assert a.chooser == "gemini" and "45 mol/s" in a.answer


def test_gemini_failure_falls_back_to_rules(peak):
    class Broken:
        def choose_operation(self, *a):
            raise RuntimeError("down")
    a = answer_question(peak, "where is the maximum?", None, Broken(), "uploads")
    assert a.chooser == "rules" and "could not be reached" in a.chooser_note and a.operation == "max"


def test_slow_gemini_choice_falls_back_to_rules_in_time(peak, monkeypatch):
    import threading
    import time

    release = threading.Event()

    class Slow:
        def choose_operation(self, *a):
            release.wait(5)
            return FakeProvider("min", {}).choose_operation(*a)

    monkeypatch.setenv("QA_DEADLINE_SECONDS", "1")
    t0 = time.monotonic()
    a = answer_question(peak, "where is the maximum?", None, Slow(), "uploads")
    release.set()
    assert time.monotonic() - t0 < 3
    assert a.chooser == "rules" and "slow" in a.chooser_note and a.operation == "max" and "45 mol/s" in a.answer


def test_rules_match_threshold_and_future_questions(peak):
    op, args = rule_choose(peak, "At which step does the rate first go above 30 mol/s?")
    assert op == "x_where" and args["y"] == 30.0
    assert rule_choose(peak, "When does it drop below 10?")[0] == "x_where"
    assert rule_choose(peak, "How much will the rate be next step?")[0] == "cannot_answer"
    bars = bar_chart(["Mon", "Tue", "Sun"], {"Rain": [3.2, 5.0, 7.4]})
    assert rule_choose(bars, "How much rain will fall next Sunday?")[0] == "cannot_answer"
    assert rule_choose(bars, "Which day had the least rain?")[0] == "min"
