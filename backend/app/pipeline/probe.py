"""Fast demo probe: extract map, teams, player names, date, score.

Runs in ~2-5 seconds vs 30-60s for full analysis.
Parses only: header, round_end, player_death.
"""
from __future__ import annotations

from collections import Counter
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

    tickrate = float(header.get("tickrate") or header.get("playback_ticks") or 64)

    import os
    try:
        mtime = os.path.getmtime(demo_path)
        date_iso = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
    except Exception:
        date_iso = datetime.now(tz=timezone.utc).isoformat()

    # --- begin_new_match: find match start tick to exclude knife/warmup rounds ---
    match_start_tick = 0
    try:
        bnm_pairs = p.parse_events(["begin_new_match"])
        for ev_name, df in bnm_pairs:
            if ev_name == "begin_new_match" and len(df):
                match_start_tick = int(df["tick"].min())
                break
    except Exception:
        pass

    # --- round_end: collect (round_n, end_tick, winner_side) ---
    # Only include rounds that end AFTER match start (excludes knife/warmup rounds).
    rounds_info: list[tuple[int, int, str]] = []
    try:
        re_pairs = p.parse_events(["round_end"])
        for ev_name, df in re_pairs:
            if ev_name != "round_end":
                continue
            for _, row in df.iterrows():
                rn = row.get("round")
                tick = row.get("tick")
                winner = row.get("winner")
                if rn and tick and winner and str(winner) not in ("None", "nan"):
                    if int(tick) > match_start_tick:
                        rounds_info.append((int(rn), int(tick), str(winner)))
    except Exception:
        pass
    rounds_info.sort()
    # Re-number rounds sequentially starting from 1 (original round numbers may skip)
    rounds_info = [(i + 1, tick, winner) for i, (_, tick, winner) in enumerate(rounds_info)]

    # Build tick→round mapping
    def tick_to_round(tick: int) -> int | None:
        for rn, end_tick, _ in rounds_info:
            if tick <= end_tick:
                return rn
        return None

    # --- player_death: collect names, clans, and per-round tnum ---
    clan_of: dict[str, str] = {}
    name_of: dict[str, str] = {}
    # sid -> {round_n -> tnum} — collect all rounds to vote on first-half side
    sid_round_tnum: dict[str, dict[int, int]] = {}

    try:
        death_pairs = p.parse_events(["player_death"], player=["team_clan_name", "team_num"])
        for ev_name, df in death_pairs:
            if ev_name != "player_death":
                continue
            for role in ("attacker", "user"):
                sid_col = f"{role}_steamid"
                name_col = f"{role}_name"
                clan_col = f"{role}_team_clan_name"
                tnum_col = f"{role}_team_num"

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

                    if tnum_col in df.columns:
                        try:
                            tnum = int(float(row.get(tnum_col) or 0))
                            tick = int(row.get("tick") or 0)
                        except (TypeError, ValueError):
                            continue
                        if tnum not in (2, 3) or tick <= 0:
                            continue
                        rn = tick_to_round(tick)
                        if rn is not None and rn >= 1:
                            if sid not in sid_round_tnum:
                                sid_round_tnum[sid] = {}
                            # keep first occurrence per round
                            if rn not in sid_round_tnum[sid]:
                                sid_round_tnum[sid][rn] = tnum
    except Exception:
        pass

    # --- Determine each player's first-half side via majority vote over rounds 2-6 ---
    # Round 1 is often a knife round with scrambled sides; rounds 2-6 are reliable.
    # For each steamid, count tnum occurrences in rounds 2-6.
    sid_first_tnum: dict[str, int] = {}
    for sid, rnd_map in sid_round_tnum.items():
        votes: Counter[int] = Counter()
        for rn, tnum in rnd_map.items():
            if 2 <= rn <= 6:
                votes[tnum] += 1
        if not votes:
            # fall back to any early round > 1
            for rn in sorted(rnd_map):
                if rn > 1:
                    votes[rnd_map[rn]] += 1
                    break
        if not votes:
            # last resort: use whatever we have
            for rn in sorted(rnd_map):
                votes[rnd_map[rn]] += 1
                break
        if votes:
            sid_first_tnum[sid] = votes.most_common(1)[0][0]

    # --- Build team identity (team 0 / team 1) ---
    # Group by clan tag first; fallback to tnum grouping.
    clan_team: dict[str, int] = {}
    # To assign team 0/1 consistently: use clan data when available.
    # For each clan, all members share a tnum in the first half → pick majority tnum.
    clan_tnum_votes: dict[str, Counter] = {}
    for sid, tnum in sid_first_tnum.items():
        clan = clan_of.get(sid, "")
        if clan:
            if clan not in clan_tnum_votes:
                clan_tnum_votes[clan] = Counter()
            clan_tnum_votes[clan][tnum] += 1

    for clan, votes in clan_tnum_votes.items():
        dominant_tnum = votes.most_common(1)[0][0]
        clan_team[clan] = 0 if dominant_tnum == 2 else 1

    sid_team: dict[str, int] = {}
    for sid, tnum in sid_first_tnum.items():
        clan = clan_of.get(sid, "")
        if clan and clan in clan_team:
            sid_team[sid] = clan_team[clan]
        else:
            sid_team[sid] = 0 if tnum == 2 else 1

    # Ensure players without tnum but with known clan still get assigned
    for sid, clan in clan_of.items():
        if sid not in sid_team and clan in clan_team:
            sid_team[sid] = clan_team[clan]

    # --- Determine team 0's first-half side (T or CT) ---
    if clan_team:
        # With clan data: derive from whichever tnum team0's clan players had in early rounds.
        t0_tnums = [sid_first_tnum[sid] for sid, t in sid_team.items() if t == 0 and sid in sid_first_tnum]
        t0_tnum_majority = Counter(t0_tnums).most_common(1)[0][0] if t0_tnums else 2
        team0_first_side: str = "T" if t0_tnum_majority == 2 else "CT"
    else:
        # No clan data: mirror full-analysis fallback — team0 = T-side (tnum=2) in r1.
        # sid_team already assigns tnum=2 → team0, so team0 always starts T here.
        team0_first_side = "T"

    # --- Score: count wins per team using standard CS2 half logic ---
    # Sides swap after round 12 in regulation; OT uses 3-round halves starting at round 25.
    def _team0_side_for_round(rn: int) -> str:
        if rn <= 12:
            half_idx = 0
        elif rn <= 24:
            half_idx = 1
        else:
            half_idx = 2 + ((rn - 25) // 3)
        if half_idx % 2 == 0:
            return team0_first_side
        return "CT" if team0_first_side == "T" else "T"

    team0_wins = team1_wins = 0
    for rn, _end_tick, winner_side in rounds_info:
        if _team0_side_for_round(rn) == winner_side:
            team0_wins += 1
        else:
            team1_wins += 1

    score = [team0_wins, team1_wins]

    # --- Team names ---
    def _team_name(team_idx: int) -> str:
        clans = Counter(
            clan_of[sid] for sid, t in sid_team.items()
            if t == team_idx and sid in clan_of
        )
        if clans:
            return clans.most_common(1)[0][0]
        for sid, t in sid_team.items():
            if t != team_idx:
                continue
            name = name_of.get(sid, "")
            if name and not (name.isdigit() and len(name) >= 15):
                return name
        return f"Team {team_idx + 1}"

    team_names = [_team_name(0), _team_name(1)]

    # --- Players list ---
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
    players.sort(key=lambda x: (x["team"], x["name"]))

    return {
        "map": map_name,
        "teamNames": team_names,
        "score": score,
        "players": players,
        "date": date_iso,
        "tickrate": tickrate,
    }
