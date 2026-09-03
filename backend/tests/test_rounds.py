from app.config import BUY_FORCE_MIN, BUY_FULL_MIN
from app.pipeline.rounds import RoundBuilder, _clean_clan


def test_buy_type_thresholds():
    f = RoundBuilder._buy_type
    assert f(0) == "pistol"
    assert f(1000) == "pistol"
    assert f(1000 + 1) == "eco"
    assert f(BUY_FORCE_MIN - 1) == "eco"
    assert f(BUY_FORCE_MIN) == "force"
    assert f(BUY_FULL_MIN - 1) == "force"
    assert f(BUY_FULL_MIN) == "full"


def test_clean_clan():
    assert _clean_clan("team_audirsss6") == "audirsss6"
    assert _clean_clan("TEAM_X") == "X"
    assert _clean_clan("") == ""
    assert _clean_clan(None) == ""
