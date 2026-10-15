"""Trades pass: event lists, round guards, KAST credit."""
from types import SimpleNamespace

import pandas as pd

from app.pipeline.players import compute_players
from app.pipeline.playeranalytics import _build_metrics


RATE = 64


class _Ctx:
    tickrate = RATE
    grenades = None

    def __init__(self, evs):
        self._evs = evs
        self.ticks = pd.DataFrame({"steamid": ["t1", "c1"], "name": ["t1", "c1"]})

    def ev(self, name):
        return self._evs.get(name, pd.DataFrame())


class _RB:
    def __init__(self, steamid_team=None):
        self.rounds = [
            {"n": 1, "freezeEndTick": 0, "endTick": 6400, "clans": {},
             "winnerTeam": 0, "planter": None, "defuser": None, "bombPlanted": False},
            {"n": 2, "freezeEndTick": 7000, "endTick": 13400, "clans": {},
             "winnerTeam": 1, "planter": None, "defuser": None, "bombPlanted": False},
        ]
        self.steamid_team = steamid_team or {
            "t1": 0, "t2": 0, "c1": 1, "c2": 1, "c3": 1, "c4": 1}
        self.tv = SimpleNamespace(col_at_tick=lambda tick, col: {})


class _Clutch:
    attempts = []

    def note_kill(self, a, n):
        pass


class _FB:
    clutch = _Clutch()
    stats = {}


def _kills(rows):
    # (attacker, victim, tick)
    return pd.DataFrame(rows, columns=["attacker", "victim", "tick"]).assign(
        tick=lambda d: d["tick"] * 1,
        assister_steamid="", weapon="ak47", headshot=False,
        distance=0.0, assistedflash=False,
    ).rename(columns={"attacker": "attacker_steamid", "victim": "user_steamid"})


def _match():
    evs = {"player_death": _kills([
        ("c2", "c1", 1000),   # c1 dies...
        ("c3", "c2", 1100),   # ...avenged by c3        -> c3 trade (1, 1100)
        ("t1", "c3", 1150),   # c3 dies...
        ("c4", "t1", 1200),   # ...avenged by c4        -> c4 trade, c3 tradedDeath
        ("t2", "c4", 1250),   # c4 dies...
        ("c3", "t2", 1300),   # ...avenged by c3 again  -> c3 second trade, same round
        ("t2", "c2", 6500),   # between rounds: no avenger counting
        ("c1", "t2", 6550),
        ("t1", "c3", 7200),   # round 2: c3 dies...
        ("c1", "t1", 7300),   # ...avenged by c1        -> c1 trade, c3 tradedDeath r2
    ])}
    return compute_players(_Ctx(evs), _RB(), _FB())


def test_trade_events_keep_same_round_pairs():
    ps = _match()
    c3 = ps["c3"]
    assert c3.tradeKills == 2
    assert c3.tradeKillEvents == [(1, 1100), (1, 1300)]
    assert c3.tradedDeaths == 2
    assert c3.tradedDeathEvents == [(1, 1150), (2, 7200)]


def test_gap_kills_do_not_count():
    ps = _match()
    assert ps["c2"].tradedDeaths == 0     # died in the gap: no trade credit
    assert ps["c1"].tradeKillEvents == [(2, 7300)]   # not the gap kill at 6550
    assert ps["t2"].tradeKills == 1


def test_kast_credits_traded_death_round():
    ps = _match()
    # c1 round 1: died, traded, nothing else -> KAST only via the traded death
    assert 1 in ps["c1"].kastRounds
    # c3 round 2: died, traded, nothing else
    assert 2 in ps["c3"].kastRounds
    # c4 round 2: no kill/assist/survival/trade -> no KAST
    assert 2 not in ps["c4"].kastRounds


def test_one_avenging_kill_is_one_trade():
    # killer double-kills two teammates; a single avenger kill trades both
    # deaths but is only ONE trade kill
    evs = {"player_death": _kills([
        ("t9", "c9a", 1000),
        ("t9", "c9b", 1100),   # second victim of the same killer
        ("c9a", "t9", 1200),   # avenger (c9a somehow alive here) kills t9 once
    ])}
    ps = compute_players(_Ctx(evs), _RB({"t9": 0, "c9a": 1, "c9b": 1}), _FB())
    c9a = ps["c9a"]
    assert c9a.tradeKills == 1
    assert c9a.tradeKillEvents == [(1, 1200)]
    assert c9a.tradedDeaths == 1
    c9b = ps["c9b"]
    assert c9b.tradedDeaths == 1
    assert c9b.tradedDeathEvents == [(1, 1100)]


def test_build_metrics_from_events():
    p = SimpleNamespace(
        rounds={1: {"kills": 2, "deaths": 1}, 2: {"kills": 0, "deaths": 1}},
        tradeKills=2, tradedDeaths=2,
        tradeKillEvents=[(1, 1100), (1, 1300)],
        tradedDeathEvents=[(1, 1150), (2, 7200)],
    )
    m = _build_metrics(p, [], [])
    assert m["tradeKillRounds"] == [1]
    assert m["tradeKillTicks"] == [1100, 1300]
    assert m["tradedDeathRounds"] == [1, 2]
    assert m["tradedDeathTicks"] == [1150, 7200]
    assert m["tradeKillPct"] == 100.0
    assert m["tradedDeathPct"] == 100.0
