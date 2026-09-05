"""Known-but-not-imported demos ("suggestions") shown in the demos list.

A suggestion is a demo an auto-import source has seen — a file in a watch
folder or a match in FACEIT history — that was not imported automatically
because it is older than the import window. Users import those manually via
POST /api/demos/fetch. Metadata (map/score/teams) is enriched in the
background by autowatch's enricher thread and cached in the record.
"""
import json
import os
import threading

from . import config

PATH = os.path.join(config.STORE_DIR, "suggestions.json")
CAP = 100  # keep the most recent suggestions only

_lock = threading.Lock()


def _load() -> list[dict]:
    try:
        with open(PATH, encoding="utf-8") as f:
            items = json.load(f).get("items", [])
    except (OSError, ValueError):
        return []
    return [it for it in items if isinstance(it, dict) and it.get("key")]


def _save(items: list[dict]) -> None:
    items = sorted(items, key=lambda it: it.get("mtime") or 0)[-CAP:]
    tmp = PATH + ".part"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"items": items}, f, ensure_ascii=False)
    os.replace(tmp, PATH)


def get(key: str) -> dict | None:
    with _lock:
        for it in _load():
            if it["key"] == key:
                return it
    return None


def all_items() -> list[dict]:
    with _lock:
        return _load()


def upsert(entry: dict) -> None:
    """Add or refresh a suggestion by key; enrichment fields survive."""
    with _lock:
        cur = {it["key"]: it for it in _load()}
        merged = dict(cur.get(entry["key"], {}))
        for k, v in entry.items():
            if v is not None:
                merged[k] = v
        cur[entry["key"]] = merged
        _save(list(cur.values()))


def update(key: str, **fields) -> None:
    upsert({"key": key, **fields})


def remove(key: str) -> None:
    with _lock:
        _save([it for it in _load() if it["key"] != key])


def prune_missing_watch_files() -> None:
    """Drop watch suggestions whose file has disappeared."""
    with _lock:
        items = [it for it in _load()
                 if it.get("source") != "watch"
                 or (it.get("path") and os.path.exists(it["path"]))]
        _save(items)


def list_entries() -> list[dict]:
    """Project records into DemoEntry-shaped dicts for GET /api/demos."""
    entries = []
    for it in all_items():
        entries.append({
            "id": it["key"],
            "key": it["key"],
            "name": it.get("name", ""),
            "size": it.get("size") or 0,
            "source": it.get("source", "watch"),
            "status": "available",
            "mtime": it.get("mtime") or 0,
            "date": it.get("date", ""),
            "map": it.get("map", ""),
            "score": it.get("score", []),
            "teamNames": it.get("teamNames", []),
            "fetching": bool(it.get("fetching")),
            "error": it.get("error"),
        })
    return entries
