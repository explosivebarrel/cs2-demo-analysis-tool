"""Tests for the winprob post-plant model: fuse clock, kits, active defuse."""
from app.pipeline.winprob import compute_winprob

RATE = 64
STEP = 8  # 0.125 s per replay frame at 64 tick

PLANT = 8000  # fallback explosion: 8000 + 40*64 = 10560


class _Ctx:
    tickrate = RATE


class _RB:
    def __init__(self, rounds):
        self.rounds = rounds
        self.ctx = _Ctx()


class _FB:
    def __init__(self, players):
        self.players = players
        self.player_idx = {s: i for i, s in enumerate(players)}


def _player(team="CT", alive=True, hp=100, kit=False, x=0.0, y=0.0, equip=1000):
    # [x, y, z, yaw, hp, armor, alive, wid, flags, team, equip, money, ammo]
    return [x, y, 0.0, 0.0, hp, 0, 1 if alive else 0, 0, 2 if kit else 0,
            3 if team == "CT" else 2, equip, 800, 0]


def _frame(ts=(), cs=()):
    """World state: team lists padded to 5 (dead), CT list first — alive CTs
    keep their positions (indices 5..9, steamids p5..p9). Flat 130 numbers."""
    ts = list(ts) + [_player(team="T", alive=False)] * (5 - len(ts))
    cs = list(cs) + [_player(alive=False)] * (5 - len(cs))
    return [f for p in ts + cs for f in p]


def _at(rounds, frame, tick):
    """winprob at `tick` holding the same world state from frame 0."""
    fb = _FB([f"p{i}" for i in range(10)])
    frames = [frame] * (tick // STEP + 1)
    data = [f for fr in frames for f in fr]
    probs = compute_winprob(fb, _RB(rounds), {"ticks": [i * STEP for i in range(len(frames))],
                                              "data": data})
    return probs[-1]


def _round(**kw):
    r = {"n": 1, "freezeEndTick": 0, "endTick": 300 * RATE, "plantTick": None,
         "explodeTick": None, "defuseTick": None, "beginDefuseTick": None,
         "beginDefuser": None, "defuseKit": False, "plantX": None, "plantY": None}
    r.update(kw)
    return [r]


def test_no_plant_base_heuristic():
    even = _frame(ts=[_player(team="T")] * 5, cs=[_player()] * 5)
    ct_favored = _frame(ts=[_player(team="T")] * 2, cs=[_player()] * 5)
    assert _at(_round(), even, 4000) == 0.5
    assert _at(_round(), ct_favored, 4000) > 0.5


def test_all_t_dead_kit_enough_time():
    # CT with kit standing on the bomb, ~24 s of fuse left
    r = _round(plantTick=PLANT, plantX=1000, plantY=1000)
    f = _frame(cs=[_player(kit=True, x=1000, y=1000)])
    assert _at(r, f, 9000) == 0.95


def test_all_t_dead_no_kit_no_time():
    # no kit, <1 s of fuse left: linear decay floors near 0.05
    r = _round(plantTick=PLANT, plantX=1000, plantY=1000)
    f = _frame(cs=[_player(x=1000, y=1000)])
    assert _at(r, f, 10504) <= 0.15


def test_ct_eta_to_bomb_matters():
    r = _round(plantTick=PLANT, plantX=1000, plantY=1000)
    on_bomb = _frame(cs=[_player(x=1000, y=1000)])
    far = _frame(cs=[_player(x=5000, y=1000)])
    assert _at(r, on_bomb, 9792) == 0.95        # 12 s fuse fits a 10 s defuse
    assert _at(r, far, 9792) < 0.7              # 10 s defuse + 16 s run does not


def test_explosion_real_tick_decides():
    both_alive = _frame(ts=[_player(team="T")] * 5, cs=[_player()] * 5)
    r = _round(plantTick=PLANT, explodeTick=10500)
    assert _at(r, both_alive, 10512) == 0.05    # everyone alive, bomb still wins
    r2 = _round(plantTick=PLANT)                # fallback 40 s timer -> 10560
    assert _at(r2, both_alive, 10568) == 0.05


def test_after_defuse_decided():
    r = _round(plantTick=PLANT, plantX=1000, plantY=1000, defuseTick=9000)
    f = _frame(cs=[_player(kit=True, x=1000, y=1000)])
    # bomb already defused — no stale T boost after the fact
    assert _at(r, f, 9040) == 0.95


def test_active_defuse_kit_vs_no_kit():
    # no-kit defuse started with 8.75 s of fuse: kit finishes (5 s), bare hands
    # do not (10 s > fuse) — while the not-defusing estimate is the same for both
    alive_on_bomb = _frame(cs=[_player(alive=False)] * 4 + [_player(x=1000, y=1000)])
    base = dict(plantTick=PLANT, plantX=1000, plantY=1000,
                beginDefuseTick=10000, beginDefuser="p9")
    assert _at(_round(**base, defuseKit=True), alive_on_bomb, 10016) == 0.95
    assert _at(_round(**base, defuseKit=False), alive_on_bomb, 10016) == 0.05


def test_both_alive_fuse_under_five_seconds():
    # hopeless even with kits: defuse takes 5 s minimum and killing Ts saves nobody
    r = _round(plantTick=PLANT)
    f = _frame(ts=[_player(team="T")] * 5, cs=[_player(kit=True)] * 5)
    assert _at(r, f, 10312) == 0.05


def test_both_alive_kit_band():
    # 8 s of fuse: with a kit still contestable, without one tilted hard to T
    r = _round(plantTick=PLANT)
    f_kit = _frame(ts=[_player(team="T")] * 5, cs=[_player(kit=True)] * 5)
    f_nokit = _frame(ts=[_player(team="T")] * 5, cs=[_player()] * 5)
    p_kit = _at(r, f_kit, 10048)
    p_nokit = _at(r, f_nokit, 10048)
    assert 0.05 < p_kit < 0.5
    assert 0.05 < p_nokit < 0.5
    assert p_kit > p_nokit


def test_defused_voids_fallback_fuse():
    # defused at 9000, no bomb_exploded event: the 40 s fallback (tick 10560)
    # must not "detonate" the defused bomb within the round
    r = _round(plantTick=PLANT, plantX=1000, plantY=1000, defuseTick=9000)
    both = _frame(ts=[_player(team="T")] * 5, cs=[_player()] * 5)
    assert _at(r, both, 10560) == 0.95


def test_freeze_of_next_round_gets_fresh_estimate():
    # round 1 defused, its fallback fuse expires during round 2's freeze:
    # no carried-over 0.95/0.05 there — the reset world is scored fresh
    r1 = _round(plantTick=PLANT, plantX=1000, plantY=1000, defuseTick=9000,
                endTick=10000)
    r2 = {"n": 2, "freezeEndTick": 11000, "endTick": 200 * RATE, "plantTick": None,
          "explodeTick": None, "defuseTick": None, "beginDefuseTick": None,
          "beginDefuser": None, "defuseKit": False, "plantX": None, "plantY": None}
    both = _frame(ts=[_player(team="T")] * 5, cs=[_player()] * 5)
    assert _at(r1 + [r2], both, 10600) == 0.5
