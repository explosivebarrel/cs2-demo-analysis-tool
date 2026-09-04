"""Rating 2.1 approximation.

The real HLTV formula is private; this is a documented community-style
approximation: five sub-ratings (kill, survival, damage, KAST, impact)
normalized to a mean of 1.00 across the match, combined by fixed weights."""

from .. import config


def _safe_div(a, b):
    return a / b if b else 0.0


def _normalize(vals):
    """Scale so mean == 1.0 (guard zero)."""
    vals = [max(v, 0.0) for v in vals]
    mean = sum(vals) / len(vals) if vals else 1.0
    if mean <= 0:
        return [1.0] * len(vals)
    return [v / mean for v in vals]


def compute_ratings(players: dict):
    n = len(players)
    if n == 0:
        return

    kill_raw, surv_raw, dmg_raw, kast_raw, impact_raw = [], [], [], [], []

    for p in players.values():
        R = max(p.rounds_played(), 1)
        # ---- kill: base weight 1, +0.5 opening, +0.25 perfect (no return dmg)
        w = 0.0
        for pr in p.rounds.values():
            w += pr["kills"]
        w += 0.5 * p.openingKills
        perfect = sum(pr.get("dmglessKill", 0) for pr in p.rounds.values())
        w += 0.25 * perfect
        kill_raw.append(_safe_div(w, R))
        # ---- survival: untraded death = 1.0, traded = 0.6, opening = +0.4 extra
        deaths = sum(pr["deaths"] for pr in p.rounds.values())
        pen = deaths
        pen -= 0.4 * p.tradedDeaths            # traded deaths hurt less
        pen += 0.4 * p.openingDeaths           # opening deaths hurt more
        surv_raw.append(_safe_div(R - max(pen, 0.0), R))
        # ---- damage
        adr = _safe_div(sum(pr["dmg"] for pr in p.rounds.values()), R)
        dmg_raw.append(adr)
        # ---- kast
        kast_raw.append(_safe_div(len(p.kastRounds), R))
        # ---- impact: multikill rounds *2 + clutch wins + opening kills
        imp = p.multiKillRounds * 2.0 + p.clutch_wins() + p.openingKills
        impact_raw.append(_safe_div(imp, R))

    kill_n = _normalize(kill_raw)
    surv_n = _normalize(surv_raw)
    dmg_n = _normalize([v / 75.0 for v in dmg_raw])   # 75 ADR ~ baseline
    kast_n = _normalize([v / 0.72 for v in kast_raw])  # 72% ~ baseline
    impact_n = _normalize(impact_raw)

    w = config.RATING_WEIGHTS
    for p, kr, sr, dr, kar, ir in zip(players.values(), kill_n, surv_n, dmg_n, kast_n, impact_n):
        p.ratingParts = {"kill": round(kr, 3), "survival": round(sr, 3),
                         "damage": round(dr, 3), "kast": round(kar, 3),
                         "impact": round(ir, 3)}
        p.rating = round(kr * w["kill"] + sr * w["survival"] + dr * w["damage"]
                         + kar * w["kast"] + ir * w["impact"], 3)
