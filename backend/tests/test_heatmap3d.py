"""3D voxel heatmap: ground-only, in-round samples aggregated per player."""
from types import SimpleNamespace

import pandas as pd

from app.pipeline.heatmap3d import build_heatmap3d


def _ticks(rows):
    return pd.DataFrame(rows, columns=[
        "tick", "steamid", "X", "Y", "Z", "is_alive", "is_airborne", "team_num"])


def _ctx(rows):
    return SimpleNamespace(ticks=_ticks(rows))


_RB = SimpleNamespace(rounds=[
    {"n": 1, "freezeEndTick": 1000, "endTick": 5000},
    {"n": 2, "freezeEndTick": 7000, "endTick": 11000},
])

SIDS = ["aaa", "bbb"]


def _row(tick, sid, x, y, z, alive=True, air=False):
    return {"tick": tick, "steamid": sid, "X": x, "Y": y, "Z": z,
            "is_alive": alive, "is_airborne": air, "team_num": 3}


def test_ground_only_and_in_round():
    ctx = _ctx([
        _row(2000, "aaa", 100.0, 100.0, 0.0),            # counted
        _row(2100, "aaa", 104.0, 100.0, 0.0, air=True),  # airborne -> skipped
        _row(2200, "bbb", 500.0, 500.0, 64.0),
        _row(2300, "bbb", 500.0, 500.0, 64.0, alive=False),  # dead -> skipped
        _row(900, "aaa", 200.0, 200.0, 0.0),             # before round 1
        _row(6000, "aaa", 200.0, 200.0, 0.0),            # between rounds
        _row(12000, "aaa", 200.0, 200.0, 0.0),           # after last round
    ])
    out = build_heatmap3d(ctx, _RB, SIDS)
    assert out["samples"] == 2
    assert len(out["cells"]) == 2


def test_voxel_indices_and_bounds():
    ctx = _ctx([
        _row(2000, "aaa", 100.0, 200.0, 32.0),
        _row(2100, "aaa", 100.0, 200.0, 32.0),   # same cell -> count 2
        _row(2200, "bbb", 132.0, 200.0, 32.0),   # next x cell (32 apart)
        _row(2300, "bbb", 100.0, 200.0, 64.0),   # next z step
    ])
    out = build_heatmap3d(ctx, _RB, SIDS)
    assert out["minX"] == 100.0 and out["minY"] == 200.0 and out["minZ"] == 32.0
    cells = {(c[0], c[1], c[2]): c[3:] for c in out["cells"]}
    assert cells[(0, 0, 0)] == [2, 0]
    assert cells[(1, 0, 0)] == [0, 1]
    assert cells[(0, 0, 1)] == [0, 1]
    # cells are lexicographically sorted
    keys = [c[:3] for c in out["cells"]]
    assert keys == sorted(keys)


def test_player_column_order_follows_steamids():
    ctx = _ctx([_row(2000, "bbb", 0.0, 0.0, 0.0)])
    out = build_heatmap3d(ctx, _RB, SIDS)
    assert out["players"] == SIDS
    assert out["cells"][0][3:] == [0, 1]
    out2 = build_heatmap3d(ctx, _RB, ["bbb", "aaa"])
    assert out2["players"] == ["bbb", "aaa"]
    assert out2["cells"][0][3:] == [1, 0]


def test_unknown_ground_state_excluded():
    # is_airborne missing (NaN) -> treated as airborne, sample skipped
    ctx = _ctx([
        _row(2000, "aaa", 0.0, 0.0, 0.0, air=False),
    ])
    ctx.ticks.loc[0, "is_airborne"] = None
    out = build_heatmap3d(ctx, _RB, SIDS)
    assert out["samples"] == 0
    assert out["cells"] == []


def test_empty_inputs():
    out = build_heatmap3d(_ctx([]), _RB, SIDS)
    assert out["samples"] == 0 and out["cells"] == []
    out2 = build_heatmap3d(_ctx([_row(2000, "aaa", 0, 0, 0)]), SimpleNamespace(rounds=[]), SIDS)
    assert out2["samples"] == 0


def test_missing_columns_raise():
    ctx = SimpleNamespace(ticks=pd.DataFrame({"tick": [1], "steamid": ["aaa"]}))
    try:
        build_heatmap3d(ctx, _RB, SIDS)
        assert False, "expected ValueError"
    except ValueError:
        pass
