"""Teamkills: separate counter, episodes, match-level list, moments.

Teamkills still count towards kills (deliberate divergence from the CS2
scoreboard) — the dedicated counter just makes them visible.
"""
from types import SimpleNamespace

import pandas as pd

from app.pipeline.playeranalytics import (
    _build_duels,
    _build_match_teamkills,
    _build_metrics,
    _build_teamkills,
    build_moments,
)
from app.pipeline.players import compute_players


RATE = 64


def _ticks(rows):
    return pd.DataFrame(rows, columns=["tick", "steamid", "name", "X", "Y", "yaw",
                                       "hp", "armor", "is_alive", "is_walking",
                                       "duck_amount", "active_weapon_name", "team_num"])


def _kills(rows):
    # (attacker, victim, tick)
    df = pd.DataFrame(rows, columns=["attacker_steamid", "user_steamid", "tick"])
    df["weapon"] = "ak47"
    df["headshot"] = False
    df["assister_steamid"] = ""
    df["distance"] = 0.0
    df["assistedflash"] = False
    return df


def _ctx(kills):
    ticks = _ticks([
        {"tick": t, "steamid": s, "name": s, "X": 100.0, "Y": 100.0, "yaw": 0.0,
         "hp": 100, "armor": 0, "is_alive": True, "is_walking": False,
         "duck_amount": 0.0, "active_weapon_name": "weapon_ak47",
         "team_num": 3 if s != "enemy" else 2}
        for t in (1200, 1300, 1400)
        for s in ("me", "mate", "enemy")
    ])
    return SimpleNamespace(ticks=ticks, tickrate=RATE,
                           ev=lambda name: kills if name == "player_death" else pd.DataFrame())


class _RB:
    def __init__(self, steamid_team=None):
        self.rounds = [
            {"n": 1, "freezeEndTick": 0, "endTick": 6400},
            {"n": 2, "freezeEndTick": 7000, "endTick": 13400},
        ]
        self.steamid_team = steamid_team or {"me": 0, "mate": 0, "enemy": 1}
        self.tv = SimpleNamespace(col_at_tick=lambda tick, col: {})


class _CtxPlayers:
    tickrate = RATE
    grenades = None

    def __init__(self, evs):
        self._evs = evs
        self.ticks = pd.DataFrame({"steamid": ["me", "mate"], "name": ["me", "mate"]})

    def ev(self, name):
        return self._evs.get(name, pd.DataFrame())


class _Clutch:
    attempts = []

    def note_kill(self, a, n):
        pass


class _FB:
    clutch = _Clutch()
    stats = {}


def test_players_count_teamkills():
    evs = {"player_death": _kills([
        ("me", "mate", 1300),    # teamkill: counter + event, kills unchanged
        ("me", "enemy", 1400),   # regular kill: no teamkill credit
    ])}
    ps = compute_players(_CtxPlayers(evs), _RB(), _FB())
    me = ps["me"]
    assert me.teamKills == 1
    assert me.teamKillEvents == [(1, 1300)]
    # kills are NOT reduced by teamkills (CS2 scoreboard would show 1)
    assert sum(pr["kills"] for pr in me.rounds.values()) == 2
    assert ps["mate"].teamKills == 0


def test_teamkill_episode_built():
    kills = _kills([
        ("me", "enemy", 1000),   # not a teamkill
        ("me", "mate", 1300),    # teamkill -> episode
        ("me", "mate", 6500),    # between rounds -> no episode
    ])
    ctx = _ctx(kills)
    eps = _build_teamkills(ctx, _RB(), "me")
    assert len(eps) == 1
    ep = eps[0]
    assert ep["round"] == 1 and ep["tick"] == 1300
    assert ep["attacker"] == "me" and ep["victim"] == "mate"
    assert ep["weapon"] == "ak47" and ep["headshot"] is False
    assert ep["frames"]            # built from tick data
    assert "won" not in ep and "errors" not in ep
    # the victim is an ally: aliveAllies excludes the victim, no enemies alive in frame
    assert ep["context"]["aliveAllies"] == 0
    # only the player's own teamkills
    assert _build_teamkills(ctx, _RB(), "mate") == []


def test_teamkills_are_not_duels():
    kills = _kills([("me", "mate", 1300)])
    ctx = _ctx(kills)
    assert _build_duels(ctx, _RB(), SimpleNamespace(), {"me": object()}, "me") == []


def test_match_teamkills_list():
    kills = _kills([
        ("me", "enemy", 1000),   # enemy kill -> not listed
        ("me", "mate", 1300),    # teamkill -> listed
        ("me", "mate", 6500),    # between rounds -> not listed
    ])
    out = _build_match_teamkills(_ctx(kills), _RB())
    assert [(t["round"], t["attacker"], t["victim"]) for t in out] == [(1, "me", "mate")]


def test_metrics_teamkill_fields():
    p = SimpleNamespace(
        rounds={1: {"kills": 1, "deaths": 0}},
        tradeKills=0, tradedDeaths=0,
        tradeKillEvents=[], tradedDeathEvents=[],
        teamKills=1, teamKillEvents=[(1, 1300)],
    )
    m = _build_metrics(p, [], [])
    assert m["teamKills"] == 1
    assert m["teamKillRounds"] == [1]
    assert m["teamKillTicks"] == [1300]


def test_teamkill_moments():
    pa = {"me": {"duels": [], "teamKills": [
        {"round": 1, "tick": 1300, "attacker": "me", "victim": "mate",
         "weapon": "ak47", "headshot": False},
    ]}}
    rb = SimpleNamespace(
        ctx=SimpleNamespace(tickrate=RATE),
        rounds=[{"n": 1, "freezeEndTick": 0, "endTick": 6400, "openingKill": None}],
        steamid_team=dict(_RB().steamid_team),
    )
    moments = build_moments(_ctx(_kills([])), rb, _FB(), {"me": object()}, pa, None, None)
    tk = [m for m in moments if m["type"] == "teamkill"]
    assert len(tk) == 1
    assert tk[0]["tick"] == 1300 and tk[0]["steamid"] == "me"
    assert tk[0]["round"] == 1 and tk[0]["preSec"] == 2.0
