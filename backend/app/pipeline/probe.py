"""Fast demo probe: extract map, teams, player names, date, score.

Runs in ~2-5 seconds vs 30-60s for full analysis.
Parses only: header, round_end, player_death, begin_new_match.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

from demoparser2 import DemoParser


def _sid(v) -> str | None:
    if v is None:
        return None
    s = str(v)
    return s if s and s not in ("None", "nan", "0") else None


def _clean_clan(clan: str) -> str:
    if not clan or not isinstance(clan, str):
        return ""
    c = clan.strip()
    if c.lower().startswith("team_"):
        c = c[5:]
    return c


def probe_demo(demo_path: str) -> dict:
    """Return {map, teamNames, score, players, date, tickrate} quickly."""
    p = DemoParser(demo_path)
    header = p.parse_header()
    map_name = header.get("map_name", "")

    # tickrate from header or fallback
    tickrate = float(header.get("tickrate") or 64)

    # demo date from file mtime (most reliable) or header
    import os
    try:
        mtime = os.path.getmtime(demo_path)
        date_iso = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
    except Exception:
        date_iso = datetime.now(tz=timezone.utc).isoformat()

    # parse minimal events
    try:
        ev_pairs = p.parse_events(["round_end", "begin_new_match"], player=["team_clan_name"])
    except Exception:
        ev_pairs = []

    events: dict = {}
    for name, df in ev_pairs:
        events[name] = df

    # score from round_end
    score = [0, 0]
    team_sides: dict[str, list[str]] = {}  # clan -> list of sides played

    re_df = events.get("round_end")
    if re_df is not None and len(re_df) and "winner" in re_df.columns:
        ct_wins = int((re_df["winner"] == "CT").sum())
        t_wins  = int((re_df["winner"] == "T").sum())
        # we don't know which team is 0/1 yet — just store raw counts
        score = [ct_wins, t_wins]  # will re-orient below

    # player names + clans from player_death (has attacker/user names)
    try:
        death_pairs = p.parse_events(["player_death"], player=["team_clan_name"])
    except Exception:
        death_pairs = []

    clan_of: dict[str, str] = {}   # steamid -> clan
    name_of: dict[str, str] = {}   # steamid -> display name
    side_of: dict[str, str] = {}   # steamid -> first known side (T/CT)
    team_num_of: dict[str, int] = {}  # steamid -> team_num (2=T, 3=CT)

    for ev_name, df in death_pairs:
        if ev_name != "player_death":
            continue
        for role in ("attacker", "user"):
            sid_col = f"{role}_steamid"
            name_col = f"{role}_name"
            clan_col = f"{role}_team_clan_name"
            tnum_col = f"{role}_team_num" if f"{role}_team_num" in df.columns else None

            if sid_col not in df.columns:
                continue
            for _, row in df.iterrows():
                sid = _sid(row.get(sid_col))
                if not sid:
                    continue
                if name_col in df.columns and sid not in name_of:
                    n = str(row.get(name_col) or "")
                    if n and n not in ("None", "nan"):
                        name_of[sid] = n
                if clan_col in df.columns and sid not in clan_of:
                    c = _clean_clan(str(row.get(clan_col) or ""))
                    if c:
                        clan_of[sid] = c

    # parse a minimal ticks sample at tick 0 to get team assignments
    try:
        ticks_df = p.parse_ticks(["team_num", "team_clan_name"], ticks=[0])
        for _, row in ticks_df.iterrows():
            sid = _sid(row.get("steamid"))
            if not sid:
                continue
            tnum = row.get("team_num")
            try:
                tnum = int(tnum)
            except (TypeError, ValueError):
                tnum = 0
            if tnum in (2, 3):
                team_num_of[sid] = tnum
                side_of[sid] = "T" if tnum == 2 else "CT"
            c = _clean_clan(str(row.get("team_clan_name") or ""))
            if c and sid not in clan_of:
                clan_of[sid] = c
    except Exception:
        pass

    # build team identity: group by clan or by first-round side
    # team 0 = T side in round 1, team 1 = CT side in round 1
    from collections import Counter, defaultdict

    clan_team: dict[str, int] = {}
    for sid, tnum in team_num_of.items():
        clan = clan_of.get(sid, "")
        team_idx = 0 if tnum == 2 else 1
        if clan:
            clan_team[clan] = team_idx

    # fallback: no clan data — assign by side
    sid_team: dict[str, int] = {}
    for sid, tnum in team_num_of.items():
        sid_team[sid] = 0 if tnum == 2 else 1
    for sid, clan in clan_of.items():
        if clan in clan_team:
            sid_team[sid] = clan_team[clan]

    # team names
    def _team_name(team_idx: int) -> str:
        # prefer clan tag
        clans = Counter(
            clan_of[sid] for sid, t in sid_team.items()
            if t == team_idx and sid in clan_of
        )
        if clans:
            return clans.most_common(1)[0][0]
        # fallback: first non-steamid player name
        for sid, t in sid_team.items():
            if t != team_idx:
                continue
            name = name_of.get(sid, "")
            if name and not (name.isdigit() and len(name) >= 15):
                return name
        return f"Team {team_idx + 1}"

    team_names = [_team_name(0), _team_name(1)]

    # score: re-derive as (T wins, CT wins) oriented to team0=T
    # If we have round_end data, use it; score = [team0_wins, team1_wins]
    # team0 is T in round 1, so team0_wins = T_wins from round_end
    if re_df is not None and len(re_df) and "winner" in re_df.columns:
        t_wins  = int((re_df["winner"] == "T").sum())
        ct_wins = int((re_df["winner"] == "CT").sum())
        score = [t_wins, ct_wins]  # team0=T, team1=CT in round 1
    else:
        score = [0, 0]

    # players list
    players = []
    all_sids = set(sid_team) | set(name_of)
    for sid in all_sids:
        team_idx = sid_team.get(sid, 0)
        players.append({
            "steamid": sid,
            "name": name_of.get(sid, sid),
            "clan": clan_of.get(sid, ""),
            "team": team_idx,
        })
    players.sort(key=lambda p: (p["team"], p["name"]))

    return {
        "map": map_name,
        "teamNames": team_names,
        "score": score,
        "players": players,
        "date": date_iso,
        "tickrate": tickrate,
    }
