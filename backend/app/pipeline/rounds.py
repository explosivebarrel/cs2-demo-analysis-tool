"""Round segmentation, winners, sides, buys, openings, MVPs.

FACEIT/Valve CS2 demos often lack the round_end event, so winners are derived
from bomb events + alive counts at the end of each round window."""
import numpy as np

from .. import config
from .ticksview import TicksView

REASONS = {"elimination": "elimination", "bomb": "bomb", "defuse": "defuse", "time": "time"}


def _clean_clan(clan: str) -> str:
    if not clan or not isinstance(clan, str):
        return ""
    c = clan.strip()
    if c.lower().startswith("team_"):
        c = c[5:]
    return c


class RoundBuilder:
    def __init__(self, ctx):
        self.ctx = ctx
        self.tv = TicksView(ctx.ticks)
        self.kills = ctx.ev("player_death")
        self.match_start = self._match_start()
        self.match_end = self._match_end()

    def _match_start(self) -> int:
        ev = self.ctx.ev("begin_new_match")
        if len(ev):
            return int(ev["tick"].min())
        fe = self.ctx.ev("round_freeze_end")
        if len(fe):
            return max(0, int(fe["tick"].min()) - int(self.ctx.tickrate * 20))
        return 0

    def _match_end(self) -> int:
        ev = self.ctx.ev("cs_win_panel_match")
        if len(ev):
            return int(ev["tick"].max())
        return self.ctx.max_tick

    # ------------------------------------------------------------- main
    def build(self) -> dict:
        fe = self.ctx.ev("round_freeze_end")
        freeze_ends = [int(t) for t in fe["tick"] if self.match_start < t <= self.match_end]
        prestarts = sorted(int(t) for t in self.ctx.ev("round_prestart")["tick"])
        officially = sorted(int(t) for t in self.ctx.ev("round_officially_ended")["tick"])

        rounds = []
        for i, fe_tick in enumerate(freeze_ends):
            nxt = freeze_ends[i + 1] if i + 1 < len(freeze_ends) else self.match_end + 1
            # end boundary: round_prestart of the next round if present, else next freeze_end
            next_pre = next((p for p in prestarts if p > fe_tick), nxt)
            off = next((o for o in officially if fe_tick < o <= next_pre), None)
            end_tick = off if off else next_pre - 1
            rounds.append({
                "n": i + 1,
                "freezeEndTick": fe_tick,
                "startTick": fe_tick,          # live start (freeze handled via flag)
                "endTick": min(end_tick, nxt - 1),
                "nextStart": next_pre,
                "officialTick": off,
            })

        # sides per round + team identity
        self._assign_sides(rounds)
        self._winners(rounds)
        self._bomb_events(rounds)
        self._opening_kills(rounds)
        self._buys(rounds)
        self._mvp(rounds)
        self._pistol_rounds(rounds)
        self._finalize_teams(rounds)
        return rounds

    # ------------------------------------------------------------- sides
    def _assign_sides(self, rounds):
        team_of_clan: dict = {}
        steamid_team: dict = {}
        for r in rounds:
            teams = self.tv.col_at_tick(r["freezeEndTick"], "team_num")
            clans = self.tv.col_at_tick(r["freezeEndTick"], "team_clan_name")
            sides = {}
            for sid, tnum in teams.items():
                try:
                    tnum = int(tnum)
                except (TypeError, ValueError):
                    tnum = 0
                side = "T" if tnum == 2 else "CT" if tnum == 3 else "?"
                sides[sid] = side
                clan = _clean_clan(clans.get(sid, ""))
                if clan and tnum in (2, 3):
                    if clan not in team_of_clan:
                        team_of_clan[clan] = len(team_of_clan) if len(team_of_clan) < 2 else None
                    if team_of_clan.get(clan) is not None:
                        steamid_team[sid] = team_of_clan[clan]
            r["sides"] = sides
            r["clans"] = {sid: _clean_clan(c) for sid, c in clans.items()}

        # fallback: identity by side in the first round
        if len(team_of_clan) < 2:
            steamid_team = {}
            first = rounds[0] if rounds else None
            if first:
                for sid, side in first["sides"].items():
                    steamid_team[sid] = 0 if side == "T" else 1 if side == "CT" else 0
            team_of_clan = {}

        # players not yet assigned (joined late) default to team 0
        for r in rounds:
            for sid in r["sides"]:
                steamid_team.setdefault(sid, 0)

        # team 0 is the one whose first-round side was T
        first = rounds[0] if rounds else None
        t0_is_t = True
        if first:
            for sid, team in steamid_team.items():
                if team == 0:
                    t0_is_t = first["sides"].get(sid) == "T"
                    break
        self.steamid_team = steamid_team
        self.team0_first_side_t = t0_is_t
        for r in rounds:
            side0 = next((r["sides"][s] for s, t in steamid_team.items()
                          if t == 0 and r["sides"].get(s) in ("T", "CT")), "T")
            r["sideTeam0"] = side0
            r["sideTeam1"] = "CT" if side0 == "T" else "T"

    def team_of(self, steamid) -> int:
        return int(self.steamid_team.get(str(steamid), 0))

    def side_of_team(self, round_: dict, team: int) -> str:
        return round_["sideTeam0"] if team == 0 else round_["sideTeam1"]

    # ------------------------------------------------------------- winners
    def _winners(self, rounds):
        exploded = set(self.ctx.ev("bomb_exploded")["tick"]) if self.ctx.has_ev("bomb_exploded") else set()
        defused = set(self.ctx.ev("bomb_defused")["tick"]) if self.ctx.has_ev("bomb_defused") else set()

        # Build round_end lookup: tick -> (winner_side, reason)
        # winner_side is "CT" or "T"; reason is the raw string from the event
        round_end_by_tick: dict[int, tuple[str, str]] = {}
        re_ev = self.ctx.ev("round_end")
        if len(re_ev) and "winner" in re_ev.columns:
            for _, row in re_ev.iterrows():
                t = int(row["tick"])
                w = str(row.get("winner") or "")
                rsn = str(row.get("reason") or "")
                if w in ("CT", "T"):
                    round_end_by_tick[t] = (w, rsn)

        for r in rounds:
            w0, w1 = r["freezeEndTick"], r["endTick"]
            winner_team, reason = None, "elimination"

            # 1. Authoritative: round_end event with winner field (present in most demos)
            #    Search in a window [w0 .. w1 + 5s] to handle slight tick offsets
            search_end = w1 + int(self.ctx.tickrate * 5)
            for t, (win_side, rsn) in round_end_by_tick.items():
                if w0 <= t <= search_end:
                    winner_team = self.team_with_side(r, win_side)
                    # map raw reason strings to our canonical set
                    if "bomb" in rsn or "explod" in rsn:
                        reason = "bomb"
                    elif "defus" in rsn:
                        reason = "defuse"
                    elif "time" in rsn or rsn == "":
                        reason = "time"
                    else:
                        reason = "elimination"
                    break

            # 2. Bomb events override reason (more reliable than round_end reason string)
            if winner_team is not None:
                if any(w0 <= t <= w1 for t in exploded):
                    reason = "bomb"
                elif any(w0 <= t <= w1 for t in defused):
                    reason = "defuse"

            # 3. Fallback: alive-count heuristic (used when round_end not available)
            if winner_team is None:
                if any(w0 <= t <= w1 for t in exploded):
                    winner_team = self.team_with_side(r, "T")
                    reason = "bomb"
                elif any(w0 <= t <= w1 for t in defused):
                    winner_team = self.team_with_side(r, "CT")
                    reason = "defuse"
                else:
                    counts = self.tv.alive_by_team(min(w1, self.ctx.max_tick), None)
                    ct_team = self.team_with_side(r, "CT")
                    t_team = self.team_with_side(r, "T")
                    alive_ct = counts.get(3, 0)
                    alive_t = counts.get(2, 0)
                    if alive_t == 0 and alive_ct > 0:
                        winner_team, reason = ct_team, "elimination"
                    elif alive_ct == 0 and alive_t > 0:
                        winner_team, reason = t_team, "elimination"
                    else:
                        winner_team, reason = ct_team, "time"

            r["winnerTeam"] = int(winner_team)
            r["reason"] = reason

    def team_with_side(self, round_: dict, side: str) -> int:
        return 0 if round_["sideTeam0"] == side else 1

    # ------------------------------------------------------------- bomb
    def _bomb_events(self, rounds):
        planted = self.ctx.ev("bomb_planted")
        defused = self.ctx.ev("bomb_defused")
        begin_plant = self.ctx.ev("bomb_beginplant")
        begin_defuse = self.ctx.ev("bomb_begindefuse")
        for r in rounds:
            w0, w1 = r["freezeEndTick"], r["endTick"]
            r["bombPlanted"] = False
            r["bombSite"] = None
            r["bombSiteRaw"] = None
            r["plantTick"] = None
            r["planter"] = None
            r["defuser"] = None
            r["defuseKit"] = False
            r["defuseTick"] = None
            r["beginPlantTick"] = None
            r["beginDefuseTick"] = None
            for _, row in planted.iterrows():
                if w0 <= row["tick"] <= w1:
                    r["bombPlanted"] = True
                    r["plantTick"] = int(row["tick"])
                    r["planter"] = str(row.get("user_steamid", ""))
                    r["bombSiteRaw"] = row.get("site")
                    r["plantX"] = float(row.get("user_X")) if np.isfinite(row.get("user_X", np.nan)) else None
                    r["plantY"] = float(row.get("user_Y")) if np.isfinite(row.get("user_Y", np.nan)) else None
            for _, row in defused.iterrows():
                if w0 <= row["tick"] <= w1:
                    r["defuser"] = str(row.get("user_steamid", ""))
                    r["defuseTick"] = int(row["tick"])
            for _, row in begin_defuse.iterrows():
                if w0 <= row["tick"] <= w1:
                    r["defuseKit"] = bool(row.get("haskit"))
                    r["beginDefuseTick"] = int(row["tick"])
            for _, row in begin_plant.iterrows():
                if w0 <= row["tick"] <= w1:
                    r["beginPlantTick"] = int(row["tick"])

    # ------------------------------------------------------------- opening
    def _opening_kills(self, rounds):
        kills = self.kills
        if not len(kills):
            for r in rounds:
                r["openingKill"] = None
            return
        ticks_ = kills["tick"].to_numpy()
        order = np.argsort(ticks_)
        for r in rounds:
            w0, w1 = r["freezeEndTick"], r["endTick"]
            r["openingKill"] = None
            idx = order[np.searchsorted(ticks_, w0, sorter=order):np.searchsorted(ticks_, w1, side="right", sorter=order)]
            for i in idx:
                row = kills.iloc[i]
                a, v = row.get("attacker_steamid"), row.get("user_steamid")
                if a and v and a == a:
                    r["openingKill"] = {
                        "tick": int(row["tick"]),
                        "attacker": str(a), "victim": str(v),
                        "attackerTeam": self.team_of(a),
                        "weapon": str(row.get("weapon", "")),
                        "headshot": bool(row.get("headshot")),
                    }
                    break

    # ------------------------------------------------------------- buys
    def _buys(self, rounds):
        for r in rounds:
            spend = self.tv.col_at_tick(r["freezeEndTick"], "cash_spent_this_round")
            vals = {0: [], 1: []}
            for sid, v in spend.items():
                if isinstance(v, (int, float, np.integer, np.floating)):
                    t = self.team_of(sid)
                    if t in vals:
                        vals[t].append(int(v))
            for t in (0, 1):
                arr = vals[t]
                avg = int(sum(arr) / len(arr)) if arr else 0
                r[f"spendTeam{t}"] = sum(arr)
                r[f"avgSpendTeam{t}"] = avg
                r[f"buyTeam{t}"] = self._buy_type(avg)

    @staticmethod
    def _buy_type(avg_spend: int) -> str:
        if avg_spend <= 1000:
            return "pistol"
        if avg_spend < config.BUY_FORCE_MIN:
            return "eco"
        if avg_spend < config.BUY_FULL_MIN:
            return "force"
        return "full"

    # ------------------------------------------------------------- mvp
    def _mvp(self, rounds):
        hurt = self.ctx.ev("player_hurt")
        if not len(hurt):
            for r in rounds:
                r["mvp"] = None
            return
        hurt = hurt.sort_values("tick")
        ht = hurt["tick"].to_numpy()
        a_st = hurt["attacker_steamid"].astype(str).to_numpy()
        a_dmg = hurt["dmg_health"].fillna(0).to_numpy(dtype="float64")
        for r in rounds:
            r["mvp"] = None
            w0, w1 = r["freezeEndTick"], r["endTick"]
            wt = r["winnerTeam"]
            i0 = np.searchsorted(ht, w0)
            i1 = np.searchsorted(ht, w1, side="right")
            if i0 >= i1:
                continue
            dmg: dict = {}
            for sid, d in zip(a_st[i0:i1], a_dmg[i0:i1]):
                if sid and sid != "None" and self.team_of(sid) == wt:
                    dmg[sid] = dmg.get(sid, 0) + d
            if dmg:
                r["mvp"] = max(dmg.items(), key=lambda kv: kv[1])[0]

    # ------------------------------------------------------------- pistol/half
    def _pistol_rounds(self, rounds):
        prev_side0 = None
        for r in rounds:
            r["isPistol"] = False
            if prev_side0 is None or r["sideTeam0"] != prev_side0:
                r["isPistol"] = True
            prev_side0 = r["sideTeam0"]
        if rounds:
            rounds[0]["isPistol"] = True

    # ------------------------------------------------------------- teams
    def _finalize_teams(self, rounds):
        score = [0, 0]
        for r in rounds:
            score[r["winnerTeam"]] += 1
            r["scoreTeam0"] = score[0]
            r["scoreTeam1"] = score[1]
        self.final_score = score
