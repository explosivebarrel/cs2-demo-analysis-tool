"""Runtime settings persisted in the data store, overriding env defaults.

settings.json lives on the cs2_store volume, so values survive container
recreation. Env vars remain the bootstrap defaults: anything explicitly
saved here wins. Written by PUT /api/settings, read by autowatch loops.
"""
import json
import os

from . import config

FILE = os.path.join(config.STORE_DIR, "settings.json")

POLL_LIMITS = {"watch": (5, 3600), "faceit": (30, 86400)}


def read() -> dict:
    """Raw saved settings (may be empty/partial)."""
    try:
        with open(FILE, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def write(patch: dict) -> None:
    """Validate a partial patch and merge it into settings.json."""
    clean: dict = {}
    watch = patch.get("watch")
    if isinstance(watch, dict):
        dirs = watch.get("dirs")
        if dirs is not None:
            if not isinstance(dirs, list) or not all(isinstance(d, str) for d in dirs):
                raise ValueError("watch.dirs must be a list of strings")
            clean.setdefault("watch", {})["dirs"] = [d.strip() for d in dirs if d.strip()]
        poll = watch.get("pollSec")
        if poll is not None:
            clean.setdefault("watch", {})["pollSec"] = _poll_int(poll, "watch")
    faceit = patch.get("faceit")
    if isinstance(faceit, dict):
        for key in ("apiKey", "playerId"):
            if key in faceit and faceit[key] is not None:
                if not isinstance(faceit[key], str):
                    raise ValueError(f"faceit.{key} must be a string")
                clean.setdefault("faceit", {})[key] = faceit[key].strip()
        poll = faceit.get("pollSec")
        if poll is not None:
            clean.setdefault("faceit", {})["pollSec"] = _poll_int(poll, "faceit")
    if not clean:
        return
    cur = read()
    for section, values in clean.items():
        cur.setdefault(section, {}).update(values)
    tmp = FILE + ".part"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cur, f)
    os.replace(tmp, FILE)


def _poll_int(value, section: str) -> int:
    lo, hi = POLL_LIMITS[section]
    try:
        v = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{section}.pollSec must be an integer")
    if not lo <= v <= hi:
        raise ValueError(f"{section}.pollSec must be {lo}..{hi}")
    return v


def effective() -> dict:
    """Env defaults overridden by anything explicitly saved."""
    eff = {
        "watch": {"dirs": list(config.WATCH_DIRS), "pollSec": config.WATCH_POLL_SEC},
        "faceit": {
            "apiKey": config.FACEIT_API_KEY,
            "playerId": config.FACEIT_PLAYER_ID,
            "pollSec": config.FACEIT_POLL_SEC,
        },
    }
    saved = read()
    for section in ("watch", "faceit"):
        if isinstance(saved.get(section), dict):
            for k, v in saved[section].items():
                if v is not None:
                    eff[section][k] = v
    eff["watch"]["dirs"] = [d for d in eff["watch"]["dirs"] if isinstance(d, str) and d.strip()]
    for section in ("watch", "faceit"):
        lo, hi = POLL_LIMITS[section]
        eff[section]["pollSec"] = max(lo, min(hi, int(eff[section]["pollSec"])))
    return eff
