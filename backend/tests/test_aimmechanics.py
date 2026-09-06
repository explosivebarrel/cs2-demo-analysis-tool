"""Aim mechanics: enemy-only hit checks, reaction arity, excellent ticks."""
from types import SimpleNamespace

import pandas as pd

from app.pipeline.aim_mechanics import (VelIndex, _compute_excellent_contacts,
    _compute_first_bullet_acc,
    _compute_reaction_time,
)


RATE = 64


def _rb():
    return SimpleNamespace(
        rounds=[{"n": 1, "freezeEndTick": 0, "endTick": 6400}],
        steamid_team={"me": 0, "mate": 0, "enemy": 1},
    )


def _wf(ticks):
    df = pd.DataFrame({"tick": ticks, "user_steamid": "me", "weapon": "ak47"})
    return df


def _hurt(rows):
    # (attacker, victim, tick)
    df = pd.DataFrame(rows, columns=["attacker_steamid", "user_steamid", "tick"])
    df["weapon"] = "ak47"
    df["hitgroup"] = "chest"
    return df


ENEMIES = {"enemy"}
EMPTY_KILLS = pd.DataFrame(columns=["tick", "attacker_steamid", "user_steamid"])


def test_first_bullet_ignores_teammate_hits():
    # shot at 1000; only a TEAMMATE got hurt within the hit window
    wf = _wf([1000])
    hurt = _hurt([("me", "mate", 1002)])
    pct, shots = _compute_first_bullet_acc(wf, hurt, EMPTY_KILLS, "me", _rb(), RATE, ENEMIES)
    assert pct == 0.0 and shots[0]["hit"] is False

    hurt = _hurt([("me", "enemy", 1002)])
    pct, shots = _compute_first_bullet_acc(wf, hurt, EMPTY_KILLS, "me", _rb(), RATE, ENEMIES)
    assert pct == 100.0 and shots[0]["hit"] is True


def test_reaction_time_returns_four_values():
    ticks = pd.DataFrame({
        "tick": [960, 1000], "steamid": "me", "X": [0.0, 0.0], "Y": [0.0, 0.0],
        "yaw": [0.0, 0.0],
    })
    wf = _wf([1000])
    kills = pd.DataFrame({
        "tick": [1010], "attacker_steamid": "me", "user_steamid": "enemy",
    })
    res = _compute_reaction_time(ticks, wf, kills, "me", RATE, pd.DataFrame(), ENEMIES)
    assert len(res) == 4


def test_excellent_contacts_returns_matching_ticks():
    wf = _wf([1000, 2000])
    hurt = _hurt([("me", "enemy", 1002)])          # first shot hit, second missed
    kills = pd.DataFrame({
        "tick": [1050, 2050], "attacker_steamid": "me", "user_steamid": "enemy",
    })
    # me standing still around tick 1000, moving 120 u/s around tick 2000
    ticks = pd.DataFrame({
        "tick": [992, 1000, 1008, 1992, 2000, 2008],
        "steamid": "me",
        "X": [0.0, 0.0, 0.0, 100.0, 115.0, 130.0],
        "Y": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    })
    count, ticks_out = _compute_excellent_contacts(
        wf, hurt, kills, VelIndex(ticks, RATE), "me", RATE, ENEMIES)
    assert count == 1
    assert ticks_out == [1050]   # kill ticks, so duel episodes match by d.tick


def test_vel_index_reads_arbitrary_event_ticks():
    # samples every 8 ticks, mover advances 250 u/s = 31.25 units per 8 ticks
    rows = [{"tick": 1000 + k * 8, "steamid": "p", "X": 31.25 * k, "Y": 0.0}
            for k in range(6)]
    vi = VelIndex(pd.DataFrame(rows), RATE)
    # event ticks off the sampling grid must still resolve to the real speed
    for tick in (1004, 1011, 1023, 1030):
        assert abs(vi.at(tick, "p") - 250.0) < 1.0
    assert vi.at(1000, "unknown") == 0.0
