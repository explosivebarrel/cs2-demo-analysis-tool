"""Fast per-tick access over the downsampled tick DataFrame."""
import numpy as np
import pandas as pd


class TicksView:
    def __init__(self, ticks: pd.DataFrame):
        df = ticks.sort_values(["tick", "steamid"]).reset_index(drop=True)
        self.df = df
        self.tick_values = df["tick"].to_numpy()
        self.unique_ticks = np.unique(self.tick_values)
        self.steamids = df["steamid"].astype(str).to_numpy()
        # player index over the full demo (any steamid that ever appears)
        order = list(dict.fromkeys(self.steamids.tolist()))
        self.player_index = {s: i for i, s in enumerate(order)}
        self.players_order = order

    def rows_for_tick(self, tick: int) -> pd.DataFrame:
        """Rows of the nearest sampled tick <= tick."""
        pos = np.searchsorted(self.unique_ticks, tick, side="right") - 1
        if pos < 0:
            pos = 0
        t = int(self.unique_ticks[pos])
        return self.df[self.tick_values == t]

    def frame_tick_before(self, tick: int) -> int | None:
        """Nearest sampled tick <= tick, or None if tick predates all samples."""
        pos = np.searchsorted(self.unique_ticks, tick, side="right") - 1
        if pos < 0:
            return None
        return int(self.unique_ticks[pos])

    def col_at_tick(self, tick: int, col: str, default=None):
        rows = self.rows_for_tick(tick)
        return dict(zip(rows["steamid"].astype(str), rows[col]))

    def team_at_tick(self, tick: int) -> dict:
        return self.col_at_tick(tick, "team_num")

    def alive_by_team(self, tick: int, player_team: dict):
        """{team_num: alive_count} at nearest sampled tick <= tick."""
        rows = self.rows_for_tick(tick)
        counts = {}
        for team, alive in zip(rows["team_num"], rows["is_alive"]):
            if alive:
                counts[int(team)] = counts.get(int(team), 0) + 1
        return counts

    def frame_range(self, t0: int, t1: int) -> pd.DataFrame:
        """Rows with t0 <= tick <= t1."""
        i0 = np.searchsorted(self.unique_ticks, t0, side="left")
        i1 = np.searchsorted(self.unique_ticks, t1, side="right")
        if i0 >= len(self.unique_ticks):
            i0 = len(self.unique_ticks) - 1
        t0v, t1v = int(self.unique_ticks[i0]), int(self.unique_ticks[max(i0, i1 - 1)])
        mask = (self.tick_values >= t0v) & (self.tick_values <= t1v)
        return self.df[mask]
