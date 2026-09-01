"""Build chat message list from demo events."""


def build_chat(ctx, rb) -> list[dict]:
    """Return list of chat messages with round context."""
    df = ctx.ev("chat_message")
    if df.empty:
        return []

    # build tick→round index
    tick_to_round: dict[int, int] = {}
    for r in rb.rounds:
        start = r.get("freezeEndTick", 0)
        end = r.get("endTick", 0)
        for t in range(start, end + 1, 64):
            tick_to_round[t] = r["n"]

    def _round_for_tick(tick: int) -> int | None:
        # find nearest round by scanning boundaries
        for r in rb.rounds:
            if r.get("freezeEndTick", 0) <= tick <= r.get("endTick", 0):
                return r["n"]
        return None

    messages = []
    for _, row in df.iterrows():
        tick = int(row.get("tick", 0))
        text = str(row.get("chat_message", "")).strip()
        if not text:
            continue
        steamid = str(row.get("user_steamid", ""))
        name = str(row.get("user_name", ""))
        rn = _round_for_tick(tick)
        messages.append({
            "tick": tick,
            "steamid": steamid,
            "name": name,
            "text": text,
            "round": rn,
        })

    messages.sort(key=lambda m: m["tick"])
    return messages
