"""Demo registry: inbox + uploaded demos, ids, statuses, artifact paths."""
import hashlib
import json
import os
import threading
import time

from . import config


def demo_id(name: str, size: int) -> str:
    h = hashlib.sha1(f"{name}:{size}".encode("utf-8", "replace")).hexdigest()
    return h[:12]


def status_path(did: str) -> str:
    return os.path.join(config.STATUS_DIR, did + ".json")


def analysis_dir(did: str) -> str:
    return os.path.join(config.ANALYSES_DIR, did)


def demo_file_path(did: str, name: str, source: str) -> str:
    if source == "upload":
        return os.path.join(config.UPLOADS_DIR, did + ".dem")
    return os.path.join(config.INBOX_DIR, name)


def read_status(did: str):
    try:
        with open(status_path(did), "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def write_status(did: str, **fields):
    st = read_status(did) or {}
    st.update(fields)
    st["updated"] = time.time()
    # unique tmp per writer: the worker heartbeat thread and the progress
    # callback write the same file concurrently from different threads
    tmp = status_path(did) + f".tmp.{os.getpid()}.{threading.get_ident()}"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(st, f)
    os.replace(tmp, status_path(did))
    return st


def list_inbox():
    out = []
    try:
        names = os.listdir(config.INBOX_DIR)
    except OSError:
        names = []
    for name in sorted(names):
        p = os.path.join(config.INBOX_DIR, name)
        if not os.path.isfile(p):
            continue
        if not name.lower().endswith((".dem", ".dem.gz", ".dem.bz2")):
            continue
        st = os.stat(p)
        out.append({
            "id": demo_id(name, st.st_size),
            "name": name,
            "size": st.st_size,
            "mtime": st.st_mtime,
            "source": "inbox",
        })
    return out


def list_uploads():
    out = []
    try:
        names = os.listdir(config.UPLOADS_DIR)
    except OSError:
        names = []
    for fname in sorted(names):
        if not fname.endswith(".dem"):
            continue
        p = os.path.join(config.UPLOADS_DIR, fname)
        st = os.stat(p)
        # display name stored alongside as meta json
        meta = {}
        mp = p + ".name"
        if os.path.exists(mp):
            try:
                with open(mp, "r", encoding="utf-8") as f:
                    meta = json.load(f)
            except Exception:
                meta = {}
        out.append({
            "id": fname[:-4],
            "name": meta.get("name", fname),
            "size": st.st_size,
            "mtime": st.st_mtime,
            "source": "upload",
        })
    return out


def player_analytics_path(did: str) -> str:
    return os.path.join(analysis_dir(did), "player_analytics.json.gz")


def read_player_analytics(did: str) -> dict | None:
    p = player_analytics_path(did)
    if not os.path.exists(p):
        return None
    import gzip
    import json
    with gzip.open(p, "rt", encoding="utf-8") as f:
        return json.load(f)


def list_demos():
    """Combined registry with statuses."""
    items = {}
    for it in list_inbox() + list_uploads():
        items[it["id"]] = it
    result = []
    for did, it in items.items():
        entry = dict(it)
        st = read_status(did) or {"status": "new", "progress": 0}
        entry["status"] = st.get("status", "new")
        entry["progress"] = st.get("progress", 0)
        entry["phase"] = st.get("phase", "")
        entry["detail"] = st.get("detail", "")
        entry["error"] = st.get("error")
        entry["ready"] = os.path.exists(os.path.join(analysis_dir(did), "analysis.json.gz"))
        entry["map"] = st.get("map", "")
        entry["score"] = st.get("score", [])
        entry["teamNames"] = st.get("teamNames", [])
        entry["players"] = st.get("players", [])
        entry["date"] = st.get("date", "")
        result.append(entry)
    result.sort(key=lambda x: -x["mtime"])
    return result


# ------------------------------------------------------------------ history
HISTORY_PATH = os.path.join(config.STORE_DIR, "history.json")


def load_history() -> list[dict]:
    try:
        with open(HISTORY_PATH, "r", encoding="utf-8") as f:
            return json.load(f).get("entries", [])
    except Exception:
        return []


def save_history_entry(entry: dict) -> None:
    entries = load_history()
    entries = [e for e in entries if e.get("demoId") != entry.get("demoId")]
    entries.append(entry)
    entries.sort(key=lambda e: e.get("date") or "")
    tmp = HISTORY_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"entries": entries}, f, ensure_ascii=False)
    os.replace(tmp, HISTORY_PATH)
