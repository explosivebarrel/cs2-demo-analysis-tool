from app.pipeline.rating import _normalize, _safe_div


def test_normalize_scales_to_mean_one():
    assert _normalize([2.0, 2.0, 2.0]) == [1.0, 1.0, 1.0]
    result = _normalize([1.0, 3.0])
    assert result[1] == 3 * result[0]
    assert abs(sum(result) / len(result) - 1.0) < 1e-9


def test_normalize_all_zero_is_neutral():
    assert _normalize([0.0, 0.0]) == [1.0, 1.0]


def test_normalize_clamps_negatives_to_zero():
    # negatives clamp to 0, then the remainder scales so the mean is 1
    assert _normalize([-5.0, 5.0]) == [0.0, 2.0]


def test_safe_div():
    assert _safe_div(10, 2) == 5.0
    assert _safe_div(10, 0) == 0.0
