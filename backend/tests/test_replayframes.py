"""Stride-13 frame layout: winprob offsets and heatmap frame_pos must agree."""
from types import SimpleNamespace

from app.pipeline import heatmaps
from app.pipeline.winprob import compute_winprob


def _row(hp, alive, team, equip=0, money=0, ammo=0):
    # [x, y, z, yaw, hp, armor, alive, wid, flags, team, equip, money, ammo]
    return [0, 0, 0, 0, hp, 0, alive, 0, 0, team, equip, money, ammo]


def _replay(rows, ticks=None):
    data = [v for fr in rows for r in fr for v in r]
    return {"ticks": ticks if ticks is not None else [100] * len(rows), "data": data}


class _FB:
    players = ["a", "b", "c", "d"]
    player_idx = {"a": 0, "b": 1, "c": 2, "d": 3}


class _RB:
    rounds = []
    ctx = SimpleNamespace(tickrate=64)


def test_winprob_stride13():
    fb, rb = _FB(), _RB()
    # 2 CT full-HP with rifles vs 2 T half-HP with pistols -> CT favoured
    probs = compute_winprob(fb, rb, _replay([[_row(100, 1, 3, 4000), _row(100, 1, 3, 4000),
                                              _row(50, 1, 2, 1000), _row(50, 1, 2, 1000)]]))
    assert len(probs) == 1 and probs[0] > 0.5

    # nonzero money/ammo in tail fields must not distort the result
    rows = [_row(100, 1, 3, 4000, 4000, 27), _row(100, 1, 3, 4000, 4000, 27),
            _row(50, 1, 2, 1000, 4000, 30), _row(50, 1, 2, 1000, 4000, 30)]
    probs2 = compute_winprob(fb, rb, _replay([rows]))
    assert probs2 == probs


def test_frame_pos_stride13():
    fb = SimpleNamespace(n=2)
    fr0 = [_row(100, 1, 3), _row(100, 1, 2)]
    fr1 = [[111, 222, 0, 0, 100, 0, 1, 0, 0, 3, 0, 0, 0], _row(0, 0, 0)]
    data = [v for fr in (fr0, fr1) for r in fr for v in r]
    assert len(data) == 2 * 2 * 13
    assert heatmaps.frame_pos(fb, {"ticks": [100, 200], "data": data}, 0, 200) == (111, 222, 0)


def test_winprob_post_plant_overrides():
    fb = _FB()
    rb = SimpleNamespace(rounds=[{"n": 1, "freezeEndTick": 0, "plantTick": 50, "endTick": 300}],
                         ctx=SimpleNamespace(tickrate=64))
    ct, t = _row(100, 1, 3, 4000), _row(100, 1, 2, 4000)

    # planted, all T dead, plenty of fuse -> CT defuse
    rows = [ct, ct, _row(0, 0, 2), _row(0, 0, 2)]
    probs = compute_winprob(fb, rb, _replay([rows], ticks=[100]))
    assert probs[0] == 0.95

    # planted, all CT dead -> bomb explodes -> T win
    rows = [_row(0, 0, 3), _row(0, 0, 3), t, t]
    probs = compute_winprob(fb, rb, _replay([rows], ticks=[100]))
    assert probs[0] == 0.05

    # after the real explode/defuse ticks the outcome stays decided
    rb.rounds[0].update(explodeTick=120, defuseTick=None)
    rows = [ct, ct, t, t]
    assert compute_winprob(fb, rb, _replay([rows], ticks=[130]))[0] == 0.05
    rb.rounds[0].update(explodeTick=None, defuseTick=120)
    assert compute_winprob(fb, rb, _replay([rows], ticks=[130]))[0] == 0.95


def test_finalize_bomb_tracks_xyz():
    from app.pipeline.replayframes import FrameBuilder

    class DummyFB:
        n = 2
        players = ["p1", "p2"]
        player_idx = {"p1": 0, "p2": 1}
        rb = SimpleNamespace(rounds=[{"n": 1, "freezeEndTick": 10}])
        finalize_bomb = FrameBuilder.finalize_bomb
        _pos_of = FrameBuilder._pos_of

    fb = DummyFB()

    # 3 frames, 2 players, stride 13
    # frame 0: tick 10, p1 at (100, 200, 10) with flag C4 (flag=1)
    p1_f0 = [100, 200, 10, 0, 100, 0, 1, 0, 1, 2, 0, 0, 0]
    p2_f0 = _row(100, 1, 3)
    # frame 1: tick 20, dropped bomb at (150, 250, 15)
    p1_f1 = [120, 220, 10, 0, 100, 0, 1, 0, 0, 2, 0, 0, 0]
    p2_f1 = _row(100, 1, 3)
    # frame 2: tick 30, planted at (300, 400, 25)
    p1_f2 = [120, 220, 10, 0, 100, 0, 1, 0, 0, 2, 0, 0, 0]
    p2_f2 = _row(100, 1, 3)

    data = [v for fr in ([p1_f0, p2_f0], [p1_f1, p2_f1], [p1_f2, p2_f2]) for r in fr for v in r]
    replay = {"ticks": [10, 20, 30], "data": data}
    events = [
        {"t": 20, "ty": "bo", "x": 150.0, "y": 250.0, "z": 15.0},
        {"t": 30, "ty": "bp", "x": 300.0, "y": 400.0, "z": 25.0, "site": 1},
    ]

    fb.finalize_bomb(replay, events)
    bomb = replay["bomb"]
    assert len(bomb) == 3
    # frame 0: carried by p1 (idx 0)
    assert bomb[0] == [1, 100.0, 200.0, 10.0, 0]
    # frame 1: dropped at (150, 250, 15)
    assert bomb[1] == [2, 150.0, 250.0, 15.0, -1]
    # frame 2: planted at (300, 400, 25)
    assert bomb[2] == [3, 300.0, 400.0, 25.0, -1]
