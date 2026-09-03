import math

from app.pipeline.heatmaps import _f


def test_f_handles_nan_and_none():
    assert _f(None) == 0.0
    assert _f(float("nan")) == 0.0
    assert _f("") == 0.0


def test_f_handles_out_of_range():
    assert _f(float("inf")) == 0.0
    assert _f(5e9) == 0.0


def test_f_rounds_normal_values():
    assert _f(123.4567) == 123.5
    assert _f(-12.34) == -12.3
    assert _f(42) == 42.0
    assert math.isfinite(_f("7.25"))
