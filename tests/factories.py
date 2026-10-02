"""Build chart records for tests without running the pipeline."""

from app.models import Axis, Chart, Confidence, Point, Series


def line_chart(series: dict, x_label="Step", y_label="Rate (mol/s)", y_unit="mol/s", kind="line", log=False, conf=None):
    out = []
    for name, (xs, ys) in series.items():
        pts = [Point(x=float(x), x_label=f"{x:g}", y=float(y), confidence=(conf or {}).get((name, i), 1.0)) for i, (x, y) in enumerate(zip(xs, ys))]
        for p in pts:
            if p.confidence < 0.7:
                p.flags.append("uncertain")
        out.append(Series(name=name, points=pts))
    ys = [p.y for s in out for p in s.points]
    return Chart(
        id="c1", document_id="d1", chart_type=kind, title="T",
        x_axis=Axis(label=x_label, min=0, max=10, scale="linear"),
        y_axis=Axis(label=y_label, unit=y_unit, min=min(ys), max=max(ys), scale="log" if log else "linear"),
        series=out, confidence=Confidence(level="high", message="High confidence."),
    )


def bar_chart(cats, values: dict, y_label="Rainfall (mm)", y_unit="mm"):
    out = []
    for name, ys in values.items():
        out.append(Series(name=name, points=[Point(x=float(i), x_label=c, y=float(y)) for i, (c, y) in enumerate(zip(cats, ys))]))
    ys = [p.y for s in out for p in s.points]
    return Chart(
        id="c2", document_id="d1", chart_type="bar", title="Rain",
        x_axis=Axis(label="Day", min=-0.5, max=len(cats) - 0.5, scale="category", categories=list(cats)),
        y_axis=Axis(label=y_label, unit=y_unit, min=0, max=max(ys)), series=out,
        confidence=Confidence(level="high", message="High confidence."),
    )
