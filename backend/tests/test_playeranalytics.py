"""Tests for duel episode frames: positional velocity + WASD decomposition."""
import json

import pandas as pd

from app.pipeline.playeranalytics import _build_duel_frames


def _df(rows):
    # numpy scalars in, like real parse output
    return pd.DataFrame(rows).astype(
        {"tick": "int64", "X": "float64", "Y": "float64", "yaw": "float64"})


def test_duel_frames_velocity_and_wasd():
    rate, step, t0 = 64, 8, 1000
    rows = []
    # walk east (yaw=0 → forward = +x) at 250 u/s: 31.25 units per 8-tick frame
    for k in range(10):
        rows.append({"tick": t0 + k * step, "steamid": "p1",
                     "X": 1000.0 + 31.25 * k, "Y": 500.0, "yaw": 0.0,
                     "is_walking": False, "duck_amount": 0.0})
    # then strafe right (yaw=0 → right = (0,-1)): y decreases
    for k in range(10, 14):
        rows.append({"tick": t0 + k * step, "steamid": "p1",
                     "X": 1000.0 + 312.5, "Y": 500.0 - 31.25 * (k - 10), "yaw": 0.0,
                     "is_walking": True, "duck_amount": 0.0})
    frames = _build_duel_frames(_df(rows), "p1", kill_tick=t0 + 5 * step,
                                round_start_tick=t0 - 100, round_end_tick=t0 + 400,
                                tickrate=rate)
    assert len(frames) == 14
    for f in frames:
        json.dumps(f)  # payload must be plain python (no np.bool_/np.float64)
        assert f["w"] in (True, False)
    for f in frames[1:10]:
        assert f["vel"] > 240
        assert f["w"] and not f["a"] and not f["s"] and not f["d"]
    for f in frames[11:]:
        assert f["vel"] > 240
        assert f["d"] and not f["w"] and not f["a"] and not f["s"]
        assert f["walk"]


def test_duel_frames_backward_and_still():
    rate, step, t0 = 64, 8, 1000
    rows = []
    # move west (backward at yaw=0) at ~187 u/s: 23.4375 units per frame
    for k in range(6):
        rows.append({"tick": t0 + k * step, "steamid": "p2",
                     "X": 1000.0 - 23.4375 * k, "Y": 500.0, "yaw": 0.0,
                     "is_walking": False, "duck_amount": 0.6})
    # stand still
    for k in range(6, 10):
        rows.append({"tick": t0 + k * step, "steamid": "p2",
                     "X": 1000.0 - 117.1875, "Y": 500.0, "yaw": 0.0,
                     "is_walking": False, "duck_amount": 0.6})
    frames = _build_duel_frames(_df(rows), "p2", kill_tick=t0,
                                round_start_tick=t0 - 200, round_end_tick=t0 + 400,
                                tickrate=rate)
    for f in frames[1:6]:
        assert f["s"] and not f["w"] and not f["a"] and not f["d"]
        assert f["duck"]  # duck_amount 0.6 > 0.3
    for f in frames[7:]:
        assert not f["w"] and not f["a"] and not f["s"] and not f["d"]
        assert f["vel"] == 0.0


# ------------------------------------------------------------------ swing moments

class _Ctx:
    def ev(self, name):
        return pd.DataFrame()


class _RB:
    def __init__(self, rounds):
        self.rounds = rounds
        self.ctx = type("C", (), {"tickrate": 64})()


class _FB:
    clutch = None


def _swings(winprob, ticks, rounds):
    from app.pipeline.playeranalytics import build_moments
    moments = build_moments(_Ctx(), _RB(rounds), _FB(), {}, {}, winprob, ticks)
    return [m for m in moments if m["type"] == "swing"]


STEP = 8  # 0.125 s per frame at 64 tick; swing window = 8 s = 64 frames


def _curve(segments):
    """segments: list of (n_frames, value | (v0, v1)) — linear ramp for tuples."""
    wp, ticks = [], []
    t = 0
    for n, v in segments:
        for k in range(n):
            if isinstance(v, tuple):
                wp.append(v[0] + (v[1] - v[0]) * k / (n - 1))
            else:
                wp.append(v)
            ticks.append(t)
            t += STEP
    return wp, ticks


def test_slow_momentum_swing_detected():
    # 0.9 -> 0.1 over 24 s: per-frame step ~0.003, windowed delta ~0.27
    wp, ticks = _curve([(64, 0.9), (192, (0.9, 0.1)), (144, 0.1)])
    rounds = [{"n": 1, "freezeEndTick": 0, "endTick": ticks[-1]}]
    sw = _swings(wp, ticks, rounds)
    assert len(sw) == 1
    assert sw[0]["round"] == 1
    assert int(sw[0]["detail"].rstrip("%")) >= 20
    assert ticks[0] <= sw[0]["tick"] <= ticks[-1]


def test_round_reset_not_a_swing():
    # flat contested 0.85 at round end, reset to 0.5 right after endTick:
    # the frame beyond endTick must not leak into the round's segment
    wp, ticks = _curve([(100, 0.85), (200, 0.5)])
    r1_end = ticks[99] - 5  # between frame 99 and the already-reset frame 100
    rounds = [{"n": 1, "freezeEndTick": 0, "endTick": r1_end},
              {"n": 2, "freezeEndTick": ticks[149], "endTick": ticks[-1] + 100}]
    assert _swings(wp, ticks, rounds) == []


def test_two_swings_in_one_round():
    # collapses >16 s apart so non-max suppression keeps both
    wp, ticks = _curve([(100, 0.5), (10, (0.5, 0.1)), (190, 0.1),
                        (10, (0.1, 0.9)), (100, 0.9)])
    rounds = [{"n": 1, "freezeEndTick": 0, "endTick": ticks[-1] + 10}]
    sw = _swings(wp, ticks, rounds)
    assert len(sw) == 2
    assert sw[0]["tick"] < sw[1]["tick"]
