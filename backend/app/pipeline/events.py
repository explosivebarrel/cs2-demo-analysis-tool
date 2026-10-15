from typing import Any

import pandas as pd

from ..weapons import canon, weapon_id

GUN_CLASSES = {"rifle", "sniper", "smg", "heavy", "pistol"}
NADE_TYPE = {
    "CSmokeGrenade": 0, "CSmokeGrenadeProjectile": 0,
    "CHEGrenade": 1, "CHEGrenadeProjectile": 1,
    "CFlashbang": 2, "CFlashbangProjectile": 2,
    "CMolotovGrenade": 3, "CMolotovProjectile": 3,
    "CIncendiaryGrenade": 3, "CIncendiaryGrenadeProjectile": 3,
    "CDecoyGrenade": 4, "CDecoyProjectile": 4,
}


def _sid(v):
    if v is None:
        return None
    s = str(v)
    return s if s and s not in ("None", "nan", "0") else None


def _f(v):
    try:
        fv = float(v)
    except (TypeError, ValueError):
        return 0.0
    return round(fv, 1) if abs(fv) < 1e6 else 0.0


def _build_kill_context(ctx, rb, fb, kills_df):
    """Attach tick-level context to each kill for the event log diagnosis engine.

    Returns a dict keyed by (tick, attacker_steamid, victim_steamid) -> context dict.
    Context fields:
      nearAllyDist  — distance (units) from attacker to nearest alive teammate at kill tick
      flashDur      — flash_duration on victim at kill tick (seconds)
      victimVel     — victim velocity (units/s) at kill tick, approximated from pos delta
      aliveAllies   — alive attacker-side players at kill tick (excluding attacker)
      aliveEnemies  — alive victim-side players at kill tick (including victim, before this kill)
      victimWalking — 1 if victim is_walking at kill tick
    """
    ticks_df = ctx.ticks
    if ticks_df is None or not len(kills_df):
        return {}


    # index ticks by tick value for fast lookup; kills happen at arbitrary
    # ticks while the tick stream is downsampled — fall back to the nearest
    # sampled tick at or before the kill
    ticks_by_tick = {t: grp for t, grp in ticks_df.groupby("tick")}
    import numpy as _np
    _tick_arr = _np.array(sorted(ticks_by_tick), dtype="int64")

    ctx_map = {}

    # build velocity map: for each (tick, steamid) store speed
    # vectorised: sort by (steamid, tick), compute pos delta
    try:
        pos_df = ticks_df[["tick", "steamid", "X", "Y"]].copy()
        pos_df["steamid"] = pos_df["steamid"].astype(str)
        pos_df = pos_df.sort_values(["steamid", "tick"])
        pos_df["dx"] = pos_df.groupby("steamid")["X"].diff().fillna(0.0)
        pos_df["dy"] = pos_df.groupby("steamid")["Y"].diff().fillna(0.0)
        pos_df["dtick"] = pos_df.groupby("steamid")["tick"].diff().fillna(1.0).clip(lower=1)
        pos_df["vel"] = (pos_df["dx"] ** 2 + pos_df["dy"] ** 2).pow(0.5) / pos_df["dtick"] * ctx.tickrate
        vel_lookup = pos_df.set_index(["tick", "steamid"])["vel"].to_dict()
    except Exception:
        vel_lookup = {}

    for _, k in kills_df.iterrows():
        tick = int(k["tick"])
        a_sid = _sid(k.get("attacker_steamid"))
        v_sid = _sid(k.get("user_steamid"))
        if not (a_sid and v_sid):
            continue

        frame = ticks_by_tick.get(tick)
        if frame is None:
            # nearest sampled tick at or before the kill (searchsorted)
            i = int(_np.searchsorted(_tick_arr, tick, side="right")) - 1
            if i >= 0:
                frame = ticks_by_tick.get(int(_tick_arr[i]))
        if frame is None:
            ctx_map[(tick, a_sid, v_sid)] = {}
            continue

        # build per-player state at this tick
        rows = {str(r["steamid"]): r for _, r in frame.iterrows()}
        a_row = rows.get(a_sid)
        v_row = rows.get(v_sid)

        # attacker team
        a_team = int(a_row["team_num"]) if a_row is not None else -1

        # find nearest alive ally
        near_ally_dist = None
        alive_allies = 0
        alive_enemies = 0
        ax = float(a_row["X"]) if a_row is not None else 0.0
        ay = float(a_row["Y"]) if a_row is not None else 0.0
        for sid2, r2 in rows.items():
            if sid2 == a_sid:
                continue
            try:
                alive2 = bool(r2["is_alive"])
                team2 = int(r2["team_num"])
            except (TypeError, ValueError):
                continue
            if not alive2:
                continue
            if team2 == a_team:
                alive_allies += 1
                dx = float(r2["X"]) - ax
                dy = float(r2["Y"]) - ay
                d = (dx * dx + dy * dy) ** 0.5
                if near_ally_dist is None or d < near_ally_dist:
                    near_ally_dist = d
            else:
                alive_enemies += 1

        flash_dur = 0.0
        victim_walking = 0
        if v_row is not None:
            try:
                fd = float(v_row.get("flash_duration", 0) or 0)
                flash_dur = round(fd, 2)
            except (TypeError, ValueError):
                pass
            try:
                victim_walking = 1 if v_row.get("is_walking") else 0
            except (TypeError, ValueError):
                pass

        victim_vel = round(float(vel_lookup.get((tick, v_sid), 0.0)), 1)

        ctx_map[(tick, a_sid, v_sid)] = {
            "nearAllyDist": round(near_ally_dist, 1) if near_ally_dist is not None else None,
            "flashDur": flash_dur,
            "victimVel": victim_vel,
            "aliveAllies": alive_allies,
            "aliveEnemies": alive_enemies,
            "victimWalking": victim_walking,
        }

    return ctx_map


def build_events(ctx, rb, fb):
    events = []
    pidx = fb.player_idx

    def idx(sid):
        return pidx.get(str(sid), -1) if sid else -1

    # kills ------------------------------------------------------------
    kills = ctx.ev("player_death")
    if len(kills):
        kills = kills.sort_values("tick")
        kill_ctx = _build_kill_context(ctx, rb, fb, kills)
        for _, k in kills.iterrows():
            a, v = _sid(k.get("attacker_steamid")), _sid(k.get("user_steamid"))
            if not v:
                continue
            if not a:
                # world/C4/fall deaths belong on the event timeline too
                events.append({"t": int(k["tick"]), "ty": "k", "a": -1, "v": idx(v),
                               "w": weapon_id(k.get("weapon")),
                               "h": 1 if k.get("headshot") else 0, "as": -1})
                continue
            kc = kill_ctx.get((int(k["tick"]), a, v), {})
            ev = {"t": int(k["tick"]), "ty": "k", "a": idx(a), "v": idx(v),
                  "w": weapon_id(k.get("weapon")),
                  "h": 1 if k.get("headshot") else 0,
                  "as": idx(_sid(k.get("assister_steamid")))}
            if kc:
                ev["kc"] = kc
            events.append(ev)

    # hurt hits (bullet impact positions for shot-line rendering) ----------
    # Prefer player_bullet_hit.victim_pos_x/y (real bullet impact point).
    # Fall back to player_hurt.user_X/Y (victim centre) when not available.
    hurt = ctx.ev("player_hurt")
    pbh = ctx.ev("player_bullet_hit")

    # build tick -> list of bullet impacts from player_bullet_hit
    pbh_by_tick: dict[int, list[tuple[float, float, float | None]]] = {}
    if len(pbh) and "victim_pos_x" in pbh.columns:
        has_z = "victim_pos_z" in pbh.columns
        for _, row in pbh.iterrows():
            t = int(row["tick"])
            vz = _f(row["victim_pos_z"]) if has_z and pd.notna(row["victim_pos_z"]) else None
            pbh_by_tick.setdefault(t, []).append((_f(row["victim_pos_x"]), _f(row["victim_pos_y"]), vz))

    if len(hurt):
        for _, h in hurt.iterrows():
            a_sid = _sid(h.get("attacker_steamid"))
            if not a_sid:
                continue
            tick = int(h["tick"])
            # try real impact point from player_bullet_hit on this tick
            impacts = pbh_by_tick.get(tick)
            impact = None
            if impacts:
                if len(impacts) == 1:
                    impact = impacts[0]
                else:
                    vx, vy = h.get("user_X"), h.get("user_Y")
                    if vx is not None and vy is not None:
                        impact = min(impacts, key=lambda p: (p[0] - vx) ** 2 + (p[1] - vy) ** 2)
                    else:
                        impact = impacts[0]

            if impact is not None and impact[2] is not None:
                hx, hy, hz = impact
            else:
                # fallback: victim position with hitgroup height offset (user_Z is feet)
                hx = _f(h.get("user_X"))
                hy = _f(h.get("user_Y"))
                hz_raw = h.get("user_Z")
                if hx is None or hy is None:
                    continue
                # hitgroup can be int or string ('generic', 'head', etc.)
                raw_hg = h.get("hitgroup", 0)
                try:
                    hg = int(raw_hg or 0)
                except (ValueError, TypeError):
                    hg_map = {"head": 1, "chest": 2, "stomach": 3, "left arm": 4, "right arm": 5, "left leg": 6, "right leg": 7}
                    hg = hg_map.get(str(raw_hg).lower(), 0)
                hg_offset = {1: 62.0, 2: 45.0, 3: 32.0, 4: 42.0, 5: 42.0, 6: 15.0, 7: 15.0}.get(hg, 40.0)
                hz = _f(float(hz_raw) + hg_offset) if hz_raw is not None and pd.notna(hz_raw) else None

            hi_ev: dict[str, Any] = {
                "t": tick, "ty": "hi",
                "a": idx(a_sid),
                "x": hx, "y": hy,
            }
            if hz is not None:
                hi_ev["z"] = hz
            events.append(hi_ev)

    # shots (muzzle flash tracers) --------------------------------------
    wf = ctx.ev("weapon_fire")
    if len(wf):
        wcls = wf["weapon"].astype(str).map(lambda w: canon(w)[2])
        m = wf[wcls.isin(GUN_CLASSES)].copy()
        # weapon_fire has no yaw — find nearest tick in ctx.ticks per player
        ticks = ctx.ticks
        has_pitch = ticks is not None and "pitch" in ticks.columns
        if ticks is not None and "yaw" in ticks.columns and "steamid" in ticks.columns:
            cols = ["tick", "steamid", "yaw"] + (["pitch"] if has_pitch else [])
            yaw_df = ticks[cols].copy()
            yaw_df["steamid"] = yaw_df["steamid"].astype(str)
            yaw_df = yaw_df.drop_duplicates(subset=["tick", "steamid"]).sort_values("tick")
            m["user_steamid"] = m["user_steamid"].astype(str)
            m_sorted = m.sort_values("tick")
            # merge_asof per player: for each shot find nearest tick entry
            parts = []
            merge_cols = ["tick", "yaw"] + (["pitch"] if has_pitch else [])
            for sid, grp in m_sorted.groupby("user_steamid", sort=False):
                player_yaw = yaw_df[yaw_df["steamid"] == sid].sort_values("tick")
                if len(player_yaw) == 0:
                    grp = grp.copy()
                    grp["yaw"] = 0
                    if has_pitch:
                        grp["pitch"] = 0.0
                else:
                    grp = pd.merge_asof(grp, player_yaw[merge_cols],
                                        on="tick", direction="backward")
                parts.append(grp)
            m = pd.concat(parts) if parts else m
            yaw_col = "yaw"
            pitch_col = "pitch" if has_pitch else None
        else:
            m["yaw"] = 0
            yaw_col = "yaw"
            pitch_col = None
        def _yaw(v):
            try:
                f = float(v)
                return int(f) % 360 if f == f else 0  # f==f is False for NaN
            except (TypeError, ValueError):
                return 0
        def _pitch(v):
            try:
                f = float(v)
                return round(f, 1) if f == f else 0.0
            except (TypeError, ValueError):
                return 0.0
        events.append({"ty": "__shots", "rows": [
            [int(row["tick"]), idx(row.get("user_steamid")),
             _f(row.get("user_X")), _f(row.get("user_Y")),
             _yaw(row.get(yaw_col)),
             _pitch(row.get(pitch_col)) if pitch_col else 0.0]
            for _, row in m.iterrows() if row.get("user_steamid") is not None]})

    # grenade trails -----------------------------------------------------
    g = ctx.grenades
    if g is not None and len(g):
        import numpy as _np
        fe_arr = _np.array([r["freezeEndTick"] for r in rb.rounds], dtype="int64")
        end_arr = _np.array([r["endTick"] for r in rb.rounds], dtype="int64")

        def _round_for_tick(tick: int):
            """Return (freezeEnd, endTick) of the round containing tick, or None."""
            i = int(_np.searchsorted(fe_arr, tick, side="right")) - 1
            if 0 <= i < len(fe_arr) and tick <= end_arr[i]:
                return (int(fe_arr[i]), int(end_arr[i]))
            return None

        g2 = g.dropna(subset=["steamid"])
        for (_sid_thrower, eid), grp in g2.groupby(["steamid", "grenade_entity_id"]):
            grp = grp.dropna(subset=["x"]).sort_values("tick")
            if not len(grp):
                continue
            gtype = NADE_TYPE.get(str(grp["grenade_type"].iloc[0]), 4)

            # Clip entity to a single round — find the round that contains the
            # first tick of this entity.  Entities that span multiple rounds
            # (a parser artifact) are truncated at the round's endTick.
            first_tick = int(grp["tick"].iloc[0])
            rnd = _round_for_tick(first_tick)
            if rnd is not None:
                grp = grp[grp["tick"] <= rnd[1]]
            if not len(grp):
                continue

            # downsample trail to ~4 points/sec
            step = max(1, int(ctx.tickrate / 4))
            pts = []
            rows = grp.iloc[::step]
            if len(grp) and rows.iloc[-1]["tick"] != grp.iloc[-1]["tick"]:
                rows = pd.concat([rows, grp.iloc[[-1]]])
            for _, r in rows.iterrows():
                pts.extend((_f(r["x"]), _f(r["y"]), _f(r["z"])))
            if len(pts) < 6:
                continue
            events.append({"ty": "g", "t": int(grp["tick"].min()), "g": gtype,
                           "p": idx(_sid_thrower), "tr": pts})

    # detonations & zones -------------------------------------------------
    for ev, ty in (("flashbang_detonate", "fd"), ("smokegrenade_detonate", "sm"),
                   ("hegrenade_detonate", "hd")):
        for _, e in ctx.ev(ev).iterrows():
            events.append({"t": int(e["tick"]), "ty": ty, "x": _f(e.get("x")),
                           "y": _f(e.get("y")), "z": _f(e.get("z")), "p": idx(e.get("user_steamid"))})
    for ev, ty in (("smokegrenade_expired", "sx"), ("inferno_expire", "fx")):
        for _, e in ctx.ev(ev).iterrows():
            events.append({"t": int(e["tick"]), "ty": ty, "x": _f(e.get("x")),
                           "y": _f(e.get("y")), "z": _f(e.get("z"))})
    for _, e in ctx.ev("inferno_startburn").iterrows():
        events.append({"t": int(e["tick"]), "ty": "fr", "x": _f(e.get("x")),
                       "y": _f(e.get("y")), "z": _f(e.get("z")), "p": idx(e.get("user_steamid"))})

    # player blinds: per-victim events with blind duration in seconds ------
    for _, e in ctx.ev("player_blind").iterrows():
        events.append({"t": int(e["tick"]), "ty": "fl", "p": idx(e.get("user_steamid")),
                       "d": _f(e.get("blind_duration"))})

    # bomb -----------------------------------------------------------------
    for _, e in ctx.ev("bomb_dropped").iterrows():
        events.append({"t": int(e["tick"]), "ty": "bo", "p": idx(e.get("user_steamid")),
                       "x": _f(e.get("user_X")), "y": _f(e.get("user_Y")), "z": _f(e.get("user_Z"))})
    for _, e in ctx.ev("bomb_pickup").iterrows():
        events.append({"t": int(e["tick"]), "ty": "bu", "p": idx(e.get("user_steamid"))})
    for _, e in ctx.ev("bomb_beginplant").iterrows():
        events.append({"t": int(e["tick"]), "ty": "bs", "p": idx(e.get("user_steamid"))})
    for _, e in ctx.ev("bomb_planted").iterrows():
        events.append({"t": int(e["tick"]), "ty": "bp", "p": idx(e.get("user_steamid")),
                       "x": _f(e.get("user_X")), "y": _f(e.get("user_Y")), "z": _f(e.get("user_Z")),
                       "site": int(e.get("site", 0) or 0)})
    for _, e in ctx.ev("bomb_begindefuse").iterrows():
        events.append({"t": int(e["tick"]), "ty": "bz", "p": idx(e.get("user_steamid")),
                       "k": 1 if e.get("haskit") else 0})
    for _, e in ctx.ev("bomb_defused").iterrows():
        events.append({"t": int(e["tick"]), "ty": "bf", "p": idx(e.get("user_steamid"))})
    for _, e in ctx.ev("bomb_exploded").iterrows():
        events.append({"t": int(e["tick"]), "ty": "bx"})

    # rounds ----------------------------------------------------------------
    for r in rb.rounds:
        events.append({"t": r["freezeEndTick"], "ty": "r", "n": r["n"],
                       "e": r["endTick"], "w": r["winnerTeam"], "rs": r["reason"]})

    # split the __shots pseudo-event into its own bucket
    shots = []
    normal = []
    for e in events:
        if e.get("ty") == "__shots":
            shots = e["rows"]
        else:
            normal.append(e)
    normal.sort(key=lambda e: e["t"])
    return {"events": normal, "shots": shots}
