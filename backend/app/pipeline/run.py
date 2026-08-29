"""Analysis orchestrator: run the whole pipeline and write artifacts."""
import gzip
import json
import os
import time
from collections import defaultdict

import numpy as np

from .. import config, storage
from ..weapons import canon, weapon_id_table
from .context import DemoContext
from .rounds import RoundBuilder
from .replayframes import FrameBuilder
from .players import compute_players, METERS_PER_UNIT
from .rating import compute_ratings
from .heatmaps import build_heatmap
from .events import build_events
from .winprob import compute_winprob


def _gz_write(path, payload):
    tmp = path + ".tmp"
    with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=6) as f:
        json.dump(payload, f, separators=(",", ":"), allow_nan=False)
    os.replace(tmp, path)


def _team_name(rb, team, players):
    from collections import Counter
    clans = Counter(p.clan for p in players if p.team == team and p.clan)
    if clans:
        return clans.most_common(1)[0][0]
    sids = [s for s, t in rb.steamid_team.items() if t == team]
    return f"Team {sids[0]}" if sids else f"Team {team + 1}"


def analyze_demo(demo_path: str, did: str, progress=None):
    prog = progress or (lambda phase, pct: None)
    t0 = time.time()

    ctx = DemoContext(demo_path)
    ctx.load()

    prog("rounds", 62)
    rb = RoundBuilder(ctx)
    rb.rounds = rb.build()

    prog("frames", 70)
    fb = FrameBuilder(ctx, rb)
    replay = fb.build()

    prog("players", 78)
    players = compute_players(ctx, rb, fb)
    compute_ratings(players)

    prog("events", 84)
    ev = build_events(ctx, rb, fb)
    fb.finalize_bomb(replay, ev["events"])

    prog("winprob", 88)
    winprob = compute_winprob(fb, rb, replay)

    prog("heatmaps", 90)
    hm = build_heatmap(ctx, rb, players, fb, replay)

    prog("analytics", 92)
    from .playeranalytics import build_player_analytics
    pa = build_player_analytics(ctx, rb, fb, players)

    prog("writing", 95)
    analysis = _build_analysis(ctx, rb, fb, players)
    replay_payload = {
        "tickrate": ctx.tickrate,
        "frameStep": ctx.frame_step,
        "players": [{"steamid": s, "name": players[s].name, "team": players[s].team}
                    for s in fb.players],
        "ticks": replay["ticks"],
        "data": replay["data"],
        "bomb": replay["bomb"],
        "events": ev["events"],
        "shots": ev["shots"],
        "weapons": weapon_id_table(),
        "winprob": winprob,
    }
    heatmap_payload = {
        "layers": hm,
        "rounds": [{"n": r["n"], "f": r["freezeEndTick"], "e": r["endTick"],
                    "s0": r["sideTeam0"], "w": r["winnerTeam"],
                    "plant": r.get("plantTick")} for r in rb.rounds],
    }

    out_dir = storage.analysis_dir(did)
    os.makedirs(out_dir, exist_ok=True)
    _gz_write(os.path.join(out_dir, "analysis.json.gz"), analysis)
    _gz_write(os.path.join(out_dir, "replay.json.gz"), replay_payload)
    _gz_write(os.path.join(out_dir, "heatmap.json.gz"), heatmap_payload)
    _gz_write(os.path.join(out_dir, "player_analytics.json.gz"), pa)

    prog("done", 100)
    return {
        "rounds": len(rb.rounds),
        "players": len(players),
        "seconds": round(time.time() - t0, 1),
        "map": ctx.header.get("map_name", ""),
        "score": list(rb.final_score),
        "teamNames": [_team_name(rb, 0, list(players.values())),
                      _team_name(rb, 1, list(players.values()))],
    }


# ---------------------------------------------------------------- helpers
def _round_phase(tick, r, tickrate):
    dt = (tick - r["freezeEndTick"]) / tickrate
    if dt < 0:
        return "freeze"
    if dt < config.OPENING_PHASE_SECONDS:
        return "early"
    if dt < config.MID_PHASE_SECONDS:
        return "mid"
    return "late"


def _rws(p, rb, all_players):
    """Round Win Share: avg(player_dmg / team_dmg * 100) over rounds the team won."""
    samples = []
    for r in rb.rounds:
        if r.get("winnerTeam") != p.team:
            continue
        pr = p.rounds.get(r["n"])
        if pr is None:
            continue
        player_dmg = pr["dmg"]
        team_dmg = sum(
            op.rounds[r["n"]]["dmg"]
            for op in all_players.values()
            if op.team == p.team and r["n"] in op.rounds
        )
        if team_dmg > 0:
            samples.append(player_dmg / team_dmg * 100)
    return round(sum(samples) / len(samples), 1) if samples else 0.0


def _imp_round(pr, r_won, opening, is_clutch_won):
    """Simplified impact score for a single round."""
    score = 0.0
    if opening in ("kill", "k"):
        score += 2.0 if r_won else 0.5
    elif opening in ("death", "d"):
        score += -0.5 if r_won else -1.0
    extra_kills = max(0, pr["kills"] - 1)
    score += extra_kills * 0.5
    if is_clutch_won:
        score += 1.5
    if pr["survived"] and not r_won:
        score += 0.2
    return round(score, 2)


def _player_payload(p, rb, fb, ctx, all_players=None):
    rounds = rb.rounds
    R = max(1, len(rounds))
    kills = sum(pr["kills"] for pr in p.rounds.values())
    deaths = sum(pr["deaths"] for pr in p.rounds.values())
    assists = sum(pr["assists"] for pr in p.rounds.values())
    fassists = sum(pr["flashAssists"] for pr in p.rounds.values())
    dmg = sum(pr["dmg"] for pr in p.rounds.values())
    taken = sum(pr["taken"] for pr in p.rounds.values())
    util_dmg = sum(pr["utilDmg"] for pr in p.rounds.values())
    post_plant = sum(pr["postPlantDmg"] for pr in p.rounds.values())
    enemy_flashed = sum(pr["enemyFlashed"] for pr in p.rounds.values())
    blind_sec = sum(pr["blindSec"] for pr in p.rounds.values())
    eff_flashes = sum(pr["effectiveFlashes"] for pr in p.rounds.values())
    hs_kills = sum(1 for w in p.weapons.values() for _ in range(w["hs"]))

    weapons = []
    for raw, w in p.weapons.items():
        en, ru, cls = canon(raw)
        if cls in ("gear", "other") and not w["kills"]:
            continue
        acc = (w["hits"] / w["shots"] * 100.0) if w["shots"] else None
        weapons.append({
            "raw": raw, "en": en, "ru": ru, "cls": cls,
            "kills": w["kills"], "hsKills": w["hs"], "shots": w["shots"],
            "hits": w["hits"], "acc": round(acc, 1) if acc is not None else None,
            "dmg": int(w["dmg"]),
            "hsPct": round(w["hs"] / w["kills"] * 100, 1) if w["kills"] else None,
        })
    weapons.sort(key=lambda w: (-w["kills"], -w["dmg"]))

    clutches_by_x = defaultdict(lambda: {"played": 0, "won": 0})
    for c in p.clutchAttempts:
        b = clutches_by_x[c["enemies"]]
        b["played"] += 1
        b["won"] += 1 if c["won"] else 0

    avg_kill_dist = (sum(p.killDist) / len(p.killDist)) if p.killDist else None

    by_side = {"T": _side_summary(p, rb, "T"), "CT": _side_summary(p, rb, "CT")}

    # per-round series for graphs
    clutch_won_rounds = {c["round"] for c in p.clutchAttempts if c["won"]}
    series = []
    for r in rounds:
        pr = p.rounds.get(r["n"])
        if pr is None:
            continue
        r_won = r.get("winnerTeam") == p.team
        imp = _imp_round(pr, r_won, pr["opening"], r["n"] in clutch_won_rounds)
        series.append({
            "n": r["n"], "k": pr["kills"], "d": pr["deaths"], "a": pr["assists"],
            "dmg": int(pr["dmg"]), "sv": 1 if pr["survived"] else 0,
            "kast": 1 if r["n"] in p.kastRounds else 0,
            "opening": pr["opening"], "mk": pr["kills"] >= 2,
            "pistol": 1 if r.get("isPistol") else 0,
            "mvp": 1 if r.get("mvp") == p.steamid else 0,
            "won": 1 if r_won else 0,
            "imp": imp,
        })

    overall_imp = round(sum(s["imp"] for s in series) / len(series), 2) if series else 0.0

    # RWS: round win share
    rws = _rws(p, rb, all_players) if all_players else 0.0

    first_side = rb.rounds[0]["sides"].get(p.steamid, "?") if rb.rounds else "?"
    return {
        "steamid": p.steamid, "name": p.name, "team": p.team, "clan": p.clan,
        "firstSide": first_side,
        "kills": kills, "deaths": deaths, "assists": assists, "flashAssists": fassists,
        "kd": round(kills / deaths, 2) if deaths else float(kills),
        "kpr": round(kills / R, 2), "dpr": round(deaths / R, 2),
        "apr": round((assists + fassists) / R, 2),
        "adr": round(dmg / R, 1), "udr": round(util_dmg / R, 1),
        "hsPct": round(hs_kills / kills * 100, 1) if kills else None,
        "kast": round(len(p.kastRounds) / R * 100, 1),
        "dmgTaken": int(taken),
        "utilDmg": int(util_dmg), "postPlantDmg": int(post_plant),
        "rating": getattr(p, "rating", 1.0),
        "ratingParts": getattr(p, "ratingParts", {}),
        "opening": {"kills": p.openingKills, "deaths": p.openingDeaths,
                    "attempts": p.openingKills + p.openingDeaths,
                    "success": round(p.openingKills / (p.openingKills + p.openingDeaths) * 100, 1)
                    if (p.openingKills + p.openingDeaths) else None},
        "trades": {"tradeKills": p.tradeKills, "tradedDeaths": p.tradedDeaths},
        "multiKills": {"2k": p.multiKills[2], "3k": p.multiKills[3],
                       "4k": p.multiKills[4], "5k": p.multiKills[5],
                       "rounds": p.multiKillRounds},
        "clutches": {"played": len(p.clutchAttempts), "won": p.clutch_wins(),
                     "byX": {str(k): v for k, v in sorted(clutches_by_x.items())},
                     "list": p.clutchAttempts},
        "flashes": {"thrown": p.flashThrows,
                    "enemiesFlashed": enemy_flashed, "blindSec": round(blind_sec, 1),
                    "effective": eff_flashes,
                    "friendly": p.friendlyFlashed},
        "grenades": {"smokes": p.smokeThrows, "he": p.heThrows, "fire": p.fireThrows,
                     "decoys": p.decoyThrows},
        "bomb": {"plants": p.plants, "defuses": p.defuses,
                 "defuseAttempts": p.defuseAttempts, "kits": p.defuseKits},
        "eco": {"avgSpend": int(p.totalSpend / p.spendSamples) if p.spendSamples else 0,
                "totalSpend": int(p.totalSpend)},
        "movement": {"distanceKm": round(p.distanceUnits * METERS_PER_UNIT / 1000, 2),
                     "aliveSecPerRound": round(p.aliveSeconds / R, 1),
                     "survivalPct": round(sum(1 for pr in p.rounds.values() if pr["survived"]) / R * 100, 1),
                     "saves": p.saves},
        "hitgroups": dict(p.hitgroups),
        "killDist": {"avgM": round(avg_kill_dist * METERS_PER_UNIT, 1) if avg_kill_dist else None,
                     "maxM": round(max(p.killDist) * METERS_PER_UNIT, 1) if p.killDist else None,
                     "buckets": _dist_buckets(p.killDist)},
        "teamDmg": int(p.teamDmg),
        "weapons": weapons,
        "bySide": by_side,
        "series": series,
        "rws": rws,
        "imp": overall_imp,
        "holdsCount": len(p.holds),
    }


def _dist_buckets(dists):
    if not dists:
        return {}
    m = [d * METERS_PER_UNIT for d in dists]
    buckets = [("0-5m", 0, 5), ("5-10m", 5, 10), ("10-20m", 10, 20),
               ("20-30m", 20, 30), ("30m+", 30, 1e9)]
    return {name: sum(1 for x in m if lo <= x < hi) for name, lo, hi in buckets}


def _side_summary(p, rb, side):
    kills = deaths = assists = 0
    dmg = 0.0
    rounds_n = 0
    survived = 0
    for r in rb.rounds:
        if r["sides"].get(p.steamid) != side:
            continue
        rounds_n += 1
        pr = p.rounds.get(r["n"])
        if pr:
            kills += pr["kills"]
            deaths += pr["deaths"]
            assists += pr["assists"] + pr["flashAssists"]
            dmg += pr["dmg"]
            survived += 1 if pr["survived"] else 0
    return {"rounds": rounds_n, "kills": kills, "deaths": deaths,
            "assists": assists, "adr": round(dmg / rounds_n, 1) if rounds_n else 0,
            "kd": round(kills / deaths, 2) if deaths else kills}


def _build_analysis(ctx, rb, fb, players):
    rounds = rb.rounds
    score = rb.final_score
    team_names = [_team_name(rb, 0, list(players.values())),
                  _team_name(rb, 1, list(players.values()))]

    players_payload = []
    for sid in fb.players:
        p = players.get(sid)
        if p:
            players_payload.append(_player_payload(p, rb, fb, ctx, all_players=players))
    players_payload.sort(key=lambda x: -x["rating"])

    # team aggregates
    teams = []
    for t in (0, 1):
        tp = [pp for pp in players_payload if pp["team"] == t]
        n = len(tp)
        won_pistols = sum(1 for r in rounds if r["winnerTeam"] == t and r["isPistol"])
        first_kills = sum(1 for r in rounds
                          if r.get("openingKill") and r["openingKill"].get("attackerTeam") == t)
        teams.append({
            "name": team_names[t], "players": n,
            "score": score[t],
            "kills": sum(x["kills"] for x in tp),
            "deaths": sum(x["deaths"] for x in tp),
            "assists": sum(x["assists"] for x in tp),
            "adr": round(sum(x["adr"] for x in tp) / n, 1) if n else 0,
            "kast": round(sum(x["kast"] for x in tp) / n, 1) if n else 0,
            "rating": round(sum(x["rating"] for x in tp) / n, 2) if n else 0,
            "hsPct": round(sum(x["hsPct"] or 0 for x in tp) / n, 1) if n else 0,
            "utilDmg": sum(x["utilDmg"] for x in tp),
            "pistolRoundsWon": won_pistols,
            "firstKills": first_kills,
            "clutchesWon": sum(x["clutches"]["won"] for x in tp),
        })

    rounds_payload = []
    for r in rounds:
        rounds_payload.append({
            "n": r["n"], "freezeEndTick": r["freezeEndTick"], "endTick": r["endTick"],
            "durSec": round((r["endTick"] - r["freezeEndTick"]) / ctx.tickrate, 1),
            "winnerTeam": r["winnerTeam"], "reason": r["reason"],
            "sideTeam0": r["sideTeam0"],
            "scoreTeam0": r["scoreTeam0"], "scoreTeam1": r["scoreTeam1"],
            "isPistol": r["isPistol"],
            "buyTeam0": r["buyTeam0"], "buyTeam1": r["buyTeam1"],
            "spendTeam0": r["spendTeam0"], "spendTeam1": r["spendTeam1"],
            "avgSpendTeam0": r.get("avgSpendTeam0", 0), "avgSpendTeam1": r.get("avgSpendTeam1", 0),
            "bombPlanted": r["bombPlanted"], "bombSite": r.get("bombSite"),
            "planter": r.get("planter"), "defuser": r.get("defuser"),
            "mvp": r.get("mvp"),
            "openingKill": r.get("openingKill"),
        })

    halves = _halves(rb, ctx)

    meta = {
        "map": ctx.header.get("map_name", "?"),
        "server": ctx.header.get("server_name", ""),
        "tickrate": ctx.tickrate,
        "maxTick": ctx.max_tick,
        "durationSec": round(rb.match_end / ctx.tickrate, 0),
        "rounds": len(rounds),
        "score": score,
        "teamNames": team_names,
        "matchStartTick": rb.match_start,
        "matchEndTick": rb.match_end,
        "firstSideTeam0": "T" if getattr(rb, "team0_first_side_t", True) else "CT",
    }

    kill_feed = []  # (kill feed lives in replay events; analysis keeps aggregates)

    return {
        "meta": meta,
        "teams": teams,
        "players": players_payload,
        "rounds": rounds_payload,
        "halves": halves,
        "weapons": weapon_id_table(),
    }


def _halves(rb, ctx):
    """Half boundaries (side swaps) for UI grouping."""
    halves = []
    if not rb.rounds:
        return halves
    cur_side = rb.rounds[0]["sideTeam0"]
    start_n = 1
    score0 = score1 = 0
    for r in rb.rounds:
        score0 += 1 if r["winnerTeam"] == 0 else 0
        score1 += 1 if r["winnerTeam"] == 1 else 0
        nxt = rb.rounds[r["n"]] if r["n"] < len(rb.rounds) else None
        if nxt is None or nxt["sideTeam0"] != cur_side:
            halves.append({"from": start_n, "to": r["n"], "sideTeam0": cur_side,
                           "score0": score0, "score1": score1})
            if nxt is not None:
                start_n = nxt["n"]
                cur_side = nxt["sideTeam0"]
    return halves
