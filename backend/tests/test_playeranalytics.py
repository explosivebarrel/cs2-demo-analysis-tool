"""Tests for duel episode frames: positional velocity + WASD decomposition."""
import pandas as pd

from app.pipeline.playeranalytics import _build_duel_frames


def _df(rows):
    return pd.DataFrame(rows)


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
