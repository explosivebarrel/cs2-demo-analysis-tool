"""
Aim mechanics metrics derived from weapon_fire, player_hurt, and tick data.

Computes per-player:
  - counterStrafeErrors  : shots fired while velocity > SHOOT_THRESHOLD
  - idealStrafePct       : % of shots-that-kill where velocity <= threshold at fire tick
  - firstBulletAcc       : % of duel-opening shots that hit an enemy
  - ttk_ms               : avg ms from first shot to kill (winning duels only)
  - reloadErrors         : weapon_reload events with bullets_in_magazine > RELOAD_SAFE_BULLETS
  - angleControlCount    : distinct positions held >= ANGLE_HOLD_SEC with near-zero velocity
"""

from __future__ import annotations

from typing import TYPE_CHECKING


if TYPE_CHECKING:
    pass

# ── Tuning constants ─────────────────────────────────────────────────────────
SHOOT_THRESHOLD = 50.0       # u/s — velocity above this = "moving while shooting"
RELOAD_SAFE_BULLETS = 5      # reloads with more bullets left than this = error
ANGLE_HOLD_SEC = 2.0         # min seconds stationary to count as angle control
ANGLE_MOVE_THRESHOLD = 30.0  # u/s — below this counts as "not moving"
ANGLE_GRID = 64              # world-unit grid for position deduplication
DUEL_MERGE_TICKS = 256       # ticks gap between separate duels (≈ 2s at 128-tick)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _f(v, default: float = 0.0) -> float:
    try:
        fv = float(v)
        return fv if fv == fv else default
    except (TypeError, ValueError):
        return default


def _sid(v) -> str | None:
    if v is None:
        return None
    s = str(v)
    return s if s and s not in ("None", "nan", "0") else None


def _vel_at(vel_lookup: dict, tick: int, steamid: str) -> float:
    return float(vel_lookup.get((tick, steamid), 0.0))


def _nearest_tick_key(sorted_keys: list[int], target: int) -> int:
    """Return the key in sorted_keys closest to target."""
    import bisect
    i = bisect.bisect_left(sorted_keys, target)
    candidates = []
    if i < len(sorted_keys):
        candidates.append(sorted_keys[i])
    if i > 0:
        candidates.append(sorted_keys[i - 1])
    return min(candidates, key=lambda k: abs(k - target))


# ── Counter-strafe errors & ideal strafe % ───────────────────────────────────

def _compute_strafe_metrics(
    wf_df,           # weapon_fire DataFrame
    kills_df,        # player_death DataFrame
    vel_lookup: dict,
    steamid: str,
    tickrate: float,
) -> tuple[int, float]:
    """
    Returns (counterStrafeErrors, idealStrafePct).

    counterStrafeErrors: total weapon_fire events where velocity > SHOOT_THRESHOLD.
    idealStrafePct: % of kill-opening shots (first shot of a duel that resulted in
                    a kill) where velocity <= SHOOT_THRESHOLD at fire tick.
    """
    if wf_df is None or not len(wf_df):
        return 0, 0.0

    my_wf = wf_df[wf_df["user_steamid"].astype(str) == steamid].copy()
    if my_wf.empty:
        return 0, 0.0

    # build set of kill ticks where this player is attacker
    kill_ticks: set[int] = set()
    if kills_df is not None and len(kills_df):
        for _, k in kills_df[kills_df["attacker_steamid"].astype(str) == steamid].iterrows():
            kill_ticks.add(int(k["tick"]))

    errors = 0
    ideal_total = 0
    ideal_count = 0

    # group shots by "duel" — gap > DUEL_MERGE_TICKS separates duels
    shot_ticks = sorted(int(t) for t in my_wf["tick"])
    duel_starts: list[int] = []
    prev = None
    for st in shot_ticks:
        if prev is None or (st - prev) > DUEL_MERGE_TICKS:
            duel_starts.append(st)
        prev = st

    duel_start_set = set(duel_starts)

    for _, row in my_wf.iterrows():
        tick = int(row["tick"])
        vel = _vel_at(vel_lookup, tick, steamid)

        if vel > SHOOT_THRESHOLD:
            errors += 1

        # duel-opening shots that resulted in a kill within DUEL_MERGE_TICKS ticks
        if tick in duel_start_set:
            for kt in kill_ticks:
                if 0 <= kt - tick <= DUEL_MERGE_TICKS:
                    ideal_total += 1
                    if vel <= SHOOT_THRESHOLD:
                        ideal_count += 1
                    break

    ideal_pct = round(ideal_count / ideal_total * 100, 1) if ideal_total else 0.0
    return errors, ideal_pct


# ── First bullet accuracy ────────────────────────────────────────────────────

def _compute_first_bullet_acc(
    wf_df,
    hurt_df,
    kills_df,
    steamid: str,
    rb=None,
) -> tuple[float, list[dict]]:
    """
    % of duel-opening shots that hit an enemy.
    Returns (pct, per_shot_list) where per_shot_list has {round, tick, hit, weapon}.
    """
    if wf_df is None or not len(wf_df):
        return 0.0, []

    my_wf = wf_df[wf_df["user_steamid"].astype(str) == steamid].copy()
    if my_wf.empty:
        return 0.0, []

    # enemy hurt ticks involving this attacker
    enemy_hurt_ticks: set[int] = set()
    if hurt_df is not None and len(hurt_df):
        ah = hurt_df[hurt_df["attacker_steamid"].astype(str) == steamid]
        for t in ah["tick"]:
            enemy_hurt_ticks.add(int(t))

    # round-of-tick lookup
    if rb is not None:
        import numpy as _np
        fe_np = _np.array([r["freezeEndTick"] for r in rb.rounds], dtype="int64")
        end_np = _np.array([r["endTick"] for r in rb.rounds], dtype="int64")
        round_ns = [r["n"] for r in rb.rounds]

        def _rof(t: int) -> int:
            i = int(_np.searchsorted(fe_np, t, side="right")) - 1
            if 0 <= i < len(round_ns) and t <= end_np[i]:
                return round_ns[i]
            return 0

    _NON_BULLET = {
        "weapon_smokegrenade", "weapon_flashbang", "weapon_hegrenade",
        "weapon_molotov", "weapon_incgrenade", "weapon_decoy",
        "weapon_c4", "weapon_knife", "weapon_knife_t", "weapon_knife_ct",
        "weapon_knife_karambit", "weapon_knife_m9_bayonet", "weapon_knife_tactical",
        "weapon_knife_falchion", "weapon_knife_survival_bowie", "weapon_knife_butterfly",
        "weapon_knife_push", "weapon_knife_ursus", "weapon_knife_gypsy_jackknife",
        "weapon_knife_stiletto", "weapon_knife_widowmaker", "weapon_knife_cord",
        "weapon_knife_canis", "weapon_knife_outdoor", "weapon_knife_skeleton",
        "weapon_knife_ghost",
    }

    all_shot_rows = sorted(zip(my_wf["tick"].astype(int), my_wf.get("weapon", [""] * len(my_wf))), key=lambda x: x[0])
    # keep only actual bullet-firing weapons
    shot_rows = [(t, w) for t, w in all_shot_rows if str(w) not in _NON_BULLET and not str(w).startswith("weapon_knife")]
    duel_first_shots: list[tuple[int, str]] = []
    prev = None
    for st, wep in shot_rows:
        if prev is None or (st - prev) > DUEL_MERGE_TICKS:
            duel_first_shots.append((st, str(wep)))
        prev = st

    per_shot: list[dict] = []
    hit_total = 0
    for st, wep in duel_first_shots:
        hit = any(0 <= ht - st <= 8 for ht in enemy_hurt_ticks)
        if hit:
            hit_total += 1
        rn = _rof(st) if rb is not None else 0
        per_shot.append({"round": rn, "tick": st, "hit": hit, "weapon": wep})

    total = len(duel_first_shots)
    pct = round(hit_total / total * 100, 1) if total else 0.0
    return pct, per_shot


# ── Time-to-kill ─────────────────────────────────────────────────────────────

def _compute_ttk(
    wf_df,
    kills_df,
    steamid: str,
    tickrate: float,
) -> float:
    """
    Average ms from first shot of a duel to the kill event (winning duels only).
    """
    if wf_df is None or not len(wf_df) or kills_df is None or not len(kills_df):
        return 0.0

    my_wf = wf_df[wf_df["user_steamid"].astype(str) == steamid].copy()
    my_kills = kills_df[kills_df["attacker_steamid"].astype(str) == steamid].copy()
    if my_wf.empty or my_kills.empty:
        return 0.0

    shot_ticks = sorted(int(t) for t in my_wf["tick"])
    kill_ticks = sorted(int(t) for t in my_kills["tick"])

    # for each kill find the earliest shot within a tight TTK window
    # Use 0.5s max (not the full duel merge window) — pre-aim shots before
    # the engagement are not part of TTK
    TTK_MAX_TICKS = max(32, int(tickrate * 0.5))
    deltas: list[float] = []
    for kt in kill_ticks:
        candidates = [st for st in shot_ticks if 0 <= kt - st <= TTK_MAX_TICKS]
        if candidates:
            first_shot = min(candidates)
            delta_ms = round((kt - first_shot) / tickrate * 1000, 1)
            deltas.append(delta_ms)

    return round(sum(deltas) / len(deltas), 1) if deltas else 0.0


# ── Reload errors ────────────────────────────────────────────────────────────

def _compute_reload_errors(ctx, rb, steamid: str, tickrate: float) -> int:
    """
    Count weapon_reload events where the player had > RELOAD_SAFE_BULLETS remaining.
    Uses inventory ammo data from nearest tick before the reload event.
    Falls back to counting all reloads if ammo data is unavailable.
    """
    reload_df = ctx.ev("weapon_reload") if ctx.has_ev("weapon_reload") else None
    if reload_df is None or not len(reload_df):
        return 0

    my_reloads = reload_df[reload_df.get("user_steamid", reload_df.get("steamid", reload_df.iloc[:, 0])).astype(str) == steamid]
    if my_reloads.empty:
        return 0

    import bisect as _bisect
    import numpy as _np

    # try to get clip ammo at reload time from ticks (active_weapon_ammo)
    ticks_df = ctx.ticks
    ammo_col = None
    if ticks_df is not None:
        for cname in ("active_weapon_ammo", "clipammo"):
            if cname in ticks_df.columns:
                ammo_col = cname
                break

    fe_arr = _np.array([r["freezeEndTick"] for r in rb.rounds], dtype="int64")
    end_arr = _np.array([r["endTick"] for r in rb.rounds], dtype="int64")

    if ammo_col is None:
        # no ammo data: count all reloads during live play (not freeze time)
        errors = 0
        for _, row in my_reloads.iterrows():
            t = int(row["tick"])
            i = int(_np.searchsorted(fe_arr, t, side="right")) - 1
            if 0 <= i < len(fe_arr) and t <= end_arr[i]:
                errors += 1
        return errors

    # ammo data available — only count reloads with bullets remaining
    player_ticks = ticks_df[ticks_df["steamid"].astype(str) == steamid][["tick", ammo_col]].copy()
    player_ticks = player_ticks.sort_values("tick")
    tick_arr = player_ticks["tick"].to_numpy()
    ammo_arr = player_ticks[ammo_col].to_numpy()

    errors = 0
    for _, row in my_reloads.iterrows():
        t = int(row["tick"])
        # only count during live rounds
        ri = int(_np.searchsorted(fe_arr, t, side="right")) - 1
        if not (0 <= ri < len(fe_arr) and t <= end_arr[ri]):
            continue
        i = _bisect.bisect_right(tick_arr, t) - 1
        if i >= 0:
            bullets = int(ammo_arr[i]) if ammo_arr[i] == ammo_arr[i] else 0
            if bullets > RELOAD_SAFE_BULLETS:
                errors += 1
    return errors


# ── Angle control count ───────────────────────────────────────────────────────

def _compute_angle_control(ticks_df, steamid: str, tickrate: float, rb) -> tuple[int, dict]:
    """
    Count distinct map positions where the player stood still for >= ANGLE_HOLD_SEC
    without moving, during live rounds (not freeze time).

    Returns (count, byPhase) where byPhase has keys 'early', 'mid', 'late'.
    Phase boundaries from config: OPENING_PHASE_SECONDS and MID_PHASE_SECONDS.
    """
    from app.config import OPENING_PHASE_SECONDS, MID_PHASE_SECONDS

    by_phase = {"early": 0, "mid": 0, "late": 0}
    if ticks_df is None or not len(ticks_df):
        return 0, by_phase

    try:
        import numpy as _np

        fe_arr = _np.array([r["freezeEndTick"] for r in rb.rounds], dtype="int64")
        end_arr = _np.array([r["endTick"] for r in rb.rounds], dtype="int64")

        mask_sid = ticks_df["steamid"].astype(str) == steamid
        pticks = ticks_df[mask_sid][["tick", "X", "Y"]].copy().sort_values("tick")
        if pticks.empty:
            return 0, by_phase

        ticks_arr = pticks["tick"].to_numpy(dtype="int64")
        x_arr = pticks["X"].to_numpy(dtype="float64")
        y_arr = pticks["Y"].to_numpy(dtype="float64")

        # filter to live-round ticks only; record which fe_tick each belongs to
        live_mask = _np.zeros(len(ticks_arr), dtype=bool)
        fe_for_tick = _np.full(len(ticks_arr), -1, dtype="int64")
        for i, t in enumerate(ticks_arr):
            ri = int(_np.searchsorted(fe_arr, t, side="right")) - 1
            if 0 <= ri < len(fe_arr) and t <= end_arr[ri]:
                live_mask[i] = True
                fe_for_tick[i] = fe_arr[ri]

        ticks_arr = ticks_arr[live_mask]
        x_arr = x_arr[live_mask]
        y_arr = y_arr[live_mask]
        fe_for_tick = fe_for_tick[live_mask]
        if len(ticks_arr) < 2:
            return 0, by_phase

        dt = _np.diff(ticks_arr).clip(min=1)
        dx = _np.diff(x_arr)
        dy = _np.diff(y_arr)
        vel = _np.sqrt(dx**2 + dy**2) / dt * tickrate

        stationary = _np.concatenate([[False], vel < ANGLE_MOVE_THRESHOLD])
        min_frames = max(1, int(ANGLE_HOLD_SEC * tickrate / 8))

        positions_seen: set[tuple[int, int]] = set()
        held_count = 0
        run_len = 0

        for i in range(len(stationary)):
            if stationary[i]:
                run_len += 1
                if run_len == min_frames:
                    gx = int(x_arr[i] / ANGLE_GRID)
                    gy = int(y_arr[i] / ANGLE_GRID)
                    cell = (gx, gy)
                    if cell not in positions_seen:
                        positions_seen.add(cell)
                        held_count += 1
                        # classify by phase: seconds since freeze end
                        fe = fe_for_tick[i]
                        offset_sec = (ticks_arr[i] - fe) / tickrate if fe >= 0 else 0
                        if offset_sec <= OPENING_PHASE_SECONDS:
                            by_phase["early"] += 1
                        elif offset_sec <= MID_PHASE_SECONDS:
                            by_phase["mid"] += 1
                        else:
                            by_phase["late"] += 1
            else:
                run_len = 0

        return held_count, by_phase
    except Exception:
        return 0, {"early": 0, "mid": 0, "late": 0}



# ── Reaction time & overshoot ────────────────────────────────────────────────

RT_WINDOW_SEC = 2.0     # look back up to 2s before first shot for victim motion onset
RT_MAX_MS = 1500.0      # cap: longer values are pre-aim scenarios, not true reaction
RT_MOTION_THRESH = 30.0 # u/s — victim speed above this = "victim is moving/peeking"
FOV_HALF_DEG = 40.0     # half-FOV for overshoot tracking


def _angle_diff(a: float, b: float) -> float:
    """Signed difference a-b in degrees, wrapped to (-180, 180]."""
    d = (a - b) % 360.0
    return d - 360.0 if d > 180.0 else d


def _compute_reaction_time(
    ticks_df,
    wf_df,
    kills_df,
    steamid: str,
    tickrate: float,
    hurt_df=None,
) -> tuple[float, int, float]:
    """
    Returns (avg_reaction_time_ms, overshoot_count, successful_reaction_time_ms).

    reaction_time_ms: avg ms from when the victim started moving (peek onset)
                      to the attacker's first shot in winning duels.
    overshoot_count: total times attacker yaw crossed past victim's bearing
                     between peek onset and kill tick across all winning duels.
    successful_reaction_time_ms: same as reaction_time_ms but only for duels
                     where the first bullet hit (Реакция в попаданиях).
    """
    if ticks_df is None or not len(ticks_df) or kills_df is None or not len(kills_df):
        return 0.0, 0, 0.0

    my_kills = kills_df[kills_df["attacker_steamid"].astype(str) == steamid]
    if my_kills.empty:
        return 0.0, 0, 0.0

    if wf_df is None or not len(wf_df):
        return 0.0, 0, 0.0

    my_wf = wf_df[wf_df["user_steamid"].astype(str) == steamid].copy()
    if my_wf.empty:
        return 0.0, 0, 0.0

    # enemy hurt ticks for successful reaction time (hit on first bullet)
    enemy_hurt_ticks_rt: set[int] = set()
    if hurt_df is not None and len(hurt_df):
        ah = hurt_df[hurt_df["attacker_steamid"].astype(str) == steamid]
        for t in ah["tick"]:
            enemy_hurt_ticks_rt.add(int(t))

    import bisect
    import numpy as _np

    try:
        atk_ticks = ticks_df[ticks_df["steamid"].astype(str) == steamid][
            ["tick", "X", "Y", "yaw"]
        ].sort_values("tick")
        atk_tick_arr = atk_ticks["tick"].to_numpy(dtype="int64")
        atk_x_arr    = atk_ticks["X"].to_numpy(dtype=float)
        atk_y_arr    = atk_ticks["Y"].to_numpy(dtype=float)
        atk_yaw_arr  = atk_ticks["yaw"].to_numpy(dtype=float)
    except Exception:
        return 0.0, 0, 0.0

    wf_ticks_sorted = sorted(int(t) for t in my_wf["tick"])
    window_ticks = int(tickrate * RT_WINDOW_SEC)
    TTK_MAX_TICKS = max(32, int(tickrate * 0.5))

    reaction_deltas: list[float] = []
    reaction_deltas_hit: list[float] = []
    overshoot_total = 0

    for _, k in my_kills.iterrows():
        kill_tick = int(k["tick"])
        v_sid = str(k.get("user_steamid", ""))
        if not v_sid or v_sid in ("None", "nan", "0"):
            continue

        # first shot leading to kill (within TTK window before kill)
        fire_cands = [ft for ft in wf_ticks_sorted
                      if 0 <= kill_tick - ft <= TTK_MAX_TICKS]
        if not fire_cands:
            continue
        first_fire_tick = min(fire_cands)

        # victim ticks in [first_fire - window, first_fire]
        t_lo = first_fire_tick - window_ticks
        try:
            vic_ticks = ticks_df[
                (ticks_df["steamid"].astype(str) == v_sid) &
                (ticks_df["tick"] >= t_lo) &
                (ticks_df["tick"] <= first_fire_tick)
            ][["tick", "X", "Y"]].sort_values("tick")
            if len(vic_ticks) < 3:
                continue
            vic_tick_arr = vic_ticks["tick"].to_numpy(dtype="int64")
            vic_x_arr    = vic_ticks["X"].to_numpy(dtype=float)
            vic_y_arr    = vic_ticks["Y"].to_numpy(dtype=float)
        except Exception:
            continue

        # compute victim speed at each frame step
        dt = _np.diff(vic_tick_arr).clip(1)
        dx = _np.diff(vic_x_arr)
        dy = _np.diff(vic_y_arr)
        speeds = _np.sqrt(dx ** 2 + dy ** 2) / dt * tickrate  # u/s

        # find last tick where victim's speed crossed from low to high
        # (most recent "peek onset") before first_fire_tick
        peek_onset_tick: int | None = None
        for i in range(len(speeds) - 1, -1, -1):
            if speeds[i] > RT_MOTION_THRESH:
                # walk back to find where the high-speed run started
                j = i - 1
                while j >= 0 and speeds[j] > RT_MOTION_THRESH:
                    j -= 1
                peek_onset_tick = int(vic_tick_arr[j + 1]) if j >= 0 else int(vic_tick_arr[i])
                break

        if peek_onset_tick is None:
            # victim was stationary — attacker was pre-aiming; skip
            continue

        rt_ms = (first_fire_tick - peek_onset_tick) / tickrate * 1000.0
        if rt_ms < 0 or rt_ms > RT_MAX_MS:
            continue

        reaction_deltas.append(rt_ms)

        # track for successful reaction time: only when first bullet hit
        first_hit_rt = any(0 <= ht - first_fire_tick <= 8 for ht in enemy_hurt_ticks_rt)
        if first_hit_rt:
            reaction_deltas_hit.append(rt_ms)

        # overshoot: yaw sign-changes past victim bearing from peek onset to kill
        try:
            oi_lo = bisect.bisect_left(atk_tick_arr, peek_onset_tick)
            oi_hi = bisect.bisect_right(atk_tick_arr, kill_tick)
            # victim positions around the duel window
            full_vic = ticks_df[
                (ticks_df["steamid"].astype(str) == v_sid) &
                (ticks_df["tick"] >= peek_onset_tick) &
                (ticks_df["tick"] <= kill_tick)
            ][["tick", "X", "Y"]].sort_values("tick")
            if full_vic.empty:
                continue
            fv_tick = full_vic["tick"].to_numpy(dtype="int64")
            fv_x = full_vic["X"].to_numpy(dtype=float)
            fv_y = full_vic["Y"].to_numpy(dtype=float)

            prev_sign = None
            crosses = 0
            import math as _math
            for oi in range(oi_lo, oi_hi):
                if oi >= len(atk_tick_arr):
                    break
                t = int(atk_tick_arr[oi])
                vi2 = bisect.bisect_left(fv_tick, t)
                if vi2 >= len(fv_tick):
                    vi2 = len(fv_tick) - 1
                vx2 = fv_x[vi2] - atk_x_arr[oi]
                vy2 = fv_y[vi2] - atk_y_arr[oi]
                if abs(vx2) < 1e-3 and abs(vy2) < 1e-3:
                    continue
                bearing2 = _math.degrees(_math.atan2(vy2, vx2))
                diff2 = _angle_diff(atk_yaw_arr[oi], bearing2)
                sign = 1 if diff2 >= 0 else -1
                if prev_sign is not None and sign != prev_sign:
                    crosses += 1
                prev_sign = sign
            overshoot_total += crosses
        except Exception:
            pass

    avg_rt = round(sum(reaction_deltas) / len(reaction_deltas), 1) if reaction_deltas else 0.0
    avg_rt_hit = round(sum(reaction_deltas_hit) / len(reaction_deltas_hit), 1) if reaction_deltas_hit else 0.0
    return avg_rt, overshoot_total, avg_rt_hit, reaction_deltas, reaction_deltas_hit


# ── Crosshair placement ───────────────────────────────────────────────────────

def _compute_crosshair_placement(
    wf_df,
    hurt_df,
    steamid: str,
) -> float:
    """
    % of duel-opening shots that hit AND landed on the head.
    Measures how well the player pre-aims at head level.
    """
    if wf_df is None or not len(wf_df):
        return 0.0
    if hurt_df is None or not len(hurt_df):
        return 0.0

    my_wf = wf_df[wf_df["user_steamid"].astype(str) == steamid].copy()
    if my_wf.empty:
        return 0.0

    ah = hurt_df[hurt_df["attacker_steamid"].astype(str) == steamid]
    if ah.empty:
        return 0.0

    # map hurt tick -> hitgroup (1 = head in CS2)
    hurt_map: dict[int, str] = {}
    for _, row in ah.iterrows():
        t = int(row["tick"])
        hg = str(row.get("hitgroup", ""))
        hurt_map[t] = hg

    _NON_BULLET = {
        "weapon_smokegrenade", "weapon_flashbang", "weapon_hegrenade",
        "weapon_molotov", "weapon_incgrenade", "weapon_decoy",
        "weapon_c4",
    }
    all_shot_rows = sorted(
        zip(my_wf["tick"].astype(int), my_wf.get("weapon", [""] * len(my_wf))),
        key=lambda x: x[0],
    )
    shot_rows = [(t, w) for t, w in all_shot_rows
                 if str(w) not in _NON_BULLET and not str(w).startswith("weapon_knife")]

    duel_first_shots: list[int] = []
    prev = None
    for st, _ in shot_rows:
        if prev is None or (st - prev) > DUEL_MERGE_TICKS:
            duel_first_shots.append(st)
        prev = st

    head_hits = 0
    total_hits = 0
    for st in duel_first_shots:
        # look for a hurt event within 8 ticks
        for ht, hg in hurt_map.items():
            if 0 <= ht - st <= 8:
                total_hits += 1
                if hg in ("1", "head", "Head"):
                    head_hits += 1
                break

    return round(head_hits / total_hits * 100, 1) if total_hits else 0.0


# ── Excellent contacts ────────────────────────────────────────────────────────

def _compute_excellent_contacts(
    wf_df,
    hurt_df,
    kills_df,
    vel_lookup: dict,
    steamid: str,
    tickrate: float,
) -> int:
    """
    Count "excellent contacts": winning duels where:
      - attacker velocity <= SHOOT_THRESHOLD (was stopped)
      - first bullet of the duel hit an enemy (first shot accuracy)
    """
    if wf_df is None or not len(wf_df):
        return 0
    if kills_df is None or not len(kills_df):
        return 0

    my_wf = wf_df[wf_df["user_steamid"].astype(str) == steamid].copy()
    if my_wf.empty:
        return 0

    my_kills = kills_df[kills_df["attacker_steamid"].astype(str) == steamid]
    if my_kills.empty:
        return 0

    kill_ticks: set[int] = {int(k["tick"]) for _, k in my_kills.iterrows()}

    # enemy hurt ticks involving this attacker
    enemy_hurt_ticks: set[int] = set()
    if hurt_df is not None and len(hurt_df):
        ah = hurt_df[hurt_df["attacker_steamid"].astype(str) == steamid]
        for t in ah["tick"]:
            enemy_hurt_ticks.add(int(t))

    _NON_BULLET = {
        "weapon_smokegrenade", "weapon_flashbang", "weapon_hegrenade",
        "weapon_molotov", "weapon_incgrenade", "weapon_decoy",
        "weapon_c4",
    }

    all_shot_rows = sorted(
        zip(my_wf["tick"].astype(int), my_wf.get("weapon", [""] * len(my_wf))),
        key=lambda x: x[0],
    )
    shot_rows = [(t, w) for t, w in all_shot_rows
                 if str(w) not in _NON_BULLET and not str(w).startswith("weapon_knife")]

    duel_first_shots: list[tuple[int, str]] = []
    prev = None
    for st, wep in shot_rows:
        if prev is None or (st - prev) > DUEL_MERGE_TICKS:
            duel_first_shots.append((st, str(wep)))
        prev = st

    excellent = 0
    for st, _ in duel_first_shots:
        # must result in a kill within DUEL_MERGE_TICKS
        if not any(0 <= kt - st <= DUEL_MERGE_TICKS for kt in kill_ticks):
            continue
        # first bullet must hit
        hit = any(0 <= ht - st <= 8 for ht in enemy_hurt_ticks)
        if not hit:
            continue
        # attacker must be stopped at shot tick
        vel = _vel_at(vel_lookup, st, steamid)
        if vel > SHOOT_THRESHOLD:
            continue
        excellent += 1

    return excellent

def compute_aim_mechanics(ctx, rb, steamid: str) -> dict:
    """
    Compute all aim mechanics metrics for one player.

    Returns a dict with keys:
      counterStrafeErrors, idealStrafePct, firstBulletAcc,
      firstBulletShots, ttk_ms, reloadErrors, angleControlCount
    """
    ticks_df = ctx.ticks
    tickrate = ctx.tickrate

    wf_df = ctx.ev("weapon_fire") if ctx.has_ev("weapon_fire") else None
    hurt_df = ctx.ev("player_hurt") if ctx.has_ev("player_hurt") else None
    kills_df = ctx.ev("player_death") if ctx.has_ev("player_death") else None

    # build velocity lookup shared across sub-computations
    vel_lookup: dict = {}
    if ticks_df is not None and len(ticks_df):
        try:
            pos = ticks_df[["tick", "steamid", "X", "Y"]].copy()
            pos["steamid"] = pos["steamid"].astype(str)
            pos = pos.sort_values(["steamid", "tick"])
            pos["dx"] = pos.groupby("steamid")["X"].diff().fillna(0.0)
            pos["dy"] = pos.groupby("steamid")["Y"].diff().fillna(0.0)
            pos["dtick"] = pos.groupby("steamid")["tick"].diff().fillna(1.0).clip(lower=1)
            pos["vel"] = (pos["dx"] ** 2 + pos["dy"] ** 2).pow(0.5) / pos["dtick"] * tickrate
            vel_lookup = pos.set_index(["tick", "steamid"])["vel"].to_dict()
        except Exception:
            vel_lookup = {}

    try:
        cs_errors, ideal_pct = _compute_strafe_metrics(
            wf_df, kills_df, vel_lookup, steamid, tickrate
        )
    except Exception:
        cs_errors, ideal_pct = 0, 0.0

    try:
        first_bullet, first_bullet_shots = _compute_first_bullet_acc(wf_df, hurt_df, kills_df, steamid, rb)
    except Exception:
        first_bullet, first_bullet_shots = 0.0, []

    try:
        ttk = _compute_ttk(wf_df, kills_df, steamid, tickrate)
    except Exception:
        ttk = 0.0

    try:
        reload_err = _compute_reload_errors(ctx, rb, steamid, tickrate)
    except Exception:
        reload_err = 0

    try:
        angle_ctrl, angle_ctrl_by_phase = _compute_angle_control(ticks_df, steamid, tickrate, rb)
    except Exception:
        angle_ctrl, angle_ctrl_by_phase = 0, {"early": 0, "mid": 0, "late": 0}

    try:
        reaction_time_ms, overshoot_count, successful_reaction_time_ms, rt_deltas, rt_deltas_hit = _compute_reaction_time(
            ticks_df, wf_df, kills_df, steamid, tickrate, hurt_df
        )
    except Exception:
        reaction_time_ms, overshoot_count, successful_reaction_time_ms = 0.0, 0, 0.0
        rt_deltas, rt_deltas_hit = [], []

    try:
        excellent_contacts = _compute_excellent_contacts(
            wf_df, hurt_df, kills_df, vel_lookup, steamid, tickrate
        )
    except Exception:
        excellent_contacts = 0

    try:
        crosshair_placement = _compute_crosshair_placement(wf_df, hurt_df, steamid)
    except Exception:
        crosshair_placement = 0.0

    return {
        "counterStrafeErrors": cs_errors,
        "idealStrafePct": ideal_pct,
        "firstBulletAcc": first_bullet,
        "firstBulletShots": first_bullet_shots,
        "ttk_ms": ttk,
        "reloadErrors": reload_err,
        "angleControlCount": angle_ctrl,
        "angleControlByPhase": angle_ctrl_by_phase,
        "reactionTimeMs": reaction_time_ms,
        "overshootCount": overshoot_count,
        "excellentContacts": excellent_contacts,
        "crosshairPlacementPct": crosshair_placement,
        "successfulReactionTimeMs": successful_reaction_time_ms,
        "reactionDeltas": [round(v, 1) for v in rt_deltas],
        "reactionDeltasHit": [round(v, 1) for v in rt_deltas_hit],
    }
