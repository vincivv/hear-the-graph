"""Number formatting shared by the summary, answers and point labels."""

from __future__ import annotations

import math


def decimals_for(span: float) -> int:
    """Decimals that resolve about 1/200 of the axis span."""
    if not span or not math.isfinite(span) or span <= 0:
        return 2
    step = span / 200.0
    return max(0, min(4, math.ceil(-math.log10(step)))) if step < 1 else 0


def fmt(v: float, decimals: int = 2) -> str:
    if v is None or not math.isfinite(v):
        return "unknown"
    s = f"{v:.{decimals}f}"
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    if s in ("-0", "-0.0"):
        s = "0"
    return s


def with_unit(text: str, unit: str) -> str:
    if not unit:
        return text
    if unit in ("%",):
        return f"{text}%"
    if unit in ("$",):
        return f"${text}" if not text.startswith("-") else f"-${text[1:]}"
    return f"{text} {unit}"


def join_words(items: list[str]) -> str:
    items = [i for i in items if i]
    if len(items) <= 1:
        return "".join(items)
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return ", ".join(items[:-1]) + f", and {items[-1]}"
