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

import math
from collections import defaultdict
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from .context import DemoContext
    from .rounds import RoundBuilder

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
    round_of: dict[int, int] = {}
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

    # for each kill find the earliest shot in the same duel window
    deltas: list[float] = []
    for kt in kill_ticks:
        # look for shots up to DUEL_MERGE_TICKS before the kill
        candidates = [st for st in shot_ticks if 0 <= kt - st <= DUEL_MERGE_TICKS]
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

def _compute_angle_control(ticks_df, steamid: str, tickrate: float, rb) -> int:
    """
    Count distinct map positions where the player stood still for >= ANGLE_HOLD_SEC
    without moving, during live rounds (not freeze time).

    Uses position grid snapping for deduplication across rounds.
    """
    if ticks_df is None or not len(ticks_df):
        return 0

    try:
        import numpy as _np

        # freeze-end and end tick arrays for live-round filtering
        fe_arr = _np.array([r["freezeEndTick"] for r in rb.rounds], dtype="int64")
        end_arr = _np.array([r["endTick"] for r in rb.rounds], dtype="int64")

        mask_sid = ticks_df["steamid"].astype(str) == steamid
        pticks = ticks_df[mask_sid][["tick", "X", "Y"]].copy().sort_values("tick")
        if pticks.empty:
            return 0

        ticks_arr = pticks["tick"].to_numpy(dtype="int64")
        x_arr = pticks["X"].to_numpy(dtype="float64")
        y_arr = pticks["Y"].to_numpy(dtype="float64")

        # filter to live-round ticks only
        live_mask = _np.zeros(len(ticks_arr), dtype=bool)
        for i, t in enumerate(ticks_arr):
            ri = int(_np.searchsorted(fe_arr, t, side="right")) - 1
            if 0 <= ri < len(fe_arr) and t <= end_arr[ri]:
                live_mask[i] = True

        ticks_arr = ticks_arr[live_mask]
        x_arr = x_arr[live_mask]
        y_arr = y_arr[live_mask]
        if len(ticks_arr) < 2:
            return 0

        # compute velocity between consecutive ticks
        dt = _np.diff(ticks_arr).clip(min=1)
        dx = _np.diff(x_arr)
        dy = _np.diff(y_arr)
        vel = _np.sqrt(dx**2 + dy**2) / dt * tickrate

        # find stationary runs
        stationary = _np.concatenate([[False], vel < ANGLE_MOVE_THRESHOLD])
        min_frames = max(1, int(ANGLE_HOLD_SEC * tickrate / 8))  # ticks are every frame_step

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
            else:
                run_len = 0

        return held_count
    except Exception:
        return 0


# ── Public entry point ────────────────────────────────────────────────────────

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
        angle_ctrl = _compute_angle_control(ticks_df, steamid, tickrate, rb)
    except Exception:
        angle_ctrl = 0

    return {
        "counterStrafeErrors": cs_errors,
        "idealStrafePct": ideal_pct,
        "firstBulletAcc": first_bullet,
        "firstBulletShots": first_bullet_shots,
        "ttk_ms": ttk,
        "reloadErrors": reload_err,
        "angleControlCount": angle_ctrl,
    }
