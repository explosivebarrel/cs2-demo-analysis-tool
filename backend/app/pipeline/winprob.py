"""Win probability curve computed per replay frame.

Uses alive + HP + per-frame equipment value heuristic. Normalised to [0.05, 0.95].

Post-plant the bomb clock dominates: once the C4 is down the CT side can only
win by defusing, so the curve is driven by the remaining fuse time vs the
defuse time (5 s with a kit, 10 s without). Determined outcomes collapse to
the clamped plateaus: bomb explodes -> 0.05, defuse done (or guaranteed) -> 0.95.
A hopeless situation (fuse < 5 s, both sides alive, nobody defusing) is already
a T win — killing the Ts does not stop the bomb.
"""


BOMB_TIMER = 40.0        # seconds from plant to explosion
DEFUSE_KIT = 5.0         # defuse seconds with a kit
DEFUSE_NO_KIT = 10.0     # defuse seconds without a kit
CT_SPEED = 250.0         # units/sec run speed, for ETA to the bomb


def compute_winprob(fb, rb, replay: dict) -> list[float]:
    """Return a list of ct_prob floats, one per replay frame."""
    n = len(fb.players)
    if n == 0:
        return []

    ticks = replay["ticks"]
    data = replay["data"]
    FIELDS = 13   # [x, y, z, yaw, hp, armor, alive, wid, flags, team_num, equip, money, ammo]
    F_X     = 0
    F_Y     = 1
    F_HP    = 4
    F_ALIVE = 6
    F_FLAGS = 8   # bit1 = carries C4, bit2 = has defuse kit
    F_TEAM  = 9   # team_num: 2=T, 3=CT
    F_EQUIP = 10  # per-frame equipment value

    rate = max(1.0, float(rb.ctx.tickrate))

    # per-round bomb clock: (plantTick, explodeTick, defuseTick, beginDefuseTick,
    # beginDefuser, beginKit, plantX, plantY)
    bombs: dict[int, dict] = {}
    for r in rb.rounds:
        pt = r.get("plantTick")
        if not pt:
            continue
        bombs[r["n"]] = {
            "plant": pt,
            "explode": r.get("explodeTick") or int(pt + BOMB_TIMER * rate),
            "defused": r.get("defuseTick"),
            "begin": r.get("beginDefuseTick"),
            "defuser": r.get("beginDefuser"),
            "kit": bool(r.get("defuseKit")),
            "x": r.get("plantX"),
            "y": r.get("plantY"),
        }

    def round_at_tick(t: int):
        cur = None
        for r in rb.rounds:
            if r["freezeEndTick"] <= t:
                cur = r
            else:
                break
        return cur

    probs: list[float] = []
    for fi, tick in enumerate(ticks):
        base = fi * n * FIELDS
        if base + n * FIELDS > len(data):
            probs.append(0.5)
            continue

        # bomb planted in the current round and still ticking? The window is
        # bounded by the round's end: during the NEXT round's freeze the world
        # is already reset and must get a fresh estimate, not a carried-over
        # decided state. A defuse voids the fallback fuse (the bomb cannot
        # explode after being defused), so it is checked before the explosion.
        r = round_at_tick(tick)
        bomb = bombs.get(r["n"]) if r is not None else None
        end = r.get("endTick") if r is not None else 0
        planted = bool(bomb and bomb["plant"] <= tick and (not end or tick <= end))

        hp_ct = hp_t = 0.0
        alive_ct = alive_t = 0
        equip_ct = equip_t = 0
        kit_ct = False
        ct_dist2 = []   # squared distance of living CTs to the planted bomb

        for i in range(n):
            b = base + i * FIELDS
            alive = data[b + F_ALIVE]
            hp = data[b + F_HP]
            team = data[b + F_TEAM]  # 2=T, 3=CT
            equip = data[b + F_EQUIP] if len(data) > b + F_EQUIP else 0
            if alive and hp > 0:
                if team == 3:   # CT
                    hp_ct += hp
                    alive_ct += 1
                    equip_ct += equip
                    if data[b + F_FLAGS] & 2:
                        kit_ct = True
                    if bomb and bomb["x"] is not None and bomb["y"] is not None:
                        dx = data[b + F_X] - bomb["x"]
                        dy = data[b + F_Y] - bomb["y"]
                        ct_dist2.append(dx * dx + dy * dy)
                elif team == 2:  # T
                    hp_t += hp
                    alive_t += 1
                    equip_t += equip

        # determined outcomes first — a done defuse beats the fuse clock
        # (explodeTick is often absent when defused, and the 40 s fallback
        # must not "detonate" an already-defused bomb)
        if planted and bomb["defused"] and tick >= bomb["defused"]:
            probs.append(0.95)
            continue
        if planted and bomb["explode"] <= tick:
            probs.append(0.05)
            continue
        if planted and alive_ct == 0:
            probs.append(0.05)   # nobody left to defuse -> T win
            continue

        if planted and alive_t == 0:
            # the CTs must defuse: fuse time vs defuse time decides
            time_left = (bomb["explode"] - tick) / rate
            if (bomb["begin"] and tick >= bomb["begin"]
                    and (not bomb["defused"] or tick < bomb["defused"])):
                idx = fb.player_idx.get(bomb["defuser"]) if bomb["defuser"] else None
                if idx is not None and data[base + idx * FIELDS + F_ALIVE]:
                    need = DEFUSE_KIT if bomb["kit"] else DEFUSE_NO_KIT
                    probs.append(0.95 if bomb["begin"] + need * rate <= bomb["explode"] else 0.05)
                    continue
            need = (DEFUSE_KIT if kit_ct else DEFUSE_NO_KIT)
            if ct_dist2:
                need += (min(ct_dist2) ** 0.5) / CT_SPEED
            probs.append(0.95 if time_left >= need else max(0.05, 0.95 * time_left / need))
            continue

        # HP contribution: two terms — team size and average HP — so that
        # five 10-HP players do not outweigh one full-HP player
        hp_score_ct = (alive_ct / 5.0) * (hp_ct / (alive_ct * 100.0) if alive_ct else 0.0)
        hp_score_t  = (alive_t / 5.0) * (hp_t  / (alive_t * 100.0)  if alive_t else 0.0)

        # equipment: AWP team ≈ 4750, full rifle team ≈ ~14k → normalise by 15000/5
        equip_norm = 3000.0
        eq_score_ct = (equip_ct / equip_norm) * (1.0 / 5.0) if alive_ct else 0.0
        eq_score_t  = (equip_t  / equip_norm) * (1.0 / 5.0) if alive_t else 0.0

        raw_ct = hp_score_ct * 0.55 + eq_score_ct * 0.45
        raw_t  = hp_score_t  * 0.55 + eq_score_t  * 0.45

        # post-plant: only a defuse wins for CT, so the fuse clock tilts the
        # curve toward T; under 5 s not even a kit in hand makes it in time
        boost = 1.0
        if planted:
            time_left = (bomb["explode"] - tick) / rate
            if time_left < DEFUSE_KIT:
                probs.append(0.05)
                continue
            if time_left < DEFUSE_NO_KIT:
                boost = 1.8 if kit_ct else 2.2

        raw_t *= boost

        total = raw_ct + raw_t
        if total < 1e-6:
            prob = 0.5
        else:
            prob = raw_ct / total

        prob = max(0.05, min(0.95, prob))
        probs.append(round(prob, 3))

    return probs
