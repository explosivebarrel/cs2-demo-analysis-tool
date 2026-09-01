"""Per-player deep analytics: duel classification, overview metrics,
impact block, and map events.

Produces player_analytics.json.gz — a dict keyed by steamid.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from .aim_mechanics import compute_aim_mechanics

# ------------------------------------------------------------------ constants

ERROR_GROUPS = {
    "shift_peek": "Пик на шифте",
    "moving_shot": "Ошибка движения",
    "isolated": "Игра в изоляции",
    "flashed": "Вышел на флеше",
    "strong_duel": "Сильная дуэль",
}


def _sid(v) -> str | None:
    if v is None:
        return None
    s = str(v)
    return s if s and s not in ("None", "nan", "0") else None


def _f(v, default: float = 0.0) -> float:
    try:
        fv = float(v)
        return fv if fv == fv else default  # NaN check
    except (TypeError, ValueError):
        return default


# ------------------------------------------------------------------ tick helpers

def _build_vel_lookup(ticks_df, tickrate: float) -> dict:
    """Build (tick, steamid) -> velocity (u/s) lookup from full ticks DataFrame."""
    try:
        pos = ticks_df[["tick", "steamid", "X", "Y"]].copy()
        pos["steamid"] = pos["steamid"].astype(str)
        pos = pos.sort_values(["steamid", "tick"])
        pos["dx"] = pos.groupby("steamid")["X"].diff().fillna(0.0)
        pos["dy"] = pos.groupby("steamid")["Y"].diff().fillna(0.0)
        pos["dtick"] = pos.groupby("steamid")["tick"].diff().fillna(1.0).clip(lower=1)
        pos["vel"] = (pos["dx"] ** 2 + pos["dy"] ** 2).pow(0.5) / pos["dtick"] * tickrate
        return pos.set_index(["tick", "steamid"])["vel"].to_dict()
    except Exception:
        return {}


def _build_ticks_by_tick(ticks_df) -> dict:
    """Index ticks DataFrame by tick value for O(1) frame lookups."""
    try:
        return {t: grp for t, grp in ticks_df.groupby("tick")}
    except Exception:
        return {}


# Source 2 IN_ button bitmask constants
_IN_FORWARD   = 1 << 3   # W
_IN_BACK      = 1 << 4   # S
_IN_MOVELEFT  = 1 << 9   # A
_IN_MOVERIGHT = 1 << 10  # D
_IN_JUMP      = 1 << 1   # Space
_IN_DUCK      = 1 << 2   # Ctrl / crouch
_IN_SPEED     = 1 << 16  # Shift / walk (same as is_walking)


def _decode_buttons(bs) -> dict:
    """Decode button_states bitmask into individual key flags."""
    try:
        b = int(bs)
    except (TypeError, ValueError):
        b = 0
    return {
        "w": bool(b & _IN_FORWARD),
        "s": bool(b & _IN_BACK),
        "a": bool(b & _IN_MOVELEFT),
        "d": bool(b & _IN_MOVERIGHT),
        "jump": bool(b & _IN_JUMP),
        "duck": bool(b & _IN_DUCK),
        "walk": bool(b & _IN_SPEED),
    }


def _build_duel_frames(
    ticks_df,
    steamid: str,
    kill_tick: int,
    round_start_tick: int,
    round_end_tick: int,
    tickrate: float,
    window_ticks: int = 192,  # ≈ 3s at 64-tick (1.5s before + 1.5s after)
) -> list[dict]:
    """
    Extract per-tick snapshots for the player in a ±window around kill_tick.
    Returns list of {t, vel, w, s, a, d, jump, duck, walk} dicts.
    Uses velocity_X/Y/Z columns when available, falls back to positional diff.
    """
    if ticks_df is None or not len(ticks_df):
        return []

    t_lo = max(round_start_tick, kill_tick - window_ticks // 2)
    t_hi = min(round_end_tick, kill_tick + window_ticks // 2)

    try:
        mask = (
            (ticks_df["steamid"].astype(str) == steamid) &
            (ticks_df["tick"] >= t_lo) &
            (ticks_df["tick"] <= t_hi)
        )
        sub = ticks_df[mask].sort_values("tick")
        if sub.empty:
            return []

        has_vel_cols = all(c in sub.columns for c in ("velocity_X", "velocity_Y"))
        has_buttons = "button_states" in sub.columns

        frames: list[dict] = []
        prev_x = prev_y = None
        prev_tick = None

        for _, row in sub.iterrows():
            tick = int(row["tick"])

            # velocity
            if has_vel_cols:
                vx = _f(row.get("velocity_X", 0))
                vy = _f(row.get("velocity_Y", 0))
                vel = round((vx * vx + vy * vy) ** 0.5, 1)
            elif prev_x is not None and prev_tick is not None:
                dx = _f(row["X"]) - prev_x
                dy = _f(row["Y"]) - prev_y
                dt = max(1, tick - prev_tick)
                vel = round((dx * dx + dy * dy) ** 0.5 / dt * tickrate, 1)
            else:
                vel = 0.0

            prev_x = _f(row["X"])
            prev_y = _f(row["Y"])
            prev_tick = tick

            # buttons
            btns = _decode_buttons(row.get("button_states")) if has_buttons else {
                "w": False, "s": False, "a": False, "d": False,
                "jump": False, "duck": False, "walk": False,
            }

            # relative tick offset from kill (positive = after kill)
            offset = round((tick - kill_tick) / tickrate * 1000)  # ms

            frames.append({
                "t": offset,
                "vel": vel,
                **btns,
            })

        return frames
    except Exception:
        return []


def _nearest_tick(ticks_by_tick: dict, target: int):
    """Return the frame closest to target tick, or None if no ticks at all."""
    if not ticks_by_tick:
        return None
    if target in ticks_by_tick:
        return ticks_by_tick[target]
    keys = list(ticks_by_tick.keys())
    keys.sort()
    # binary search for nearest
    import bisect
    i = bisect.bisect_left(keys, target)
    candidates = []
    if i < len(keys):
        candidates.append(keys[i])
    if i > 0:
        candidates.append(keys[i - 1])
    best = min(candidates, key=lambda k: abs(k - target))
    return ticks_by_tick[best]


# ------------------------------------------------------------------ duel classifier

def _classify_duel(
    attacker_sid: str,
    frame_rows: dict,  # steamid -> row at kill tick
    vel_lookup: dict,
    kill_tick: int,
    weapon_fire_ticks: list[int],  # weapon_fire ticks for this attacker in this round
    headshot: bool,
    won: bool,
) -> tuple[list[str], dict]:
    """
    Classify a single duel and return (error_list, context_dict).

    frame_rows: {steamid: row} at the kill tick.
    vel_lookup: (tick, steamid) -> velocity.
    weapon_fire_ticks: sorted list of weapon_fire ticks for attacker.
    """
    a_row = frame_rows.get(attacker_sid)

    # attacker velocity at kill tick
    attacker_vel = round(_f(vel_lookup.get((kill_tick, attacker_sid), 0.0)), 1)

    # attacker flash duration
    attacker_flash = 0.0
    if a_row is not None:
        attacker_flash = round(_f(a_row.get("flash_duration", 0) or 0), 2)

    # is_walking: check attacker row at kill tick (closest weapon_fire tick used as fallback)
    attacker_walking = False
    if a_row is not None:
        try:
            attacker_walking = bool(a_row.get("is_walking"))
        except (TypeError, ValueError):
            pass

    # attacker team
    a_team = -1
    if a_row is not None:
        try:
            a_team = int(a_row.get("team_num", -1))
        except (TypeError, ValueError):
            pass

    # near ally dist + alive counts
    near_ally_dist = None
    alive_allies = 0
    alive_enemies = 0
    ax = _f(a_row["X"]) if a_row is not None else 0.0
    ay = _f(a_row["Y"]) if a_row is not None else 0.0

    for sid2, r2 in frame_rows.items():
        if sid2 == attacker_sid:
            continue
        try:
            alive2 = bool(r2.get("is_alive", False))
            team2 = int(r2.get("team_num", -1))
        except (TypeError, ValueError):
            continue
        if not alive2:
            continue
        if team2 == a_team:
            alive_allies += 1
            dx = _f(r2.get("X", 0)) - ax
            dy = _f(r2.get("Y", 0)) - ay
            d = (dx * dx + dy * dy) ** 0.5
            if near_ally_dist is None or d < near_ally_dist:
                near_ally_dist = d
        else:
            alive_enemies += 1

    # error classification (attacker perspective)
    errors: list[str] = []
    if attacker_walking:
        errors.append("shift_peek")
    if attacker_vel > 50:
        errors.append("moving_shot")
    if (near_ally_dist is not None and near_ally_dist > 800) or alive_allies == 0:
        errors.append("isolated")
    if attacker_flash > 1.5:
        errors.append("flashed")
    if won and headshot and not errors:
        errors.append("strong_duel")

    context = {
        "nearAllyDist": round(near_ally_dist, 1) if near_ally_dist is not None else None,
        "flashDur": attacker_flash,
        "attackerVel": attacker_vel,
        "victimVel": 0.0,  # filled by caller
        "aliveAllies": alive_allies,
        "aliveEnemies": alive_enemies,
        "attackerWalking": attacker_walking,
    }
    return errors, context


# ------------------------------------------------------------------ duel builder

def _build_duels(ctx, rb, fb, players: dict, steamid: str) -> list[dict]:
    """Build and classify all duel episodes involving steamid."""
    ticks_df = ctx.ticks
    if ticks_df is None or not len(ticks_df):
        return []

    kills_df = ctx.ev("player_death")
    if not len(kills_df):
        return []

    kills_df = kills_df.sort_values("tick")

    vel_lookup = _build_vel_lookup(ticks_df, ctx.tickrate)
    ticks_by_tick = _build_ticks_by_tick(ticks_df)

    # round lookup by tick — used for both kills and weapon_fire
    import numpy as _np
    fe_arr = [r["freezeEndTick"] for r in rb.rounds]
    end_arr = [r["endTick"] for r in rb.rounds]
    fe_np = _np.array(fe_arr, dtype="int64")
    end_np = _np.array(end_arr, dtype="int64")
    round_ns = [r["n"] for r in rb.rounds]

    def _round_of(t: int):
        i = int(_np.searchsorted(fe_np, t, side="right")) - 1
        if i < 0 or t > end_np[i]:
            return None
        return round_ns[i]

    # opening kill tick per round — used to tag duel episodes as opening
    opening_tick_by_round: dict[int, int] = {}
    for r in rb.rounds:
        ok = r.get("openingKill")
        if ok and ok.get("tick") is not None:
            opening_tick_by_round[r["n"]] = int(ok["tick"])

    # weapon_fire ticks per (steamid, round) for walking-at-shot checks
    wf_df = ctx.ev("weapon_fire")
    wf_ticks: dict[tuple[str, int], list[int]] = defaultdict(list)
    if len(wf_df):
        for _, wrow in wf_df.iterrows():
            wsid = _sid(wrow.get("user_steamid"))
            if wsid != steamid:
                continue
            rn = _round_of(int(wrow["tick"]))
            if rn is not None:
                wf_ticks[(steamid, rn)].append(int(wrow["tick"]))

    # round tick ranges for timestamp computation
    round_map = {r["n"]: r for r in rb.rounds}

    duels: list[dict] = []

    for _, k in kills_df.iterrows():
        a_sid = _sid(k.get("attacker_steamid"))
        v_sid = _sid(k.get("user_steamid"))
        if not (a_sid and v_sid):
            continue
        # only duels involving our player
        if a_sid != steamid and v_sid != steamid:
            continue

        tick = int(k["tick"])
        weapon = str(k.get("weapon", ""))
        headshot = bool(k.get("headshot"))
        rn = _round_of(tick) or 0
        won = (a_sid == steamid)

        # timestamp from round start
        r_info = round_map.get(rn)
        if r_info is not None:
            ts = round((tick - r_info["freezeEndTick"]) / ctx.tickrate, 2)
        else:
            ts = 0.0

        # get frame at kill tick
        frame = _nearest_tick(ticks_by_tick, tick)
        frame_rows: dict = {}
        if frame is not None:
            try:
                for _, frow in frame.iterrows():
                    fsid = _sid(frow.get("steamid"))
                    if fsid:
                        frame_rows[fsid] = frow
            except Exception:
                pass

        # victim velocity
        victim_vel = round(_f(vel_lookup.get((tick, v_sid), 0.0)), 1)

        # classify (only meaningful when player is attacker)
        if won:
            errors, context = _classify_duel(
                a_sid, frame_rows, vel_lookup, tick,
                wf_ticks.get((steamid, rn), []),
                headshot, won,
            )
            context["victimVel"] = victim_vel
        else:
            # player is victim — classify from victim's perspective
            a_row = frame_rows.get(a_sid)
            v_row = frame_rows.get(v_sid)
            a_vel = round(_f(vel_lookup.get((tick, a_sid), 0.0)), 1)
            a_flash = 0.0
            a_walking = False
            if a_row is not None:
                a_flash = round(_f(a_row.get("flash_duration", 0) or 0), 2)
                try:
                    a_walking = bool(a_row.get("is_walking"))
                except (TypeError, ValueError):
                    pass

            # victim-side context: team counts from victim's perspective
            v_team = -1
            if v_row is not None:
                try:
                    v_team = int(v_row.get("team_num", -1))
                except (TypeError, ValueError):
                    pass
            alive_allies = 0
            alive_enemies = 0
            near_ally_dist_v = None
            vx = _f(v_row["X"]) if v_row is not None else 0.0
            vy = _f(v_row["Y"]) if v_row is not None else 0.0
            for sid2, r2 in frame_rows.items():
                if sid2 == v_sid:
                    continue
                try:
                    alive2 = bool(r2.get("is_alive", False))
                    team2 = int(r2.get("team_num", -1))
                except (TypeError, ValueError):
                    continue
                if not alive2:
                    continue
                if team2 == v_team:
                    alive_allies += 1
                    dx = _f(r2.get("X", 0)) - vx
                    dy = _f(r2.get("Y", 0)) - vy
                    d = (dx * dx + dy * dy) ** 0.5
                    if near_ally_dist_v is None or d < near_ally_dist_v:
                        near_ally_dist_v = d
                else:
                    alive_enemies += 1

            victim_flash = 0.0
            if v_row is not None:
                victim_flash = round(_f(v_row.get("flash_duration", 0) or 0), 2)

            # victim-side errors
            errors: list[str] = []
            if victim_flash > 1.5:
                errors.append("flashed")
            if victim_vel > 50:
                errors.append("moving")
            if alive_enemies > alive_allies + 1:
                errors.append("outnumbered")

            context = {
                "nearAllyDist": round(near_ally_dist_v, 1) if near_ally_dist_v is not None else None,
                "flashDur": a_flash,
                "attackerVel": a_vel,
                "victimVel": victim_vel,
                "aliveAllies": alive_allies,
                "aliveEnemies": alive_enemies,
                "attackerWalking": a_walking,
            }

        # per-tick frames for EpisodeDrillDown visualisation
        if r_info is not None:
            frames = _build_duel_frames(
                ticks_df, steamid, tick,
                r_info["freezeEndTick"], r_info["endTick"],
                ctx.tickrate,
            )
        else:
            frames = []

        duels.append({
            "round": rn,
            "tick": tick,
            "timestamp": ts,
            "attacker": a_sid,
            "victim": v_sid,
            "weapon": weapon,
            "headshot": headshot,
            "won": won,
            "opening": opening_tick_by_round.get(rn) == tick,
            "errors": errors,
            "context": context,
            "frames": frames,
        })

    return duels


# ------------------------------------------------------------------ metrics

def _build_metrics(p, series: list[dict], duels: list[dict]) -> dict:
    """Compute overview tile metrics from PlayerStats and duel list."""
    total_kills = sum(pr["kills"] for pr in p.rounds.values())
    total_deaths = sum(pr["deaths"] for pr in p.rounds.values())

    trade_kills = getattr(p, "tradeKills", 0)
    traded_deaths = getattr(p, "tradedDeaths", 0)

    opening_kills = getattr(p, "openingKills", 0)
    opening_deaths = getattr(p, "openingDeaths", 0)

    flash_thrown = getattr(p, "flashThrows", 0)
    eff_flashes = sum(pr.get("effectiveFlashes", 0) for pr in p.rounds.values())

    clutch_played = len(getattr(p, "clutchAttempts", []))
    clutch_won = p.clutch_wins() if hasattr(p, "clutch_wins") else 0

    # duel-derived metrics (attacker side only)
    attacker_duels = [d for d in duels if d["won"]]
    total_duels = len(attacker_duels)

    shift_peek_count = sum(1 for d in attacker_duels if "shift_peek" in d["errors"])
    isolated_count = sum(1 for d in duels if "isolated" in d["errors"])

    trade_kill_rounds = sorted(n for n, pr in p.rounds.items() if pr.get("tradedKill"))
    traded_death_rounds = sorted(n for n, pr in p.rounds.items() if pr.get("tradedDeath"))
    # ticks of the actual trade-kill / traded-death events for precise duel matching
    trade_kill_ticks = sorted(int(pr["tradedKill"]) for pr in p.rounds.values() if pr.get("tradedKill") and pr["tradedKill"] is not True)
    traded_death_ticks = sorted(int(pr["tradedDeath"]) for pr in p.rounds.values() if pr.get("tradedDeath") and pr["tradedDeath"] is not True)

    trade_kill_pct = round(trade_kills / total_kills * 100, 1) if total_kills else 0.0
    traded_death_pct = round(traded_deaths / total_deaths * 100, 1) if total_deaths else 0.0
    opening_win_pct = (
        round(opening_kills / (opening_kills + opening_deaths) * 100, 1)
        if (opening_kills + opening_deaths) else 0.0
    )
    flash_eff = round(eff_flashes / flash_thrown * 100, 1) if flash_thrown else 0.0
    clutch_win_pct = round(clutch_won / clutch_played * 100, 1) if clutch_played else 0.0
    shift_peek_pct = round(shift_peek_count / total_duels * 100, 1) if total_duels else 0.0
    isolated_pct = round(isolated_count / len(duels) * 100, 1) if duels else 0.0

    # main problem = highest-count error group among attacker duels
    error_counts: dict[str, int] = defaultdict(int)
    for d in attacker_duels:
        for e in d["errors"]:
            if e != "strong_duel":
                error_counts[e] += 1
    main_problem = max(error_counts, key=lambda k: error_counts[k]) if error_counts else None

    return {
        "tradeKillPct": trade_kill_pct,
        "tradedDeathPct": traded_death_pct,
        "openingWinPct": opening_win_pct,
        "flashEfficiency": flash_eff,
        "clutchWinPct": clutch_win_pct,
        "shiftPeekPct": shift_peek_pct,
        "isolatedPct": isolated_pct,
        "mainProblem": main_problem,
        "tradeKillRounds": trade_kill_rounds,
        "tradedDeathRounds": traded_death_rounds,
        "tradeKillTicks": trade_kill_ticks,
        "tradedDeathTicks": traded_death_ticks,
    }


# ------------------------------------------------------------------ impact block

def _build_impact(series: list[dict], duels: list[dict] | None = None,
                  winprob: list[float] | None = None,
                  replay_ticks: list[int] | None = None,
                  player_team: int | None = None,
                  rounds: list[dict] | None = None) -> dict:
    """Build impact block from per-round series."""
    if not series:
        return {"topRoundsPositive": [], "topRoundsNegative": [], "avgWinProbAtDuel": None}

    sorted_by_imp = sorted(series, key=lambda s: s["imp"], reverse=True)
    top_pos = [{"n": s["n"], "imp": s["imp"]} for s in sorted_by_imp[:3] if s["imp"] > 0]
    top_neg = [{"n": s["n"], "imp": s["imp"]} for s in reversed(sorted_by_imp) if s["imp"] < 0][:3]

    avg_win_prob = None
    if duels and winprob and replay_ticks and rounds:
        import bisect
        ticks_arr = replay_ticks

        def _prob_at(t: int) -> float | None:
            if not ticks_arr:
                return None
            i = bisect.bisect_left(ticks_arr, t)
            if i >= len(ticks_arr):
                i = len(ticks_arr) - 1
            elif i > 0 and abs(ticks_arr[i - 1] - t) < abs(ticks_arr[i] - t):
                i -= 1
            return winprob[i] if i < len(winprob) else None

        # build round -> player side mapping
        side_by_round: dict[int, str] = {}
        for r in rounds:
            side0 = r.get("sideTeam0", "T")
            if player_team == 0:
                side_by_round[r["n"]] = side0
            else:
                side_by_round[r["n"]] = "CT" if side0 == "T" else "T"

        probs: list[float] = []
        for d in duels:
            if not d["won"]:
                continue
            p_ct = _prob_at(d["tick"])
            if p_ct is None:
                continue
            side = side_by_round.get(d["round"], "T")
            prob = p_ct if side == "CT" else 1.0 - p_ct
            probs.append(prob)

        if probs:
            avg_win_prob = round(sum(probs) / len(probs), 3)

    return {
        "topRoundsPositive": top_pos,
        "topRoundsNegative": top_neg,
        "avgWinProbAtDuel": avg_win_prob,
    }


# ------------------------------------------------------------------ decisions cost

def _build_decisions_cost(ctx, rb, steamid: str, winprob: list[float], replay_ticks: list[int]) -> list[dict]:
    """For each death of steamid, find WinProb before/after and return significant drops."""
    if not winprob or not replay_ticks:
        return []

    kills_df = ctx.ev("player_death")
    if not len(kills_df):
        return []

    # build tick -> winprob index (nearest frame)
    import bisect
    ticks_arr = replay_ticks  # sorted ascending

    def prob_at_tick(t: int) -> float | None:
        if not ticks_arr:
            return None
        i = bisect.bisect_left(ticks_arr, t)
        if i >= len(ticks_arr):
            i = len(ticks_arr) - 1
        elif i > 0 and abs(ticks_arr[i - 1] - t) < abs(ticks_arr[i] - t):
            i -= 1
        return winprob[i] if i < len(winprob) else None

    # round lookup
    import numpy as _np
    fe_arr = [r["freezeEndTick"] for r in rb.rounds]
    end_arr = [r["endTick"] for r in rb.rounds]
    fe_np = _np.array(fe_arr, dtype="int64")
    end_np = _np.array(end_arr, dtype="int64")
    round_ns = [r["n"] for r in rb.rounds]

    def _round_of(t: int):
        i = int(_np.searchsorted(fe_np, t, side="right")) - 1
        if i < 0 or t > end_np[i]:
            return None
        return round_ns[i]

    # determine player's team side per round to orient CT prob correctly
    # steamid_team: {sid: 0 or 1}, team 0 = t0, team 1 = t1
    player_team = rb.steamid_team.get(steamid)  # 0 or 1

    LOOK_AHEAD_TICKS = int(ctx.tickrate * 3)  # 3 seconds after death
    MIN_DROP = 0.08  # only include deaths with >=8% WinProb drop

    entries: list[dict] = []

    for _, k in kills_df.iterrows():
        v_sid = _sid(k.get("user_steamid"))
        if v_sid != steamid:
            continue

        tick = int(k["tick"])
        rn = _round_of(tick)
        if rn is None:
            continue

        # WinProb is CT probability; convert to player's team perspective
        prob_before_ct = prob_at_tick(tick)
        prob_after_ct = prob_at_tick(tick + LOOK_AHEAD_TICKS)
        if prob_before_ct is None or prob_after_ct is None:
            continue

        # player_team 0 → team 0, need to figure out their side per round
        # rb.team_with_side returns team index (0/1) for a given side string
        try:
            r_info = next((r for r in rb.rounds if r["n"] == rn), None)
            if r_info is None:
                continue
            side0 = r_info.get("sideTeam0", "T")
            # player side: team 0 has side0, team 1 has opposite
            if player_team == 0:
                player_side = side0
            else:
                player_side = "CT" if side0 == "T" else "T"
        except Exception:
            player_side = "T"

        # orient probability toward player's side
        if player_side == "CT":
            prob_before = round(prob_before_ct, 3)
            prob_after = round(prob_after_ct, 3)
        else:
            prob_before = round(1.0 - prob_before_ct, 3)
            prob_after = round(1.0 - prob_after_ct, 3)

        drop = prob_before - prob_after
        if drop < MIN_DROP:
            continue

        entries.append({
            "round": rn,
            "tick": tick,
            "probBefore": prob_before,
            "probAfter": prob_after,
            "drop": round(drop, 3),
            "side": player_side,
        })

    # sort by drop descending, keep top 10
    entries.sort(key=lambda e: e["drop"], reverse=True)
    return entries[:10]


# ------------------------------------------------------------------ map events

def _build_map_events(ctx, rb, steamid: str) -> list[dict]:
    """Extract kill/death XY events for the map tab."""
    kills_df = ctx.ev("player_death")
    if not len(kills_df):
        return []

    import numpy as _np
    fe_np = _np.array([r["freezeEndTick"] for r in rb.rounds], dtype="int64")
    end_np = _np.array([r["endTick"] for r in rb.rounds], dtype="int64")
    round_ns = [r["n"] for r in rb.rounds]

    def _rof(t: int):
        i = int(_np.searchsorted(fe_np, t, side="right")) - 1
        return round_ns[i] if 0 <= i < len(round_ns) and t <= end_np[i] else 0

    events: list[dict] = []
    for _, k in kills_df.iterrows():
        a_sid = _sid(k.get("attacker_steamid"))
        v_sid = _sid(k.get("user_steamid"))
        if not (a_sid and v_sid):
            continue
        if a_sid != steamid and v_sid != steamid:
            continue

        tick = int(k["tick"])
        weapon = str(k.get("weapon", ""))
        headshot = bool(k.get("headshot"))
        rn = _rof(tick)

        attacker_x = _f(k.get("attacker_X", 0))
        attacker_y = _f(k.get("attacker_Y", 0))
        victim_x   = _f(k.get("user_X", 0))
        victim_y   = _f(k.get("user_Y", 0))

        if a_sid == steamid:
            # kill: player is attacker — dot at attacker XY, line to victim
            x, y = attacker_x, attacker_y
            vx, vy = victim_x, victim_y
            ev_type = "kill"
        else:
            # death: player is victim — dot at victim XY, line to attacker
            x, y = victim_x, victim_y
            vx, vy = attacker_x, attacker_y
            ev_type = "death"

        events.append({
            "tick": tick,
            "round": rn,
            "type": ev_type,
            "x": x,
            "y": y,
            "vx": vx,
            "vy": vy,
            "weapon": weapon,
            "headshot": headshot,
        })

    return events


# ------------------------------------------------------------------ top-level

def build_player_analytics(ctx, rb, fb, players: dict,
                           winprob: list | None = None,
                           replay_ticks: list | None = None) -> dict:
    """Compute per-player deep analytics for all players in fb.players.

    Returns a dict keyed by steamid with keys: duels, metrics, impact, mapEvents.
    """
    result: dict[str, Any] = {}

    ticks_df = ctx.ticks
    if ticks_df is None or not len(ticks_df):
        # no tick data — return empty shells for each player
        for steamid in fb.players:
            result[steamid] = {
                "duels": [],
                "metrics": {
                    "tradeKillPct": 0.0, "tradedDeathPct": 0.0,
                    "openingWinPct": 0.0, "flashEfficiency": 0.0,
                    "clutchWinPct": 0.0, "shiftPeekPct": 0.0,
                    "isolatedPct": 0.0, "mainProblem": None,
                    "counterStrafeErrors": 0, "idealStrafePct": 0.0,
                    "firstBulletAcc": 0.0, "ttk_ms": 0.0,
                    "reloadErrors": 0, "angleControlCount": 0,
                },
                "impact": {"topRoundsPositive": [], "topRoundsNegative": [],
                           "avgWinProbAtDuel": None},
                "mapEvents": [],
            }
        return result

    for steamid in fb.players:
        p = players.get(steamid)
        if p is None:
            continue

        try:
            duels = _build_duels(ctx, rb, fb, players, steamid)
        except Exception:
            duels = []

        # tag duel episodes that correspond to actual trade kills / traded deaths
        trade_kill_tick_set: set[int] = set()
        traded_death_tick_set: set[int] = set()
        if p is not None:
            for pr in p.rounds.values():
                tk = pr.get("tradedKill")
                if tk and tk is not True:
                    try:
                        trade_kill_tick_set.add(int(tk))
                    except (TypeError, ValueError):
                        pass
                td = pr.get("tradedDeath")
                if td and td is not True:
                    try:
                        traded_death_tick_set.add(int(td))
                    except (TypeError, ValueError):
                        pass
        for d in duels:
            d["isTradeKill"] = d["tick"] in trade_kill_tick_set
            d["isTradedDeath"] = d["tick"] in traded_death_tick_set

        # series comes from run.py's _player_payload — we recompute it here
        # to avoid coupling; use same formula as run._imp_round
        try:
            from .run import _imp_round
            clutch_won_rounds = {c["round"] for c in p.clutchAttempts if c.get("won")}
            series: list[dict] = []
            for r in rb.rounds:
                pr = p.rounds.get(r["n"])
                if pr is None:
                    continue
                r_won = r.get("winnerTeam") == p.team
                imp = _imp_round(pr, r_won, pr["opening"], r["n"] in clutch_won_rounds)
                series.append({"n": r["n"], "imp": imp})
        except Exception:
            series = []

        try:
            aim = compute_aim_mechanics(ctx, rb, steamid)
        except Exception:
            aim = {
                "counterStrafeErrors": 0, "idealStrafePct": 0.0,
                "firstBulletAcc": 0.0, "ttk_ms": 0.0,
                "reloadErrors": 0, "angleControlCount": 0,
            }

        try:
            metrics = _build_metrics(p, series, duels)
            metrics.update(aim)
        except Exception:
            metrics = {
                "tradeKillPct": 0.0, "tradedDeathPct": 0.0,
                "openingWinPct": 0.0, "flashEfficiency": 0.0,
                "clutchWinPct": 0.0, "shiftPeekPct": 0.0,
                "isolatedPct": 0.0, "mainProblem": None,
                "counterStrafeErrors": 0, "idealStrafePct": 0.0,
                "firstBulletAcc": 0.0, "ttk_ms": 0.0,
                "reloadErrors": 0, "angleControlCount": 0,
            }

        try:
            impact = _build_impact(
                series, duels,
                winprob or [], replay_ticks or [],
                rb.steamid_team.get(steamid),
                rb.rounds,
            )
        except Exception:
            impact = {"topRoundsPositive": [], "topRoundsNegative": [],
                      "avgWinProbAtDuel": None}

        try:
            map_events = _build_map_events(ctx, rb, steamid)
        except Exception:
            map_events = []

        try:
            decisions_cost = _build_decisions_cost(
                ctx, rb, steamid,
                winprob or [], replay_ticks or [],
            )
        except Exception:
            decisions_cost = []

        result[steamid] = {
            "duels": duels,
            "metrics": metrics,
            "impact": impact,
            "mapEvents": map_events,
            "decisionsCost": decisions_cost,
            "firstBulletShots": aim.get("firstBulletShots", []),
        }

    return result

