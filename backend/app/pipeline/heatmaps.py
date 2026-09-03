"""Heatmap layer extraction.

Every point is a compact float list so the client can filter by player /
side / half / round-phase on its own. Layer schemas (indices):

kills/deaths/opening_duels: [ax, ay, vx, vy, pIdx, tick, flags]
    flags: 1 headshot, 2 penetrated, 4 thrusmoke, 8 noscore,
           16 won-duel (opening_duels)
damage/damage_taken: [x, y, dmg, pIdx, tick]
shots:            [x, y, pIdx, tick]
flash_throws/smokes/hes/molotovs: [x, y, pIdx, tick]
flash_hits:       [x, y, blindSec, throwerIdx, tick]
plants/defuses:   [x, y, pIdx, tick]
clutches:         [x, y, enemies, pIdx, tick, won]
holds:            [x, y, durSec, pIdx, roundStartTick, round]
positions:        [x, y, z, round, pIdx]
"""
import numpy as np


def _f(v):
    try:
        fv = float(v)
    except (TypeError, ValueError):
        return 0.0
    return round(fv, 1) if abs(fv) < 1e6 else 0.0


def _ok(v):
    return v is not None and v == v  # not NaN/None


def build_heatmap(ctx, rb, players, fb, replay):
    pidx = fb.player_idx
    layers: dict[str, list] = {}

    def add(layer, *point):
        layers.setdefault(layer, []).append([_f(v) for v in point])

    def sid_i(sid):
        return pidx.get(str(sid), -1)

    kills = ctx.ev("player_death")
    if len(kills):
        open_by_round = {r["n"]: r.get("openingKill") for r in rb.rounds}
        # tick -> round via searchsorted on freezeEnd ticks
        fe = np.array([r["freezeEndTick"] for r in rb.rounds], dtype="int64")
        for _, k in kills.iterrows():
            a, v = k.get("attacker_steamid"), k.get("user_steamid")
            if not (_ok(a) and _ok(v)):
                continue
            t = int(k["tick"])
            flags = (1 if k.get("headshot") else 0) | (2 if k.get("penetrated") else 0) \
                    | (4 if k.get("thrusmoke") else 0) | (8 if k.get("noscope") else 0)
            add("kills", k.get("attacker_X"), k.get("attacker_Y"),
                k.get("user_X"), k.get("user_Y"), sid_i(a), t, flags)
            add("deaths", k.get("user_X"), k.get("user_Y"),
                k.get("attacker_X"), k.get("attacker_Y"), sid_i(v), t, flags)
            ri = int(np.searchsorted(fe, t, side="right")) - 1
            if ri >= 0 and open_by_round.get(rb.rounds[ri]["n"]) and \
                    open_by_round[rb.rounds[ri]["n"]]["tick"] == t:
                okd = open_by_round[rb.rounds[ri]["n"]]
                won = 1 if okd.get("attackerTeam") == rb.rounds[ri]["winnerTeam"] else 0
                add("opening_duels", k.get("attacker_X"), k.get("attacker_Y"),
                    k.get("user_X"), k.get("user_Y"), sid_i(a), t, flags | (16 if won else 0))

    hurt = ctx.ev("player_hurt")
    if len(hurt):
        for _, h in hurt.iterrows():
            a, v = h.get("attacker_steamid"), h.get("user_steamid")
            if not (_ok(a) and _ok(v)):
                continue
            dmg = float(h.get("dmg_health", 0) or 0)
            add("damage", h.get("attacker_X"), h.get("attacker_Y"), dmg, sid_i(a), int(h["tick"]))
            add("damage_taken", h.get("user_X"), h.get("user_Y"), dmg, sid_i(v), int(h["tick"]))

    shots = ctx.ev("weapon_fire")
    if len(shots):
        for _, s in shots.iterrows():
            a = s.get("user_steamid")
            if not _ok(a):
                continue
            add("shots", s.get("user_X"), s.get("user_Y"), sid_i(a), int(s["tick"]))

    for ev_name, layer in (("flashbang_detonate", "flash_throws"),
                           ("smokegrenade_detonate", "smokes"),
                           ("hegrenade_detonate", "hes"),
                           ("inferno_startburn", "molotovs")):
        ev = ctx.ev(ev_name)
        for _, e in ev.iterrows():
            add(layer, e.get("x"), e.get("y"), sid_i(e.get("user_steamid")), int(e["tick"]))

    blinds = ctx.ev("player_blind")
    if len(blinds):
        for _, b in blinds.iterrows():
            dur = float(b.get("blind_duration", 0) or 0)
            if dur < 0.5:
                continue
            add("flash_hits", b.get("user_X"), b.get("user_Y"), dur,
                sid_i(b.get("attacker_steamid")), int(b["tick"]))

    for _, p in ctx.ev("bomb_planted").iterrows():
        add("plants", p.get("user_X"), p.get("user_Y"), sid_i(p.get("user_steamid")), int(p["tick"]))
    for _, p in ctx.ev("bomb_defused").iterrows():
        add("defuses", p.get("user_X"), p.get("user_Y"), sid_i(p.get("user_steamid")), int(p["tick"]))

    # clutches: clutch player position at clutch start (from replay frames)
    for c in fb.clutch.attempts:
        idx = pidx.get(c["player"], -1)
        if idx < 0:
            continue
        pos = frame_pos(fb, replay, idx, c["t0"])
        add("clutches", pos[0], pos[1], c.get("maxEnemies", 0), idx, int(c["t0"]),
            1 if c.get("won") else 0)

    # long holds: [x, y, durSec, pIdx, roundStartTick, round]
    rounds_by_n = {r["n"]: r for r in rb.rounds}
    for sid, p in players.items():
        for (x, y, dur, rnd) in p.holds:
            rr = rounds_by_n.get(rnd)
            if rr:
                add("holds", x, y, dur, pidx.get(sid, -1), rr["freezeEndTick"], rnd)

    # movement density (already downsampled by FrameBuilder)
    for sid, p in players.items():
        i = pidx.get(sid, -1)
        for (x, y, z, rnd) in p.positions:
            layers.setdefault("positions", []).append([_f(x), _f(y), _f(z), rnd, i])

    return layers


def frame_pos(fb, replay, idx, tick):
    """Player world position at nearest replay frame <= tick."""
    import bisect
    ticks = replay["ticks"]
    data = replay["data"]
    fi = bisect.bisect_right(ticks, tick) - 1
    if fi < 0:
        fi = 0
    base = fi * fb.n * 10
    return (data[base + idx * 10], data[base + idx * 10 + 1])
