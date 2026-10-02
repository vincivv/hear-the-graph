"""Synthetic clean charts drawn with matplotlib, for trust-layer regression tests.

Each returns (PIL image, data) so tests can build readings with known values.
"""

from __future__ import annotations

import io

import numpy as np
from PIL import Image


def _render(fig) -> Image.Image:
    import matplotlib.pyplot as plt

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=110)
    plt.close(fig)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def _fig(despine=False, grid=False):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(7, 4.5))
    if despine:
        for side in ("top", "right"):
            ax.spines[side].set_visible(False)
    if grid:
        ax.grid(True, color="#dddddd")
    return fig, ax


def linear_trend(rise=0.25, n=11, markers=True, despine=False, grid=False):
    """A straight sloped line; rise is the fraction of the y axis it climbs (0.25 is about 9 degrees on screen)."""
    fig, ax = _fig(despine, grid)
    x = np.arange(n)
    y = 40 + rise * 100 * x / (n - 1)
    ax.plot(x, y, marker="o" if markers else None, color="#1f77b4", linewidth=2)
    ax.set_ylim(0, 100 + 40 * rise)
    ax.set_title("Linear trend")
    return _render(fig), (x, y)


def supply_demand():
    fig, ax = _fig()
    q = np.linspace(0, 100, 11)
    ax.plot(q, 40 + 0.2 * q, color="#d62728", linewidth=2, label="Supply")
    ax.plot(q, 70 - 0.15 * q, color="#1f77b4", linewidth=2, label="Demand")
    ax.set_ylim(0, 100)
    ax.set_xlabel("Quantity")
    ax.set_ylabel("Price")
    ax.legend()
    return _render(fig), (q, 40 + 0.2 * q, 70 - 0.15 * q)


def scatter_with_regression(seed=3):
    fig, ax = _fig()
    rng = np.random.default_rng(seed)
    x = rng.uniform(0, 10, 40)
    y = 8 + 0.3 * x + rng.normal(0, 0.6, 40)
    ax.scatter(x, y, color="#2ca02c", s=18)
    xs = np.linspace(0, 10, 2)
    ax.plot(xs, 8 + 0.3 * xs, color="black", linewidth=2)
    ax.set_ylim(0, 20)
    return _render(fig), (x, y)


def despined_single_line(rise=0.12):
    fig, ax = _fig(despine=True)
    x = np.arange(0, 21)
    y = 30 + rise * 100 * x / 20
    ax.plot(x, y, color="#9467bd", linewidth=2.5)
    ax.set_ylim(0, 100)
    return _render(fig), (x, y)


def despined_black_line():
    """Left and bottom spines removed too: a black sloped line is the longest straight line in the image."""
    fig, ax = _fig(despine=True)
    for side in ("left", "bottom"):
        ax.spines[side].set_visible(False)
    x = np.arange(0, 11)
    y = 20 + 2.0 * x
    ax.plot(x, y, color="black", linewidth=2)
    ax.set_ylim(0, 100)
    return _render(fig), (x, y)


def shallow_slope(grid=True):
    fig, ax = _fig(grid=grid)
    x = np.arange(0, 11)
    ax.plot(x, 50 + 0.4 * x, color="#ff7f0e", linewidth=2, marker="s")
    ax.set_ylim(0, 100)
    return _render(fig), (x, 50 + 0.4 * x)


ALL = {
    "linear_trend": linear_trend,
    "linear_trend_nomarkers": lambda: linear_trend(rise=0.35, markers=False),
    "linear_trend_despined_grid": lambda: linear_trend(rise=0.15, despine=True, grid=True),
    "linear_trend_gentle": lambda: linear_trend(rise=0.1, markers=False),
    "supply_demand": supply_demand,
    "scatter_with_regression": scatter_with_regression,
    "despined_single_line": despined_single_line,
    "despined_single_line_steeper": lambda: despined_single_line(0.3),
    "despined_black_line": despined_black_line,
    "shallow_slope": shallow_slope,
}
