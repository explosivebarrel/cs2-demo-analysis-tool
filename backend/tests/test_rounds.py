from app.config import BUY_FORCE_MIN, BUY_FULL_MIN
from app.pipeline.rounds import RoundBuilder, _clean_clan, map_round_reason

import pandas as pd


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


def test_map_round_reason():
    assert map_round_reason("bomb_defused") == "defuse"
    assert map_round_reason("bomb_exploded") == "bomb"
    assert map_round_reason("t_killed") == "elimination"
    assert map_round_reason("ct_killed") == "elimination"
    assert map_round_reason("time_expired") == "time"
    assert map_round_reason("targets_saved") == "time"
    assert map_round_reason(None) == "elimination"
    assert map_round_reason("") == "elimination"


# ── knife round detection ────────────────────────────────────────────────────

def _knife_ctx(events: dict, tick_weapons: list[tuple[int, str, bool]]):
    """Minimal RoundBuilder stub: events dict + (tick, weapon, alive) rows."""
    from types import SimpleNamespace

    empty = pd.DataFrame()
    ev = {k: v for k, v in events.items()}
    ticks = pd.DataFrame(tick_weapons, columns=["tick", "active_weapon_name", "is_alive"])
    return SimpleNamespace(ev=lambda name: ev.get(name, empty), ticks=ticks)


def _knife_rb(events, tick_weapons):
    rb = RoundBuilder.__new__(RoundBuilder)
    rb.match_start = 5633
    rb.ctx = _knife_ctx(events, tick_weapons)
    return rb


def test_knife_round_detected():
    events = {
        "round_start": pd.DataFrame({"tick": [1]}),
        "round_freeze_end": pd.DataFrame({"tick": [1280]}),
        "round_end": pd.DataFrame({"tick": [4940], "winner": ["T"], "reason": ["ct_killed"]}),
    }
    weapons = [(2000, "knife", True), (2000, "Bayonet", True), (3000, "knife_t", True)]
    kr = _knife_rb(events, weapons)._knife_round()
    assert kr == {"startTick": 1, "endTick": 4940, "winner": "T"}


def test_knife_round_rejected_when_guns_seen():
    events = {
        "round_start": pd.DataFrame({"tick": [1]}),
        "round_freeze_end": pd.DataFrame({"tick": [1280]}),
        "round_end": pd.DataFrame({"tick": [4940], "winner": ["CT"], "reason": ["t_killed"]}),
    }
    weapons = [(2000, "knife", True), (2000, "Glock-18", True)]
    assert _knife_rb(events, weapons)._knife_round() is None


def test_knife_round_absent_without_pre_match_end():
    events = {
        "round_start": pd.DataFrame({"tick": [1]}),
        "round_freeze_end": pd.DataFrame({"tick": [1280]}),
        "round_end": pd.DataFrame({"tick": [9000], "winner": ["T"], "reason": ["ct_killed"]}),
    }
    assert _knife_rb(events, [(2000, "knife", True)])._knife_round() is None
