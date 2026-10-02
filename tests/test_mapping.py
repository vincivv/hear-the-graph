import pytest

from app.pipeline.mapping import fit_axis, parse_number


@pytest.mark.parametrize("label,value", [
    ("0", 0.0), ("2,500", 2500.0), ("−15", -15.0), ("-0.5", -0.5), ("67.5", 67.5),
    ("10³", 1000.0), ("10¹", 10.0), ("10^2", 100.0), ("10^{-1}", 0.1), ("1e3", 1000.0),
    ("50%", 50.0), ("$40", 40.0), ("2k", 2000.0), ("Mon", None), ("", None),
])
def test_parse_number(label, value):
    got = parse_number(label)
    if value is None:
        assert got is None
    else:
        assert got == pytest.approx(value)


def test_fit_linear_axis_inverts():
    # y axis: pixel 400 is 0, pixel 100 is 30 (pixels grow downward)
    fit = fit_axis([(400, 0), (300, 10), (200, 20), (100, 30)], log=False)
    assert fit.to_value(250) == pytest.approx(15)
    assert fit.to_pixel(15) == pytest.approx(250)
    assert fit.residual == pytest.approx(0, abs=1e-9)


def test_fit_log_axis():
    fit = fit_axis([(300, 10), (200, 100), (100, 1000)], log=True)
    assert fit.to_value(150) == pytest.approx(10 ** 2.5)
    assert fit.to_pixel(100) == pytest.approx(200)
    assert fit.to_pixel(-5) is None


def test_fit_needs_two_distinct_values():
    assert fit_axis([(10, 5), (20, 5)], log=False) is None
    assert fit_axis([(10, None), (20, 3)], log=False) is None


def test_fit_reports_uneven_ticks():
    even = fit_axis([(0, 0), (100, 10), (200, 20), (300, 30)], log=False)
    uneven = fit_axis([(0, 0), (90, 10), (210, 20), (300, 30)], log=False)
    assert uneven.residual > even.residual + 0.01
