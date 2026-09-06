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
DUEL_MERGE_SEC = 2.0         # seconds gap between separate duels
BULLET_HIT_WINDOW_SEC = 0.15 # hurt must follow the shot within this window to
                             # count as a hit by that bullet (scales with tickrate)
TTK_MAX_SEC = 3.0            # first shot searched up to this far before a kill


# ── Helpers ──────────────────────────────────────────────────────────────────

_NON_BULLET_CLASSES = {"grenade", "knife", "gear", "other", "?"}


def _is_non_bullet(wname) -> bool:
    """True for grenades, knives, C4, Zeus — anything that is not a firearm.

    Normalizes via canon() so both 'weapon_smokegrenade' and 'smokegrenade'
    styles are handled."""
    from ..weapons import canon
    if wname is None or (isinstance(wname, float) and wname != wname):
        return False
    return canon(str(wname))[2] in _NON_BULLET_CLASSES

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


def _vel_at(vel_index: "VelIndex", tick: int, steamid: str) -> float:
    return vel_index.at(tick, steamid)


class VelIndex:
    """Positional velocity at arbitrary event ticks.

    Tick samples sit on the downsample grid (~0.125 s), but event ticks
    (shots, kills) are arbitrary — an exact-tick dict lookup misses ~7/8 of
    the time and silently yields 0. Here the two samples bracketing the event
    tick give a central difference, which is alignment-independent.
    """

    def __init__(self, ticks_df, tickrate: float):
        self.empty = True
        try:
            import numpy as _np

            pos = ticks_df[["tick", "steamid", "X", "Y"]].copy()
            pos["steamid"] = pos["steamid"].astype(str)
            pos = pos.sort_values(["steamid", "tick"])
            self.by_sid: dict[str, tuple] = {}
            for sid, grp in pos.groupby("steamid"):
                self.by_sid[sid] = (
                    grp["tick"].to_numpy(dtype="int64"),
                    grp["X"].to_numpy(dtype=float),
                    grp["Y"].to_numpy(dtype=float),
                )
            self.tickrate = float(tickrate)
            self.empty = not self.by_sid
            self._np = _np
        except Exception:
            self.empty = True

    def at(self, tick: int, steamid: str, default: float = 0.0) -> float:
        if self.empty:
            return default
        entry = self.by_sid.get(steamid)
        if entry is None:
            return default
        t_arr, x_arr, y_arr = entry
        import bisect
        i = bisect.bisect_left(t_arr, tick)
        if i == 0:
            j0, j1 = 0, 1
        elif i >= len(t_arr):
            j0, j1 = len(t_arr) - 2, len(t_arr) - 1
        else:
            j0, j1 = i - 1, i
        if j1 >= len(t_arr) or j1 == j0:
            return default
        dt = int(t_arr[j1] - t_arr[j0])
        if dt <= 0:
            return default
        dist = self._np.hypot(x_arr[j1] - x_arr[j0], y_arr[j1] - y_arr[j0])
        return float(dist / dt * self.tickrate)


def _build_vel_index(ticks_df, tickrate: float) -> VelIndex:
    return VelIndex(ticks_df, tickrate)


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
    vel_index: VelIndex,
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

    # only firearms count as shots (no knives/grenades/zeus)
    my_wf = my_wf[~my_wf["weapon"].astype(str).map(_is_non_bullet)]
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

    # group shots by "duel" — gap > DUEL_MERGE_SEC separates duels
    merge_ticks = max(32, int(DUEL_MERGE_SEC * tickrate))
    shot_ticks = sorted(int(t) for t in my_wf["tick"])
    duel_starts: list[int] = []
    prev = None
    for st in shot_ticks:
        if prev is None or (st - prev) > merge_ticks:
            duel_starts.append(st)
        prev = st

    duel_start_set = set(duel_starts)

    for _, row in my_wf.iterrows():
        tick = int(row["tick"])
        vel = _vel_at(vel_index, tick, steamid)

        if vel > SHOOT_THRESHOLD:
            errors += 1

        # duel-opening shots that resulted in a kill within the duel window
        if tick in duel_start_set:
            for kt in kill_ticks:
                if 0 <= kt - tick <= merge_ticks:
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
    tickrate: float = 64.0,
    enemy_sids: set | None = None,
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
    my_wf = my_wf[~my_wf["weapon"].astype(str).map(_is_non_bullet)]
    if my_wf.empty:
        return 0.0, []

    # enemy hurt ticks involving this attacker (bullet damage only, enemies only)
    enemy_hurt_ticks: set[int] = set()
    if hurt_df is not None and len(hurt_df):
        ah = hurt_df[hurt_df["attacker_steamid"].astype(str) == steamid]
        ah = ah[~ah["weapon"].astype(str).map(_is_non_bullet)]
        for _, row in ah.iterrows():
            if enemy_sids is None or _sid(row.get("user_steamid")) in enemy_sids:
                enemy_hurt_ticks.add(int(row["tick"]))

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

    merge_ticks = max(32, int(DUEL_MERGE_SEC * tickrate))

    merge_ticks = max(32, int(DUEL_MERGE_SEC * tickrate))
    hit_window = max(1, int(BULLET_HIT_WINDOW_SEC * tickrate))

    all_shot_rows = sorted(zip(my_wf["tick"].astype(int), my_wf.get("weapon", [""] * len(my_wf))), key=lambda x: x[0])
    # keep only actual bullet-firing weapons
    shot_rows = [(t, w) for t, w in all_shot_rows if not _is_non_bullet(w)]
    duel_first_shots: list[tuple[int, str]] = []
    prev = None
    for st, wep in shot_rows:
        if prev is None or (st - prev) > merge_ticks:
            duel_first_shots.append((st, str(wep)))
        prev = st

    per_shot: list[dict] = []
    hit_total = 0
    for st, wep in duel_first_shots:
        hit = any(0 <= ht - st <= hit_window for ht in enemy_hurt_ticks)
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

    # for each kill find the earliest shot within TTK_MAX_SEC before it.
    # Long engagements are the most informative for TTK — a 0.5s window would
    # cap the metric by construction and silently drop long duels.
    TTK_MAX_TICKS = max(32, int(tickrate * TTK_MAX_SEC))
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
        # ticks between samples follow the pipeline downsample step, not a
        # fixed 8 — derive it from tickrate the same way context.py does
        sample_step = max(4, round(tickrate * 0.125))
        min_frames = max(1, int(ANGLE_HOLD_SEC * tickrate / sample_step))

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



# ── Reaction time ────────────────────────────────────────────────────────────

RT_WINDOW_SEC = 2.0     # look back up to 2s before first shot for victim motion onset
RT_MAX_MS = 1500.0      # cap: longer values are pre-aim scenarios, not true reaction
RT_MOTION_THRESH = 30.0 # u/s — victim speed above this = "victim is moving/peeking"


def _compute_reaction_time(
    ticks_df,
    wf_df,
    kills_df,
    steamid: str,
    tickrate: float,
    hurt_df=None,
    enemy_sids: set | None = None,
) -> tuple[float, float, list[float], list[float]]:
    """
    Returns (avg_reaction_time_ms, successful_reaction_time_ms,
             reaction_deltas, reaction_deltas_hit).

    reaction_time_ms: avg ms from when the victim started moving (peek onset)
                      to the attacker's first shot in winning duels.
    successful_reaction_time_ms: same as reaction_time_ms but only for duels
                     where the first bullet hit an enemy.
    """
    if ticks_df is None or not len(ticks_df) or kills_df is None or not len(kills_df):
        return 0.0, 0.0, [], []

    my_kills = kills_df[kills_df["attacker_steamid"].astype(str) == steamid]
    if my_kills.empty:
        return 0.0, 0.0, [], []

    if wf_df is None or not len(wf_df):
        return 0.0, 0.0, [], []

    my_wf = wf_df[wf_df["user_steamid"].astype(str) == steamid].copy()
    if my_wf.empty:
        return 0.0, 0.0, [], []

    # enemy hurt ticks for successful reaction time (hit on first bullet)
    enemy_hurt_ticks_rt: set[int] = set()
    if hurt_df is not None and len(hurt_df):
        ah = hurt_df[hurt_df["attacker_steamid"].astype(str) == steamid]
        for _, row in ah.iterrows():
            if enemy_sids is None or _sid(row.get("user_steamid")) in enemy_sids:
                enemy_hurt_ticks_rt.add(int(row["tick"]))

    import numpy as _np

    wf_ticks_sorted = sorted(int(t) for t in my_wf["tick"])
    window_ticks = int(tickrate * RT_WINDOW_SEC)
    TTK_MAX_TICKS = max(32, int(tickrate * TTK_MAX_SEC))

    reaction_deltas: list[float] = []
    reaction_deltas_hit: list[float] = []

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
                # victim was moving the whole window: onset is the window start,
                # not the shot tick (that would collapse reaction time to ~0)
                peek_onset_tick = int(vic_tick_arr[j + 1]) if j >= 0 else int(vic_tick_arr[0])
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

    # average from the same rounded values that get stored, so the UI's
    # recomputation from reactionDeltas matches the reported mean exactly
    rounded = [round(v, 1) for v in reaction_deltas]
    rounded_hit = [round(v, 1) for v in reaction_deltas_hit]
    avg_rt = round(sum(rounded) / len(rounded), 1) if rounded else 0.0
    avg_rt_hit = round(sum(rounded_hit) / len(rounded_hit), 1) if rounded_hit else 0.0
    return avg_rt, avg_rt_hit, rounded, rounded_hit


# ── Crosshair placement ───────────────────────────────────────────────────────

def _compute_crosshair_placement(
    wf_df,
    hurt_df,
    steamid: str,
    tickrate: float = 64.0,
) -> float:
    """
    % of duel-opening shots that landed on the head. The denominator is ALL
    duel-opening shots (not only the ones that hit): a full miss is the main
    symptom of bad crosshair placement and must lower the metric.
    """
    if wf_df is None or not len(wf_df):
        return 0.0

    my_wf = wf_df[wf_df["user_steamid"].astype(str) == steamid].copy()
    if my_wf.empty:
        return 0.0
    my_wf = my_wf[~my_wf["weapon"].astype(str).map(_is_non_bullet)]
    if my_wf.empty:
        return 0.0

    ah = hurt_df[hurt_df["attacker_steamid"].astype(str) == steamid] if hurt_df is not None and len(hurt_df) else hurt_df

    # map hurt tick -> hitgroup (1 = head in CS2)
    hurt_map: dict[int, str] = {}
    if ah is not None and len(ah):
        for _, row in ah.iterrows():
            if _is_non_bullet(row.get("weapon")):
                continue
            t = int(row["tick"])
            hg = str(row.get("hitgroup", ""))
            hurt_map[t] = hg

    merge_ticks = max(32, int(DUEL_MERGE_SEC * tickrate))
    hit_window = max(1, int(BULLET_HIT_WINDOW_SEC * tickrate))

    duel_first_shots: list[int] = []
    prev = None
    for st in sorted(int(t) for t in my_wf["tick"]):
        if prev is None or (st - prev) > merge_ticks:
            duel_first_shots.append(st)
        prev = st

    if not duel_first_shots:
        return 0.0

    head_hits = 0
    for st in duel_first_shots:
        # look for a hurt event within the bullet window
        for ht, hg in hurt_map.items():
            if 0 <= ht - st <= hit_window:
                if hg in ("1", "head", "Head"):
                    head_hits += 1
                break

    return round(head_hits / len(duel_first_shots) * 100, 1)


# ── Excellent contacts ────────────────────────────────────────────────────────

def _compute_excellent_contacts(
    wf_df,
    hurt_df,
    kills_df,
    vel_index: VelIndex,
    steamid: str,
    tickrate: float,
    enemy_sids: set | None = None,
) -> tuple[int, list[int]]:
    """
    Count "excellent contacts": winning duels where:
      - attacker velocity <= SHOOT_THRESHOLD (was stopped)
      - first bullet of the duel hit an enemy (first shot accuracy)
    Returns (count, kill_ticks) so the UI can list the exact episodes.
    """
    if wf_df is None or not len(wf_df):
        return 0, []
    if kills_df is None or not len(kills_df):
        return 0, []

    my_wf = wf_df[wf_df["user_steamid"].astype(str) == steamid].copy()
    if my_wf.empty:
        return 0, []

    my_kills = kills_df[kills_df["attacker_steamid"].astype(str) == steamid]
    if my_kills.empty:
        return 0, []

    kill_ticks: set[int] = {int(k["tick"]) for _, k in my_kills.iterrows()}

    # enemy hurt ticks involving this attacker (enemies only)
    enemy_hurt_ticks: set[int] = set()
    if hurt_df is not None and len(hurt_df):
        ah = hurt_df[hurt_df["attacker_steamid"].astype(str) == steamid]
        for _, row in ah.iterrows():
            if enemy_sids is None or _sid(row.get("user_steamid")) in enemy_sids:
                enemy_hurt_ticks.add(int(row["tick"]))

    all_shot_rows = sorted(
        zip(my_wf["tick"].astype(int), my_wf.get("weapon", [""] * len(my_wf))),
        key=lambda x: x[0],
    )
    shot_rows = [(t, w) for t, w in all_shot_rows if not _is_non_bullet(w)]

    merge_ticks = max(32, int(DUEL_MERGE_SEC * tickrate))
    hit_window = max(1, int(BULLET_HIT_WINDOW_SEC * tickrate))

    duel_first_shots: list[tuple[int, str]] = []
    prev = None
    for st, wep in shot_rows:
        if prev is None or (st - prev) > merge_ticks:
            duel_first_shots.append((st, str(wep)))
        prev = st

    excellent = 0
    excellent_ticks: list[int] = []
    for st, _ in duel_first_shots:
        # must result in a kill within the duel window; store the KILL tick —
        # duel episodes are keyed by kill ticks on the frontend
        kt_match = [kt for kt in kill_ticks if 0 <= kt - st <= merge_ticks]
        if not kt_match:
            continue
        # first bullet must hit
        hit = any(0 <= ht - st <= hit_window for ht in enemy_hurt_ticks)
        if not hit:
            continue
        # attacker must be stopped at shot tick
        vel = _vel_at(vel_index, st, steamid)
        if vel > SHOOT_THRESHOLD:
            continue
        excellent += 1
        excellent_ticks.append(min(kt_match))

    return excellent, excellent_ticks

def compute_aim_mechanics(ctx, rb, steamid: str) -> dict:
    """
    Compute all aim mechanics metrics for one player.

    Returns a dict with keys:
      counterStrafeErrors, idealStrafePct, firstBulletAcc,
      firstBulletShots, ttk_ms, reloadErrors, angleControlCount
    """
    ticks_df = ctx.ticks
    tickrate = ctx.tickrate

    # enemies of this player (for hurt-based hit checks); unknown team keeps
    # the old all-hurts behavior
    my_team = rb.steamid_team.get(steamid)
    enemy_sids = {s for s, t in rb.steamid_team.items() if t != my_team}

    wf_df = ctx.ev("weapon_fire") if ctx.has_ev("weapon_fire") else None
    hurt_df = ctx.ev("player_hurt") if ctx.has_ev("player_hurt") else None
    kills_df = ctx.ev("player_death") if ctx.has_ev("player_death") else None

    # build velocity index shared across sub-computations
    vel_index = VelIndex(ticks_df, tickrate)

    try:
        cs_errors, ideal_pct = _compute_strafe_metrics(
            wf_df, kills_df, vel_index, steamid, tickrate
        )
    except Exception:
        cs_errors, ideal_pct = 0, 0.0

    try:
        first_bullet, first_bullet_shots = _compute_first_bullet_acc(
            wf_df, hurt_df, kills_df, steamid, rb, tickrate, enemy_sids)
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
        reaction_time_ms, successful_reaction_time_ms, rt_deltas, rt_deltas_hit = _compute_reaction_time(
            ticks_df, wf_df, kills_df, steamid, tickrate, hurt_df, enemy_sids)
    except Exception:
        reaction_time_ms, successful_reaction_time_ms = 0.0, 0.0
        rt_deltas, rt_deltas_hit = [], []

    try:
        excellent_contacts, excellent_ticks = _compute_excellent_contacts(
            wf_df, hurt_df, kills_df, vel_index, steamid, tickrate, enemy_sids)
    except Exception:
        excellent_contacts, excellent_ticks = 0, []

    try:
        crosshair_placement = _compute_crosshair_placement(wf_df, hurt_df, steamid, tickrate)
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
        "excellentContacts": excellent_contacts,
        "excellentContactTicks": excellent_ticks,
        "crosshairPlacementPct": crosshair_placement,
        "successfulReactionTimeMs": successful_reaction_time_ms,
        "reactionDeltas": [round(v, 1) for v in rt_deltas],
        "reactionDeltasHit": [round(v, 1) for v in rt_deltas_hit],
    }
