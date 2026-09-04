"""Win probability curve computed per replay frame.

Uses alive + HP + per-frame equipment value heuristic. Normalised to [0.05, 0.95].
Post-plant: *1.5 boost toward T side (while the bomb is alive).

Post-plant override: once the bomb is planted, a dead T side means the bomb
will explode (CT win chance ~0.05), regardless of remaining CT firepower.
"""


def compute_winprob(fb, rb, replay: dict) -> list[float]:
    """Return a list of ct_prob floats, one per replay frame."""
    n = len(fb.players)
    if n == 0:
        return []

    ticks = replay["ticks"]
    data = replay["data"]
    FIELDS = 13   # [x, y, z, yaw, hp, armor, alive, wid, flags, team_num, equip, money, ammo]
    F_HP    = 4
    F_ALIVE = 6
    F_TEAM  = 9   # team_num: 2=T, 3=CT
    F_EQUIP = 10  # per-frame equipment value

    # planted tick and round end per round for the post-plant window
    plant_info: dict[int, tuple[int, int]] = {}  # n -> (plantTick, endTick)
    for r in rb.rounds:
        pt = r.get("plantTick")
        if pt:
            plant_info[r["n"]] = (pt, r.get("endTick") or 0)

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

        hp_ct = hp_t = 0.0
        alive_ct = alive_t = 0
        equip_ct = equip_t = 0

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
                elif team == 2:  # T
                    hp_t += hp
                    alive_t += 1
                    equip_t += equip

        # bomb planted in the current round and still ticking?
        r = round_at_tick(tick)
        planted = False
        if r is not None:
            info = plant_info.get(r["n"])
            if info and info[0] <= tick <= info[1]:
                planted = True

        # post-plant: with the bomb down, dead T side cannot stop the explosion
        if planted and alive_t == 0:
            probs.append(0.05)
            continue
        if planted and alive_ct == 0:
            probs.append(0.95)
            continue

        # HP contribution: two terms — team size and average HP — so that
        # five 10-HP players do not outweigh one full-HP player
        hp_score_ct = (alive_ct / 5.0) * (hp_ct / (alive_ct * 100.0) if alive_ct else 0.0)
        hp_score_t  = (alive_t / 5.0) * (hp_t  / (alive_t * 100.0)  if alive_t  else 0.0)

        # equipment: AWP team ≈ 4750, full rifle team ≈ ~14k → normalise by 15000/5
        equip_norm = 3000.0
        eq_score_ct = (equip_ct / equip_norm) * (1.0 / 5.0) if alive_ct else 0.0
        eq_score_t  = (equip_t  / equip_norm) * (1.0 / 5.0) if alive_t  else 0.0

        raw_ct = hp_score_ct * 0.55 + eq_score_ct * 0.45
        raw_t  = hp_score_t  * 0.55 + eq_score_t  * 0.45

        # post-plant boost toward T (bomb pressure)
        if planted:
            raw_t *= 1.5

        total = raw_ct + raw_t
        if total < 1e-6:
            prob = 0.5
        else:
            prob = raw_ct / total

        prob = max(0.05, min(0.95, prob))
        probs.append(round(prob, 3))

    return probs
