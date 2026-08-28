"""Per-player metrics: kills, damage, utility, trades, multikills, weapons,
bomb actions, movement, survival + per-round bookkeeping used by rating."""
import math
from collections import defaultdict

import numpy as np

from .. import config
from ..weapons import canon
from .rounds import _clean_clan

GUN_CLASSES = {"rifle", "sniper", "smg", "heavy", "pistol"}
METERS_PER_UNIT = 0.01905


def _sid(v):
    if v is None:
        return None
    s = str(v)
    return s if s and s not in ("None", "nan", "0") else None


class PlayerStats:
    def __init__(self, steamid, name, team, clan):
        self.steamid = steamid
        self.name = name
        self.team = team
        self.clan = clan
        self.rounds: dict[int, dict] = defaultdict(lambda: {
            "kills": 0, "deaths": 0, "assists": 0, "flashAssists": 0,
            "dmg": 0.0, "taken": 0.0, "utilDmg": 0.0, "postPlantDmg": 0.0,
            "postPlantTaken": 0.0, "enemyFlashed": 0, "blindSec": 0.0,
            "effectiveFlashes": 0, "plant": 0, "defuse": 0, "defuseAttempt": 0,
            "tradedDeath": False, "tradedKill": False, "opening": None,
            "shots": 0, "hits": 0, "survived": False,
        })
        self.weapons: dict[str, dict] = defaultdict(lambda: {
            "kills": 0, "hs": 0, "shots": 0, "hits": 0, "dmg": 0.0})
        self.hitgroups: dict[str, int] = defaultdict(int)
        self.openingKills = 0
        self.openingDeaths = 0
        self.tradeKills = 0
        self.tradedDeaths = 0
        self.multiKills = {2: 0, 3: 0, 4: 0, 5: 0}
        self.multiKillRounds = 0
        self.flashThrows = 0
        self.friendlyFlashed = 0
        self.smokeThrows = 0
        self.heThrows = 0
        self.fireThrows = 0
        self.decoyThrows = 0
        self.teamDmg = 0.0
        self.plants = 0
        self.defuses = 0
        self.defuseAttempts = 0
        self.defuseKits = 0
        self.saves = 0
        self.distanceUnits = 0.0
        self.aliveSeconds = 0.0
        self.holds = []
        self.positions = []
        self.clutchAttempts: list[dict] = []
        self.totalSpend = 0
        self.spendSamples = 0
        self.kdPairs = {}     # (round, victim, attacker) -> dmg victim dealt to attacker
        self.killDist = []
        self.kastRounds = set()

    def r(self, n) -> dict:
        return self.rounds[n]

    def rounds_played(self) -> int:
        return len(self.rounds)

    def clutch_wins(self) -> int:
        return sum(1 for c in self.clutchAttempts if c.get("won"))


def compute_players(ctx, rb, fb):
    names = {}
    clans = {}
    for r in rb.rounds:
        for sid, nm in r.get("clans", {}).items():
            if sid not in clans and nm:
                clans[sid] = nm
    rows_first = ctx.ticks.groupby("steamid")["name"].first()
    for sid in rows_first.index:
        names[str(sid)] = str(rows_first[sid])

    players: dict[str, PlayerStats] = {}
    rounds_by_n = {r["n"]: r for r in rb.rounds}
    for sid, team in rb.steamid_team.items():
        players[sid] = PlayerStats(sid, names.get(sid, sid), team, clans.get(sid, ""))

    tr = ctx.tickrate
    trade_window = int(config.TRADE_WINDOW_SECONDS * tr)

    kills = ctx.ev("player_death")
    kills = kills.sort_values("tick") if len(kills) else kills
    hurt = ctx.ev("player_hurt")
    hurt = hurt.sort_values("tick") if len(hurt) else hurt
    blinds = ctx.ev("player_blind")
    wf = ctx.ev("weapon_fire")

    # pre-resolve round ranges for tick -> round mapping
    fe_ticks = np.array([r["freezeEndTick"] for r in rb.rounds], dtype="int64")
    end_ticks = np.array([r["endTick"] for r in rb.rounds], dtype="int64")
    round_ns = [r["n"] for r in rb.rounds]

    def round_of_tick(t: int):
        i = int(np.searchsorted(fe_ticks, t, side="right")) - 1
        if i < 0:
            return None
        if t <= end_ticks[i]:
            return rb.rounds[i]
        return None

    def P(sid):
        return players.get(sid) if sid else None

    # ---------------------------------------------------------- damage
    if len(hurt):
        ht = hurt["tick"].to_numpy()
        a_arr = hurt["attacker_steamid"].astype(str).to_numpy()
        v_arr = hurt["user_steamid"].astype(str).to_numpy()
        dh = hurt["dmg_health"].fillna(0).to_numpy(dtype="float64")
        wp = hurt["weapon"].astype(str).to_numpy()
        hg = hurt["hitgroup"].astype(str).to_numpy()
        for i in range(len(hurt)):
            a, v = _sid(a_arr[i]), _sid(v_arr[i])
            if not v:
                continue
            pv = P(v)
            rr = round_of_tick(int(ht[i]))
            n = rr["n"] if rr else 0
            if pv is not None:
                pv.r(n)["taken"] += dh[i]
            pa = P(a)
            if pa is None or a == v:
                continue
            if pa.team == (pv.team if pv else -1):
                pa.teamDmg += dh[i]
                continue
            cls = canon(wp[i])[2]
            pa.r(n)["dmg"] += dh[i]
            if cls == "grenade":
                pa.r(n)["utilDmg"] += dh[i]
            if cls in GUN_CLASSES:
                pa.weapons[wp[i]]["hits"] += 1
                pa.r(n)["hits"] += 1
            pa.weapons[wp[i]]["dmg"] += dh[i]
            pa.hitgroups[hg[i]] += 1
            if rr and rr.get("plantTick") and int(ht[i]) > rr["plantTick"]:
                pa.r(n)["postPlantDmg"] += dh[i]
                if pv is not None:
                    pv.r(n)["postPlantTaken"] += dh[i]
            if pv is not None:
                pv.kdPairs[(n, v, a)] = pv.kdPairs.get((n, v, a), 0.0) + dh[i]

    # ---------------------------------------------------------- kills / trades
    if len(kills):
        kt = kills["tick"].to_numpy()
        a_arr = kills["attacker_steamid"].astype(str).to_numpy()
        v_arr = kills["user_steamid"].astype(str).to_numpy()
        as_arr = kills["assister_steamid"].astype(str).to_numpy()
        w_arr = kills["weapon"].astype(str).to_numpy()
        hs_arr = kills["headshot"].to_numpy().astype(bool)
        dist = kills["distance"].to_numpy(dtype="float64")
        afl = kills["assistedflash"].to_numpy().astype(bool)

        # main pass: kills / deaths / assists / per-weapon
        for i in range(len(kills)):
            t = int(kt[i])
            a, v = _sid(a_arr[i]), _sid(v_arr[i])
            ass = _sid(as_arr[i])
            rr = round_of_tick(t)
            n = rr["n"] if rr else 0
            pv = P(v)
            if pv is not None:
                pv.r(n)["deaths"] += 1
            pa = P(a)
            if pa is not None and a != v:
                pa.r(n)["kills"] += 1
                pa.weapons[w_arr[i]]["kills"] += 1
                if hs_arr[i]:
                    pa.weapons[w_arr[i]]["hs"] += 1
                if pv is not None and pv.kdPairs.get((n, v, a), 0.0) == 0.0:
                    pa.r(n)["dmglessKill"] = pa.r(n).get("dmglessKill", 0) + 1
                if math.isfinite(dist[i]) and dist[i] > 0:
                    pa.killDist.append(float(dist[i]))
                fb.clutch.note_kill(a, n)
            pas = P(ass)
            if pas is not None and ass not in (a, v):
                if afl[i]:
                    pas.r(n)["flashAssists"] += 1
                else:
                    pas.r(n)["assists"] += 1

        # pass 2: traded deaths & trade kills
        # for each kill i (killer a kills victim v): find next kill j where victim == a,
        # within window, killer2 teammate of v -> trade for victim v
        victim_index: dict[str, list[int]] = defaultdict(list)
        for i in range(len(kills)):
            v = _sid(v_arr[i])
            if v:
                victim_index[v].append(i)
        for lst in victim_index.values():
            lst.sort(key=lambda i: int(kt[i]))
        for i in range(len(kills)):
            a, v = _sid(a_arr[i]), _sid(v_arr[i])
            if not a or not v:
                continue
            pv = P(v)
            if pv is None:
                continue
            lst = victim_index.get(a, [])
            t_i = int(kt[i])
            j0 = int(np.searchsorted([int(kt[j]) for j in lst], t_i, side="right"))
            for j in lst[j0:]:
                if int(kt[j]) - t_i > trade_window:
                    break
                m = _sid(a_arr[j])
                pm = P(m)
                if pm is None or m == a or pm.team != pv.team:
                    continue
                pm.tradeKills += 1
                pm.r(round_of_tick(int(kt[j]))["n"] if round_of_tick(int(kt[j])) else 0)["tradedKill"] = True
                pv.tradedDeaths += 1
                pv.r(n)["tradedDeath"] = True
                break

        # opening kills
        for rr in rb.rounds:
            ok = rr.get("openingKill")
            if not ok:
                continue
            pa = P(ok["attacker"])
            pv = P(ok["victim"])
            if pa:
                pa.openingKills += 1
                pa.r(rr["n"])["opening"] = "k"
            if pv:
                pv.openingDeaths += 1
                pv.r(rr["n"])["opening"] = "d"

        # multikills
        per_round: dict[tuple[str, int], int] = defaultdict(int)
        for i in range(len(kills)):
            a = _sid(a_arr[i])
            rr = round_of_tick(int(kt[i]))
            if a and rr:
                per_round[(a, rr["n"])] += 1
        for (a, n), c in per_round.items():
            pa = P(a)
            if pa and c >= 2:
                pa.multiKillRounds += 1
                pa.multiKills[min(5, c)] += 1

    # ---------------------------------------------------------- flash stats
    if len(blinds):
        bt = blinds["tick"].to_numpy()
        a_arr = blinds["attacker_steamid"].astype(str).to_numpy()
        v_arr = blinds["user_steamid"].astype(str).to_numpy()
        dur = blinds["blind_duration"].fillna(0).to_numpy(dtype="float64")
        for i in range(len(blinds)):
            a, v = _sid(a_arr[i]), _sid(v_arr[i])
            pa, pv = P(a), P(v)
            if pa is None or pv is None or a == v:
                continue
            if pa.team == pv.team:
                pa.friendlyFlashed += 1
                continue
            rr = round_of_tick(int(bt[i]))
            n = rr["n"] if rr else 0
            pa.r(n)["enemyFlashed"] += 1
            pa.r(n)["blindSec"] += float(dur[i])
            if dur[i] >= config.FLASH_EFFECTIVE_SECONDS:
                pa.r(n)["effectiveFlashes"] += 1

    # ---------------------------------------------------------- grenade throws
    g = ctx.grenades
    if g is not None and len(g):
        type_map = {"CSmokeGrenade": "smoke", "CHEGrenade": "he", "CFlashbang": "flash",
                    "CMolotovGrenade": "fire", "CIncendiaryGrenade": "fire",
                    "CDecoyGrenade": "decoy"}
        g2 = g.dropna(subset=["steamid"])
        try:
            seg = g2.groupby(["steamid", "grenade_entity_id"])["grenade_type"].first()
        except Exception:
            seg = []
        for (sid, _eid), gtype in seg.items():
            p = players.get(str(sid))
            if p is None:
                continue
            t = type_map.get(str(gtype))
            if t == "flash":
                p.flashThrows += 1
            elif t == "smoke":
                p.smokeThrows += 1
            elif t == "he":
                p.heThrows += 1
            elif t == "fire":
                p.fireThrows += 1
            elif t == "decoy":
                p.decoyThrows += 1

    # ---------------------------------------------------------- shots (gun trigger pulls)
    if len(wf):
        wf2 = wf.copy()
        wf2["cls"] = wf2["weapon"].astype(str).map(lambda w: canon(w)[2])
        guns = wf2[wf2["cls"].isin(GUN_CLASSES)]
        for (sid, w), c in guns.groupby(["user_steamid", "weapon"]).size().items():
            p = players.get(str(sid))
            if p:
                key = str(w).removeprefix("weapon_")
                p.weapons[key]["shots"] += int(c)

    # ---------------------------------------------------------- bomb actions
    for rr in rb.rounds:
        p = P(rr.get("planter"))
        if p and rr.get("bombPlanted"):
            p.plants += 1
            p.r(rr["n"])["plant"] += 1
        p = P(rr.get("defuser"))
        if p:
            p.defuses += 1
            p.r(rr["n"])["defuse"] += 1

    bd = ctx.ev("bomb_begindefuse")
    if len(bd):
        bt = bd["tick"].to_numpy()
        u_arr = bd["user_steamid"].astype(str).to_numpy()
        kit = bd["haskit"].to_numpy().astype(bool)
        for i in range(len(bd)):
            p = P(_sid(u_arr[i]))
            if p:
                p.defuseAttempts += 1
                if kit[i]:
                    p.defuseKits += 1
                rr = round_of_tick(int(bt[i]))
                if rr:
                    p.r(rr["n"])["defuseAttempt"] += 1

    # ---------------------------------------------------------- clutch attempts
    for c in fb.clutch.attempts:
        p = P(c["player"])
        if p:
            p.clutchAttempts.append({"round": c["round"], "enemies": c["maxEnemies"],
                                     "won": c["won"], "kills": c["kills"]})

    # ---------------------------------------------------------- frame stats
    for sid, st in players.items():
        fs = fb.stats.get(sid, {})
        st.distanceUnits = fs.get("distanceUnits", 0.0)
        st.aliveSeconds = fs.get("aliveSeconds", 0.0)
        st.holds = fs.get("holds", [])
        st.positions = fs.get("positions", [])
        alive_at_end = fs.get("aliveAtEnd", {})
        for rr in rb.rounds:
            pr = st.r(rr["n"])
            pr["survived"] = bool(alive_at_end.get(str(rr["n"])))
            if not pr["survived"] and rr["winnerTeam"] != st.team:
                st.saves += 1
            # KAST: kill OR assist OR survive OR traded death
            if (pr["kills"] or pr["assists"] or pr["flashAssists"] or pr["survived"]
                    or pr["tradedDeath"]):
                st.kastRounds.add(rr["n"])

    # ---------------------------------------------------------- money spend
    for rr in rb.rounds:
        spend = rb.tv.col_at_tick(rr["freezeEndTick"], "cash_spent_this_round")
        for sid, v in spend.items():
            p = players.get(sid)
            if p and isinstance(v, (int, float, np.integer, np.floating)):
                p.totalSpend += int(v)
                p.spendSamples += 1

    return players
