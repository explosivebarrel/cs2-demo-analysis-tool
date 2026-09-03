"""DemoContext: loads all raw data from a demo file once (demoparser2)."""
import numpy as np
import pandas as pd

from demoparser2 import DemoParser

# Full-path props (resolve reliably across demo sources)
P_MONEY = "CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iAccount"
P_START_MONEY = "CCSPlayerController.CCSPlayerController_InGameMoneyServices.m_iStartAccount"

TICK_PROPS = [
    "X", "Y", "Z", "pitch", "yaw", "health", "armor_value", "is_alive",
    "active_weapon_name", "active_weapon_ammo", "inventory", "team_num", "team_name", "team_clan_name",
    "game_phase", "is_freeze_period", "is_bomb_planted", "total_rounds_played",
    "game_time", "flash_duration", "has_defuser", "has_helmet", "is_walking",
    "is_scoped", "duck_amount", "cash_spent_this_round", "total_cash_spent",
    "button_states", "velocity_X", "velocity_Y", "velocity_Z",
    P_MONEY, P_START_MONEY,
]

EVENTS_WITH_PLAYERS = [
    "player_death", "player_hurt", "weapon_fire", "player_blind",
    "flashbang_detonate", "smokegrenade_detonate", "smokegrenade_expired",
    "hegrenade_detonate", "inferno_startburn", "inferno_expire",
    "decoy_started", "decoy_detonate",
    "bomb_planted", "bomb_beginplant", "bomb_begindefuse", "bomb_defused",
    "bomb_exploded", "bomb_dropped", "bomb_pickup", "item_pickup",
    "player_team", "weapon_reload",
]

EVENTS_PLAIN = [
    "round_end", "round_freeze_end", "round_officially_ended", "round_prestart",
    "round_poststart", "begin_new_match", "cs_pre_restart",
    "cs_win_panel_match", "buytime_ended", "announce_phase_end",
    "player_bullet_hit", "chat_message", "player_jump",
    "round_announce_last_round_half", "round_announce_match_start",
    "hostage_rescued",
]

PLAYER_PROPS = ["X", "Y", "Z", "health", "armor_value", "active_weapon_name"]


class DemoContext:
    def __init__(self, path: str, progress=None):
        self.path = path
        self._progress = progress or (lambda phase, pct: None)
        self.parser = DemoParser(path)
        self.header = self.parser.parse_header()
        self.events: dict[str, pd.DataFrame] = {}
        self.ticks: pd.DataFrame | None = None
        self.tickrate = 64.0
        self.max_tick = 0
        self.frame_step = 8
        self.grenades: pd.DataFrame | None = None

    # ------------------------------------------------------------- loading
    def load(self):
        self._progress("probe", 4)
        # Pass 1: minimal full-tick scan to learn tickrate & max tick.
        gt = self.parser.parse_ticks(["game_time"])
        gt = gt.reset_index() if gt.index.name else gt
        if "tick" not in gt.columns:
            gt = gt.reset_index()
        ticks = gt["tick"]
        self.max_tick = int(ticks.max())
        times = gt.sort_values("tick")["game_time"].to_numpy(dtype="float64")
        dt = np.diff(times)
        dt = dt[dt > 0]
        per_tick = np.median(dt) if len(dt) else 1.0 / 64.0
        self.tickrate = float(max(16.0, min(256.0, round(1.0 / per_tick))))
        self.frame_step = max(4, int(round(self.tickrate * 0.125)))

        self._progress("events", 12)
        ev = self.parser.parse_events(EVENTS_WITH_PLAYERS, player=PLAYER_PROPS)
        for name, df in ev:
            self.events[name] = self._clean(df)
        ev2 = self.parser.parse_events(EVENTS_PLAIN)
        for name, df in ev2:
            self.events[name] = self._clean(df)

        self._progress("ticks", 30)
        want = list(range(0, self.max_tick + 1, self.frame_step))
        if not want or want[-1] != self.max_tick:
            want.append(self.max_tick)
        self.ticks = self.parser.parse_ticks(TICK_PROPS, ticks=want)
        self.ticks = self._clean(self.ticks)

        self._progress("grenades", 55)
        try:
            g = self.parser.parse_grenades()
            if isinstance(g, tuple):
                g = g[0]
            if isinstance(g, list):
                g = g[0][1]
            self.grenades = self._clean(g)
        except Exception:
            self.grenades = None

    @staticmethod
    def _clean(df: pd.DataFrame) -> pd.DataFrame:
        df = df.reset_index() if df.index.name and "tick" not in df.columns else df
        for col in ("tick",):
            if col in df.columns:
                df[col] = df[col].astype("int64")
        return df

    # ------------------------------------------------------------- helpers
    def ev(self, name: str) -> pd.DataFrame:
        return self.events.get(name, pd.DataFrame())

    def has_ev(self, name: str) -> bool:
        return name in self.events and len(self.events[name]) > 0
