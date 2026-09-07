"""Metric audit: internal-consistency check of analysis vs player_analytics.

Read-only: loads the two artifacts for a demo and recomputes every derived
metric from its own primitive fields, reporting any disagreement.

Usage (inside backend container or with backend on path):
    python scripts/audit_metrics.py <demo_id> [data_dir]
"""
import gzip
import json
import os
import sys


def _load(data_dir, did):
    base = os.path.join(data_dir, "analyses", did)
    with gzip.open(os.path.join(base, "analysis.json.gz"), "rt", encoding="utf-8") as f:
        analysis = json.load(f)
    with gzip.open(os.path.join(base, "player_analytics.json.gz"), "rt", encoding="utf-8") as f:
        pa = json.load(f)
    return analysis, pa


def _round(v, digits=1):
    return None if v is None else round(v, digits)


def audit_player(name, pl, block, issues):
    m = block["metrics"]
    duels = block["duels"]
    series = pl["series"]
    rounds_n = len(series) or 1

    def check(label, expected, actual, tol=0.05):
        if expected is None or actual is None:
            return
        if abs(expected - actual) > tol:
            issues.append(f"{name}: {label}: artifact={actual}, recomputed={expected}")

    kills = pl["kills"]
    deaths = pl["deaths"]

    # --- trades (post-fix invariant: counter == ticks == tagged duels)
    tk_ticks = len(m["tradeKillTicks"])
    tk_duels = sum(1 for d in duels if d.get("isTradeKill"))
    if pl["trades"]["tradeKills"] != tk_ticks or tk_ticks != tk_duels:
        issues.append(f"{name}: tradeKills counter={pl['trades']['tradeKills']}, "
                      f"ticks={tk_ticks}, tagged duels={tk_duels}")
    td_ticks = len(m["tradedDeathTicks"])
    td_duels = sum(1 for d in duels if d.get("isTradedDeath"))
    if pl["trades"]["tradedDeaths"] != td_ticks or td_ticks != td_duels:
        issues.append(f"{name}: tradedDeaths counter={pl['trades']['tradedDeaths']}, "
                      f"ticks={td_ticks}, tagged duels={td_duels}")
    check("tradeKillPct", _round(pl["trades"]["tradeKills"] / kills * 100) if kills else 0.0,
          m["tradeKillPct"])
    check("tradedDeathPct", _round(pl["trades"]["tradedDeaths"] / deaths * 100) if deaths else 0.0,
          m["tradedDeathPct"])

    # --- opening / clutch / flash
    op = pl["opening"]
    op_exp = _round(op["kills"] / (op["kills"] + op["deaths"]) * 100) if (op["kills"] + op["deaths"]) else 0.0
    check("openingWinPct", op_exp, m["openingWinPct"])
    cl = pl["clutches"]
    check("clutchWinPct", _round(cl["won"] / cl["played"] * 100) if cl["played"] else 0.0,
          m["clutchWinPct"])
    fl = pl["flashes"]
    check("flashEfficiency", _round(fl["effective"] / fl["thrown"] * 100) if fl["thrown"] else 0.0,
          m["flashEfficiency"])

    # --- KAST: series flag vs reported vs recomputation.
    # kastRounds also credits flash-assist-only rounds, which the series
    # payload cannot express (its `a` flag is assists-only), so the artifact
    # may legitimately exceed the recomputation by that many rounds.
    traded_rounds = set(m["tradedDeathRounds"])
    kast_by_flag = round(sum(1 for s in series if s["kast"]) / rounds_n * 100, 1)
    check("kast(series flag)", kast_by_flag, pl["kast"])
    kast_recomputed = round(sum(
        1 for s in series if s["k"] or s["a"] or s["sv"] or s["n"] in traded_rounds
    ) / rounds_n * 100, 1)
    fa_only = sum(
        1 for s in series
        if s["kast"] and not (s["k"] or s["a"] or s["sv"] or s["n"] in traded_rounds))
    if not (kast_recomputed <= pl["kast"] <= kast_recomputed + round(fa_only / rounds_n * 100, 1)):
        issues.append(f"{name}: kast artifact={pl['kast']}, recomputed={kast_recomputed} "
                      f"(flag={kast_by_flag}, fa-only rounds={fa_only})")

    # --- basics from series
    check("kills(series)", sum(s["k"] for s in series), kills, 0)
    check("deaths(series)", sum(s["d"] for s in series), deaths, 0)
    check("adr", _round(sum(s["dmg"] for s in series) / rounds_n), pl["adr"])
    if deaths:
        check("kd", _round(kills / deaths, 2), pl["kd"], 0.011)

    # --- hsPct vs weapons table
    hs_sum = sum(w["hsKills"] for w in pl["weapons"] if w["kills"])
    if kills:
        check("hsPct(weapons)", _round(hs_sum / kills * 100), pl["hsPct"])

    # --- duel population vs kills/deaths. Duels exclude suicides/teamkill
    # deaths and out-of-round kills, so equality holds only on demos without
    # them; the honest invariant is a subset relation.
    won = sum(1 for d in duels if d["won"])
    lost = sum(1 for d in duels if not d["won"])
    if won > kills:
        issues.append(f"{name}: duels won={won} > kills={kills}")
    if lost > deaths:
        issues.append(f"{name}: duels lost={lost} > deaths={deaths}")

    # --- discipline percentages recomputed from duels
    won_duels = [d for d in duels if d["won"]]
    shift_exp = _round(sum(1 for d in won_duels if d.get("context", {}).get("attackerWalking"))
                       / len(won_duels) * 100) if won_duels else 0.0
    check("shiftPeekPct", shift_exp, m["shiftPeekPct"])
    iso_exp = _round(sum(1 for d in duels if "isolated" in d["errors"]) / len(duels) * 100) if duels else 0.0
    check("isolatedPct", iso_exp, m["isolatedPct"])
    # frontend ProbBar movingShotPct uses the same formula — nothing to compare

    # --- overshoot: card counter must equal the duel tags the page lists
    ov_tags = sum(1 for d in duels if "overshoot" in d["errors"])
    if m["overshootCount"] != ov_tags:
        issues.append(f"{name}: overshootCount={m['overshootCount']} != duel tags={ov_tags}")

    # --- excellent contacts: counter == ticks (when present) == tagged duels
    ec_ticks = m.get("excellentContactTicks")
    if ec_ticks is not None:
        ec_duels = sum(1 for d in duels if d.get("tick") in set(ec_ticks))
        if m["excellentContacts"] != len(ec_ticks) or len(ec_ticks) != ec_duels:
            issues.append(f"{name}: excellentContacts={m['excellentContacts']}, "
                          f"ticks={len(ec_ticks)}, tagged duels={ec_duels}")

    # --- aim block internal consistency
    fbs = m["firstBulletShots"]
    if fbs:
        fb_exp = _round(sum(1 for s in fbs if s["hit"]) / len(fbs) * 100)
        check("firstBulletAcc(shots)", fb_exp, m["firstBulletAcc"])
        bad_rounds = [s for s in fbs if not s["round"]]
        if bad_rounds:
            issues.append(f"{name}: firstBulletShots with round=0: {len(bad_rounds)}/{len(fbs)}")
    if m["reactionDeltas"]:
        check("reactionTimeMs(avg deltas)", _round(sum(m["reactionDeltas"]) / len(m["reactionDeltas"])),
              m["reactionTimeMs"])
    if m["reactionDeltasHit"]:
        check("successfulReactionTimeMs", _round(sum(m["reactionDeltasHit"]) / len(m["reactionDeltasHit"])),
              m["successfulReactionTimeMs"])
    phase_sum = sum(m.get("angleControlByPhase", {}).values())
    if phase_sum and phase_sum != m["angleControlCount"]:
        issues.append(f"{name}: angleControlCount={m['angleControlCount']} != byPhase sum={phase_sum}")

    # --- teamkills: counter == ticks == episodes; rounds match tick rounds
    tk_count = m.get("teamKills", 0)
    tk_ep = block.get("teamKills", [])
    tk_ticks_list = m.get("teamKillTicks", [])
    if tk_count != len(tk_ticks_list) or len(tk_ticks_list) != len(tk_ep):
        issues.append(f"{name}: teamKills counter={tk_count}, ticks={len(tk_ticks_list)}, "
                      f"episodes={len(tk_ep)}")
    if sorted(tk_ticks_list) != sorted(e["tick"] for e in tk_ep):
        issues.append(f"{name}: teamKillTicks mismatch vs episode ticks")

    # --- impact
    imp = block["impact"]
    srt = sorted(series, key=lambda s: s["imp"], reverse=True)
    exp_pos = [s["n"] for s in srt[:3] if s["imp"] > 0]
    if [x["n"] for x in imp["topRoundsPositive"]] != exp_pos:
        issues.append(f"{name}: topRoundsPositive mismatch")

    # --- winProb on duels: present and within clamp
    wp_bad = [d for d in duels if d.get("winProb") is not None and not (0.05 <= d["winProb"] <= 0.95)]
    if wp_bad:
        issues.append(f"{name}: {len(wp_bad)} duels with winProb out of clamp")


def main():
    did = sys.argv[1]
    data_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "data", "store")
    # container layout: /data/store/store/analyses
    for candidate in (data_dir, os.path.join(data_dir, "store")):
        if os.path.isdir(os.path.join(candidate, "analyses", did)):
            data_dir = candidate
            break
    analysis, pa = _load(data_dir, did)
    an = {p["steamid"]: p for p in analysis["players"]}
    issues: list[str] = []
    for sid, block in pa.items():
        pl = an.get(sid)
        if pl is None:
            issues.append(f"{sid}: in player_analytics but not in analysis")
            continue
        audit_player(pl["name"], pl, block, issues)

    # --- match-level teamkills: every entry must be an attacker episode of some player
    mtks = analysis.get("teamKills")
    if mtks is not None:
        per_player = {(e["attacker"], e["tick"]): e for b in pa.values() for e in b.get("teamKills", [])}
        for t in mtks:
            if (t["attacker"], t["tick"]) not in per_player:
                issues.append(f"match teamkill R{t['round']} tick={t['tick']} "
                              f"attacker={t['attacker']}: no matching player episode")
        attacker_eps = sum(len(b.get("teamKills", [])) for b in pa.values())
        if len(mtks) != attacker_eps:
            issues.append(f"match teamKills={len(mtks)} != sum of player attacker episodes={attacker_eps}")

    print(f"demo {did}: {len(pa)} players checked")
    if issues:
        print(f"--- {len(issues)} issues ---")
        for i in issues:
            print(" ", i)
    else:
        print("ALL INTERNAL CHECKS PASSED")


if __name__ == "__main__":
    main()
