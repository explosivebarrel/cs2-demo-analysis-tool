"""Compact replay event stream for the web timeline player."""
import numpy as np

from ..weapons import canon, weapon_id

GUN_CLASSES = {"rifle", "sniper", "smg", "heavy", "pistol"}
NADE_TYPE = {"CSmokeGrenade": 0, "CHEGrenade": 1, "CFlashbang": 2,
             "CMolotovGrenade": 3, "CIncendiaryGrenade": 3, "CDecoyGrenade": 4}


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


def build_events(ctx, rb, fb):
    events = []
    pidx = fb.player_idx

    def idx(sid):
        return pidx.get(str(sid), -1) if sid else -1

    # kills ------------------------------------------------------------
    kills = ctx.ev("player_death")
    if len(kills):
        kills = kills.sort_values("tick")
        for _, k in kills.iterrows():
            a, v = _sid(k.get("attacker_steamid")), _sid(k.get("user_steamid"))
            if not (a and v):
                continue
            events.append({"t": int(k["tick"]), "ty": "k", "a": idx(a), "v": idx(v),
                           "w": weapon_id(k.get("weapon")),
                           "h": 1 if k.get("headshot") else 0,
                           "as": idx(_sid(k.get("assister_steamid")))})

    # shots (muzzle flash tracers) --------------------------------------
    wf = ctx.ev("weapon_fire")
    if len(wf):
        wcls = wf["weapon"].astype(str).map(lambda w: canon(w)[2])
        m = wf[wcls.isin(GUN_CLASSES)].copy()
        # weapon_fire has no yaw — find nearest tick in ctx.ticks per player
        ticks = ctx.ticks
        if ticks is not None and "yaw" in ticks.columns and "steamid" in ticks.columns:
            import pandas as pd
            yaw_df = ticks[["tick", "steamid", "yaw"]].copy()
            yaw_df["steamid"] = yaw_df["steamid"].astype(str)
            yaw_df = yaw_df.drop_duplicates(subset=["tick", "steamid"]).sort_values("tick")
            m["user_steamid"] = m["user_steamid"].astype(str)
            m_sorted = m.sort_values("tick")
            # merge_asof per player: for each shot find nearest tick entry
            parts = []
            for sid, grp in m_sorted.groupby("user_steamid", sort=False):
                player_yaw = yaw_df[yaw_df["steamid"] == sid].sort_values("tick")
                if len(player_yaw) == 0:
                    grp = grp.copy(); grp["yaw"] = 0
                else:
                    grp = pd.merge_asof(grp, player_yaw[["tick", "yaw"]],
                                        on="tick", direction="nearest")
                parts.append(grp)
            m = pd.concat(parts) if parts else m
            yaw_col = "yaw"
        else:
            m["yaw"] = 0
            yaw_col = "yaw"
        def _yaw(v):
            try:
                f = float(v)
                return int(f) % 360 if f == f else 0  # f==f is False for NaN
            except (TypeError, ValueError):
                return 0
        events.append({"ty": "__shots", "rows": [
            [int(row["tick"]), idx(row.get("user_steamid")),
             _f(row.get("user_X")), _f(row.get("user_Y")),
             _yaw(row.get(yaw_col))]
            for _, row in m.iterrows() if row.get("user_steamid") is not None]})

    # grenade trails -----------------------------------------------------
    g = ctx.grenades
    if g is not None and len(g):
        g2 = g.dropna(subset=["steamid"])
        for (_sid_thrower, eid), grp in g2.groupby(["steamid", "grenade_entity_id"]):
            grp = grp.dropna(subset=["x"]).sort_values("tick")
            if not len(grp):
                continue
            gtype = NADE_TYPE.get(str(grp["grenade_type"].iloc[0]), 4)
            # downsample trail to ~4 points/sec
            step = max(1, int(ctx.tickrate / 4))
            pts = []
            rows = grp.iloc[::step]
            if len(grp) and rows.iloc[-1]["tick"] != grp.iloc[-1]["tick"]:
                rows = rows._append(grp.iloc[-1])
            for _, r in rows.iterrows():
                pts.extend((_f(r["x"]), _f(r["y"]), _f(r["z"])))
            events.append({"ty": "g", "t": int(grp["tick"].min()), "g": gtype,
                           "p": idx(_sid_thrower), "tr": pts})

    # detonations & zones -------------------------------------------------
    for ev, ty in (("flashbang_detonate", "fd"), ("smokegrenade_detonate", "sm"),
                   ("hegrenade_detonate", "hd")):
        for _, e in ctx.ev(ev).iterrows():
            events.append({"t": int(e["tick"]), "ty": ty, "x": _f(e.get("x")),
                           "y": _f(e.get("y")), "p": idx(e.get("user_steamid"))})
    for ev, ty in (("smokegrenade_expired", "sx"), ("inferno_expire", "fx")):
        for _, e in ctx.ev(ev).iterrows():
            events.append({"t": int(e["tick"]), "ty": ty, "x": _f(e.get("x")),
                           "y": _f(e.get("y"))})
    for _, e in ctx.ev("inferno_startburn").iterrows():
        events.append({"t": int(e["tick"]), "ty": "fr", "x": _f(e.get("x")),
                       "y": _f(e.get("y")), "p": idx(e.get("user_steamid"))})

    # bomb -----------------------------------------------------------------
    for _, e in ctx.ev("bomb_dropped").iterrows():
        events.append({"t": int(e["tick"]), "ty": "bo"})
    for _, e in ctx.ev("bomb_pickup").iterrows():
        events.append({"t": int(e["tick"]), "ty": "bu", "p": idx(e.get("user_steamid"))})
    for _, e in ctx.ev("bomb_beginplant").iterrows():
        events.append({"t": int(e["tick"]), "ty": "bs", "p": idx(e.get("user_steamid"))})
    for _, e in ctx.ev("bomb_planted").iterrows():
        events.append({"t": int(e["tick"]), "ty": "bp", "p": idx(e.get("user_steamid")),
                       "x": _f(e.get("user_X")), "y": _f(e.get("user_Y")),
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
