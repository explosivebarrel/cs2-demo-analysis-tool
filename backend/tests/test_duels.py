"""Duel population: in-round enemy engagements only."""
from types import SimpleNamespace

import pandas as pd

from app.pipeline.playeranalytics import _build_duels


RATE = 64


def _ticks(rows):
    return pd.DataFrame(rows, columns=["tick", "steamid", "name", "X", "Y", "yaw",
                                       "hp", "armor", "is_alive", "is_walking",
                                       "duck_amount", "active_weapon_name"])


def _kills(rows):
    # (attacker, victim, tick)
    df = pd.DataFrame(rows, columns=["attacker_steamid", "user_steamid", "tick"])
    df["weapon"] = "ak47"
    df["headshot"] = False
    return df


def _ctx(kills):
    ticks = _ticks([
        {"tick": 1000, "steamid": s, "name": s, "X": 100.0, "Y": 100.0, "yaw": 0.0,
         "hp": 100, "armor": 0, "is_alive": True, "is_walking": False,
         "duck_amount": 0.0, "active_weapon_name": "weapon_ak47"}
        for s in ("me", "mate", "enemy")
    ] + [
        {"tick": 7000, "steamid": s, "name": s, "X": 100.0, "Y": 100.0, "yaw": 0.0,
         "hp": 100, "armor": 0, "is_alive": True, "is_walking": False,
         "duck_amount": 0.0, "active_weapon_name": "weapon_ak47"}
        for s in ("me", "mate", "enemy")
    ])
    return SimpleNamespace(ticks=ticks, tickrate=RATE,
                           ev=lambda name: kills if name == "player_death" else pd.DataFrame())


class _RB:
    rounds = [
        {"n": 1, "freezeEndTick": 0, "endTick": 6400},
        {"n": 2, "freezeEndTick": 7000, "endTick": 13400},
    ]
    steamid_team = {"me": 0, "mate": 0, "enemy": 1}


def test_duels_population():
    kills = _kills([
        ("me", "enemy", 1000),     # in-round enemy kill -> duel (won)
        ("enemy", "me", 1100),     # in-round death -> duel (lost)
        ("me", "enemy", 6500),     # between rounds (knife round slot) -> excluded
        ("me", "me", 1200),        # suicide -> excluded
        ("me", "mate", 1300),      # teamkill -> excluded
        ("mate", "enemy", 1400),   # not our duel
    ])
    ctx = _ctx(kills)
    duels = _build_duels(ctx, _RB(), SimpleNamespace(), {"me": object()}, "me")
    assert len(duels) == 2
    won = [d for d in duels if d["won"]]
    lost = [d for d in duels if not d["won"]]
    assert len(won) == 1 and won[0]["round"] == 1
    assert len(lost) == 1 and lost[0]["round"] == 1
