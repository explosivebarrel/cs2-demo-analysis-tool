"""Replay timeline builder + single-pass per-frame statistics.

Produces the compact frame stream used by the web replay player and feeds
frame-level stats (alive time, distance, holds, clutches, survival) back to
the metrics stage."""
import numpy as np

from .. import config
from ..weapons import inventory_keys, weapon_id
from .context import P_MONEY

# per-player fields in replay["data"]:
# [x, y, z, yaw, hp, armor, alive, weaponId, flags, team, equip, money, ammo]
FIELDS = 13

# approximate CS2 buy prices for equipment value estimation
_WEAPON_VALUE = {
    "awp": 4750, "ssg08": 1700, "scar20": 5000, "g3sg1": 5000,
    "ak47": 2700, "m4a4": 3100, "m4a1_silencer": 2900, "m4a1": 2900,
    "famas": 2050, "galilar": 1800, "aug": 3300, "sg556": 3000,
    "m249": 5200, "negev": 1700, "nova": 1050, "xm1014": 2000, "mag7": 1300,
    "mp9": 1250, "mac10": 1050, "mp7": 1500, "ump45": 1200,
    "p90": 2350, "bizon": 1400, "mp5sd": 1500,
    "deagle": 700, "revolver": 600, "p250": 300, "cz75a": 500,
    "fiveseven": 500, "tec9": 500, "elite": 300,
    "usp_silencer": 200, "usp_s": 200, "hkp2000": 200, "glock": 200, "glock18": 200,
    "flashbang": 200, "smokegrenade": 300, "hegrenade": 300,
    "molotov": 400, "incgrenade": 600, "decoy": 50,
    "kevlar": 650, "kevlar_helmet": 1000,
    "defuser": 400, "taser": 200, "c4": 0,
}


def _equip_value(keys, has_helmet: bool, has_defuser: bool) -> int:
    """Estimate total equipment value from canonical inventory ids + gear flags."""
    total = 0
    seen_kevlar = False
    for key in keys:
        total += _WEAPON_VALUE.get(key, 0)
        if key in ("kevlar", "kevlar_helmet"):
            seen_kevlar = True
    if not seen_kevlar and has_helmet:
        total += 1000
    if has_defuser:
        total += 400
    return total


def _flags(row, keys) -> int:
    f = 0
    if "c4" in keys:
        f |= 1
    if row["has_defuser"]:
        f |= 2
    if row["flash_duration"] and row["flash_duration"] > 0.3:
        f |= 4
    if row["is_scoped"]:
        f |= 8
    if row["is_walking"]:
        f |= 16
    if row["duck_amount"] and row["duck_amount"] > 0.5:
        f |= 32
    if row["has_helmet"]:
        f |= 64
    return f


def _safe_int(v, default=0) -> int:
    try:
        f = float(v)
        return default if (f != f) else int(f)  # NaN check: NaN != NaN
    except (TypeError, ValueError):
        return default


def _norm_yaw(y) -> float:
    try:
        a = float(y)
    except (TypeError, ValueError):
        return 0.0
    a = a % 360.0
    return a if a >= 0 else a + 360.0


class ClutchTracker:
    """1vX clutch attempts from per-frame alive counts (X >= 2)."""

    def __init__(self, rb):
        self.rb = rb
        self.attempts = []
        self.cur = None

    def observe(self, tick, per_player, players, round_):
        if round_ is None:
            self._end(None)
            return
        if self.cur and self.cur["round"] != round_["n"]:
            self._end(round_)
        alive_t = {2: [], 3: []}
        for pp, sid in zip(per_player, players):
            if pp[6] and pp[9] in (2, 3):
                alive_t[pp[9]].append(sid)
        lone_side = None
        if len(alive_t[2]) == 1 and len(alive_t[3]) >= 2:
            lone_side = 2
        elif len(alive_t[3]) == 1 and len(alive_t[2]) >= 2:
            lone_side = 3
        if lone_side is None:
            self._end(round_)
            return
        lone = alive_t[lone_side][0]
        enemies = len(alive_t[3] if lone_side == 2 else alive_t[2])
        if self.cur is None or self.cur["player"] != lone:
            self._end(round_)
            self.cur = {"round": round_["n"], "player": lone, "side": lone_side,
                        "t0": tick, "t1": tick, "maxEnemies": enemies, "kills": 0}
            self.attempts.append(self.cur)
        else:
            self.cur["t1"] = tick
            self.cur["maxEnemies"] = max(self.cur["maxEnemies"], enemies)

    def note_kill(self, killer, round_n):
        if self.cur and self.cur["round"] == round_n and self.cur["player"] == killer:
            self.cur["kills"] += 1

    def _end(self, round_):
        c = self.cur
        self.cur = None
        if not c:
            return
        won = False
        rnd = next((r for r in self.rb.rounds if r["n"] == c["round"]), None)
        if round_ is not None and rnd is not None and rnd["n"] == c["round"]:
            won = (self.rb.team_with_side(rnd, "T" if c["side"] == 2 else "CT")
                   == rnd["winnerTeam"])
        c["won"] = bool(won)
        c["durSec"] = round((c["t1"] - c["t0"]) / max(1, self.rb.ctx.tickrate), 1)


class FrameBuilder:
    def __init__(self, ctx, rb, progress=None):
        self.ctx = ctx
        self.rb = rb
        self._progress = progress or (lambda frac: None)
        names = {sid: self._first_name(sid) for sid in rb.steamid_team}
        t0 = sorted([s for s, t in rb.steamid_team.items() if t == 0], key=lambda s: names[s])
        t1 = sorted([s for s, t in rb.steamid_team.items() if t == 1], key=lambda s: names[s])
        self.players = t0 + t1
        self.player_idx = {s: i for i, s in enumerate(self.players)}
        self.n = len(self.players)
        self.clutch = ClutchTracker(rb)
        self.reset_state()

    def _first_name(self, sid):
        rows = self.ctx.ticks[self.ctx.ticks["steamid"] == sid]
        if len(rows):
            return str(rows["name"].iloc[0])
        return sid

    def reset_state(self):
        self.last_pos = [(0.0, 0.0, 0.0)] * self.n
        self.prev_pos = [(0.0, 0.0, 0.0)] * self.n
        self.hold_state = [None] * self.n
        self.last_inv = [None] * self.n
        self.inv_journal = []
        self.cur_tick = 0
        self.cur_round = None
        self.started_alive = {}
        self.stats = {
            s: {"aliveSeconds": 0.0, "distanceUnits": 0.0, "roundsSurvived": set(),
                "aliveAtEnd": {}, "holds": [], "positions": []}
            for s in self.players
        }

    # ------------------------------------------------------------- main
    def build(self):
        df = self.rb.tv.df
        dt = self.ctx.frame_step / self.ctx.tickrate
        frame_ticks = []
        frame_data = []
        last_round_n = 0

        # round lookup by tick
        rls = [(r["freezeEndTick"], r) for r in self.rb.rounds]
        rls.sort()

        def round_at(t):
            cur = None
            for fe, r in rls:
                if fe <= t:
                    cur = r
                else:
                    break
            return cur

        self.rb.rounds_by_tick = round_at

        # this loop is the heaviest pure-Python stage; report sub-progress so
        # the status bar crawls 70 -> 78 instead of stalling at 70
        total_ticks = df["tick"].nunique()
        done_ticks = 0

        for tick, group in df.groupby("tick", sort=True):
            tick = int(tick)
            self.cur_tick = tick
            done_ticks += 1
            if done_ticks % 500 == 0:
                self._progress(done_ticks / total_ticks)
            self.cur_tick = tick
            fi = len(frame_ticks)
            r = round_at(tick)
            if r is not None and r["n"] != last_round_n:
                last_round_n = r["n"]
                self._on_round_start(r)

            per_player = [None] * self.n
            for row in group.to_dict("records"):
                sid = str(row["steamid"])
                idx = self.player_idx.get(sid)
                if idx is None:
                    continue
                pos = (float(row["X"]), float(row["Y"]), float(row["Z"]))
                alive = bool(row["is_alive"])
                if not (np.isfinite(pos[0]) and np.isfinite(pos[1])):
                    pos = self.last_pos[idx]
                    alive = False
                self.last_pos[idx] = pos
                try:
                    team = int(row["team_num"])
                except (TypeError, ValueError):
                    team = 0
                wid = weapon_id(row["active_weapon_name"])
                keys = inventory_keys(row.get("inventory"))
                flags = _flags(row, keys)
                equip = _equip_value(keys, bool(row.get("has_helmet")), bool(row.get("has_defuser")))
                per_player[idx] = [round(pos[0]), round(pos[1]), round(pos[2]),
                                   _safe_int(_norm_yaw(row["yaw"])), _safe_int(row["health"]),
                                   _safe_int(row["armor_value"]), 1 if alive else 0, wid, flags, team,
                                   equip, _safe_int(row.get(P_MONEY)),
                                   _safe_int(row.get("active_weapon_ammo"))]
                if alive:
                    self._inv_feed(idx, keys, fi)
                self._update_player_stats(sid, idx, pos, alive, row, r, dt)

            for i in range(self.n):
                if per_player[i] is None:
                    p = self.last_pos[i]
                    per_player[i] = [round(p[0]), round(p[1]), round(p[2]), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

            frame_ticks.append(tick)
            frame_data.extend(v for pp in per_player for v in pp)
            self.clutch.observe(tick, per_player, self.players, r)

        self._close_all_holds()
        for s in self.players:
            self.stats[s]["roundsSurvived"] = sorted(self.stats[s]["roundsSurvived"])
            self.stats[s]["aliveAtEnd"] = {str(k): bool(v) for k, v in self.stats[s]["aliveAtEnd"].items()}

        return {"ticks": frame_ticks, "data": frame_data, "inv": self.inv_journal}

    def _inv_feed(self, idx, keys, fi):
        s = ",".join(keys)
        if s != self.last_inv[idx]:
            self.last_inv[idx] = s
            self.inv_journal.append([fi, idx, s])

    # ------------------------------------------------------------- round
    def _on_round_start(self, r):
        self.cur_round = r
        self._close_all_holds()
        teams = self.rb.tv.col_at_tick(r["freezeEndTick"], "team_num")
        self.started_alive = {sid for sid in teams if sid in self.player_idx}

    def _update_player_stats(self, sid, idx, pos, alive, row, r, dt):
        st = self.stats[sid]
        if alive:
            st["aliveSeconds"] += dt
            px, py, _ = self.prev_pos[idx]
            if px or py:
                dx, dy = pos[0] - px, pos[1] - py
                d2 = dx * dx + dy * dy
                if d2 < 250000:
                    st["distanceUnits"] += d2 ** 0.5
            self.prev_pos[idx] = pos
            if (r is not None and self.cur_tick <= r["endTick"]
                    and not row["is_freeze_period"]):
                self._hold_feed(idx, pos)
                plist = st["positions"]
                if not plist or (plist[-1][0] - pos[0]) ** 2 + (plist[-1][1] - pos[1]) ** 2 > 900:
                    plist.append((pos[0], pos[1], pos[2], r["n"]))
        if r is not None and self.cur_tick <= r["endTick"]:
            st["aliveAtEnd"][r["n"]] = alive
            if alive and not row["is_freeze_period"]:
                st["roundsSurvived"].add(r["n"])

    # holds --------------------------------------------------------------
    def _hold_feed(self, idx, pos):
        hs = self.hold_state[idx]
        if hs is None:
            self.hold_state[idx] = {"x": pos[0], "y": pos[1],
                                    "t0": self.cur_tick, "t": self.cur_tick}
            return
        hs["t"] = self.cur_tick
        d = ((pos[0] - hs["x"]) ** 2 + (pos[1] - hs["y"]) ** 2) ** 0.5
        if d > config.HOLD_RADIUS_UNITS:
            self._close_hold_idx(idx)
            self.hold_state[idx] = {"x": pos[0], "y": pos[1],
                                    "t0": self.cur_tick, "t": self.cur_tick}

    def _close_hold_idx(self, idx):
        hs = self.hold_state[idx]
        if not hs:
            return
        dur = (hs["t"] - hs["t0"]) / self.ctx.tickrate
        if dur >= config.HOLD_MIN_SECONDS and self.cur_round is not None:
            self.stats[self.players[idx]]["holds"].append(
                (round(hs["x"], 1), round(hs["y"], 1), round(dur, 1), self.cur_round["n"]))
        self.hold_state[idx] = None

    def _close_all_holds(self):
        for idx in range(self.n):
            self._close_hold_idx(idx)

    # bomb state ----------------------------------------------------------
    def finalize_bomb(self, replay, bomb_events):
        """Fill replay['bomb'] = per frame [state, x, y, carrierIdx].
        state: 0 none, 1 carried, 2 dropped, 3 planted, 4 dead."""
        data = replay["data"]
        ticks = replay["ticks"]
        n_frames = len(ticks)
        states = [[0, 0.0, 0.0, -1] for _ in range(n_frames)]

        ev_by_tick = {}
        for e in bomb_events:
            ev_by_tick.setdefault(e["t"], []).append(e)

        state, cx, cy, carrier = 0, 0.0, 0.0, -1
        ri = 0
        rounds = sorted(self.rb.rounds, key=lambda r: r["freezeEndTick"])
        for fi, t in enumerate(ticks):
            while ri < len(rounds) and rounds[ri]["freezeEndTick"] <= t:
                state, carrier = 0, -1
                ri += 1
            for e in ev_by_tick.get(t, []):
                ty = e["ty"]
                if ty == "bo":
                    state, cx, cy, carrier = 2, e.get("x", cx), e.get("y", cy), -1
                elif ty == "bu":
                    idx = self.player_idx.get(e.get("p", e.get("a", "")), -1)
                    if idx >= 0:
                        cx, cy = self._pos_of(data, fi, idx)
                        state, carrier = 1, idx
                elif ty == "bp":
                    state, cx, cy, carrier = 3, e.get("x", cx), e.get("y", cy), -1
                elif ty in ("bx", "bf"):
                    state, carrier = 4, -1
            if state in (0, 2):
                base = fi * self.n * FIELDS
                for idx in range(self.n):
                    if data[base + idx * FIELDS + 8] & 1:
                        cx, cy = self._pos_of(data, fi, idx)
                        state, carrier = 1, idx
                        break
            elif state == 1 and carrier >= 0:
                cx, cy = self._pos_of(data, fi, carrier)
            states[fi] = [state, round(cx, 1), round(cy, 1), carrier]
        replay["bomb"] = states
        return replay

    def _pos_of(self, data, fi, idx):
        base = fi * self.n * FIELDS
        return data[base + idx * FIELDS], data[base + idx * FIELDS + 1]
