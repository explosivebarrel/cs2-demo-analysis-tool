"""Win probability curve computed per replay frame.

Uses a simple alive+HP+equipment heuristic. Normalised to [0.05, 0.95].
Post-plant: +0.30 boost toward T side.
"""
import numpy as np


def compute_winprob(fb, rb, replay: dict) -> list[float]:
    """Return a list of ct_prob floats, one per replay frame."""
    n = len(fb.players)
    if n == 0:
        return []

    ticks = replay["ticks"]
    data = replay["data"]
    FIELDS = 10
    F_HP = 4
    F_ALIVE = 6
    F_TEAM = 8

    # build set of planted ticks per round for post-plant flag
    plant_ticks: dict[int, int] = {}  # round_n -> plantTick
    for r in rb.rounds:
        pt = r.get("plantTick")
        if pt:
            plant_ticks[r["n"]] = pt

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

        for i in range(n):
            b = base + i * FIELDS
            alive = data[b + F_ALIVE]
            hp = data[b + F_HP]
            team = data[b + F_TEAM]
            if alive and hp > 0:
                if team == 1:       # team index 1 = CT in TEAM_COLORS mapping
                    hp_ct += hp
                    alive_ct += 1
                elif team == 0:     # team index 0 = T
                    hp_t += hp
                    alive_t += 1

        raw_ct = alive_ct * hp_ct * 0.6
        raw_t = alive_t * hp_t * 0.6

        # add equipment value weight
        r = round_at_tick(tick)
        if r is not None:
            raw_ct += r.get("spendTeam0", 0) * 0.4 if r.get("sideTeam0") == "CT" else r.get("spendTeam1", 0) * 0.4
            raw_t += r.get("spendTeam1", 0) * 0.4 if r.get("sideTeam0") == "CT" else r.get("spendTeam0", 0) * 0.4

            # post-plant boost toward T
            rn = r["n"]
            if rn in plant_ticks and tick >= plant_ticks[rn]:
                raw_t *= 1.5

        total = raw_ct + raw_t
        if total < 1e-6:
            prob = 0.5
        else:
            prob = raw_ct / total

        # clamp and round
        prob = max(0.05, min(0.95, prob))
        probs.append(round(prob, 3))

    return probs
