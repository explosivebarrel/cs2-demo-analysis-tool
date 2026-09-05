"""Background auto-import: watch folders + FACEIT match history polling.

Both loops are optional and call `on_imported` with a demo id whenever a new
demo lands in uploads; main.py wires that to probe + automatic analysis.
Configuration comes from settings.effective() (env defaults overridden by
store/settings.json); `reload()` swaps the running loops after a change.

Only demos inside the import window (import.windowHours) are imported
automatically. Anything older that a source knows about — existing watch
files on the first scan, older FACEIT matches — is recorded as a suggestion
(store/suggestions.json) for the manual "download & analyze" button. A
background enricher thread fills in map/score/teams for suggestions: probe
for local files, the FACEIT match payload for remote matches.
"""
import asyncio
import json
import logging
import os
import re
import threading
import time
import urllib.request
from datetime import datetime, timezone

from . import config, ingest, settings, storage, suggestions

log = logging.getLogger("autowatch")

FRESH_SEC = 10  # younger mtime = file is probably still being written/copied
FACEIT_STATE_FILE = "faceit_state.json"
FACEIT_SEEN_CAP = 500
FACEIT_HISTORY_PAGE = 50
FACEIT_HISTORY_PAGES = 3  # up to 150 matches of history per poll
MATCH_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

_tasks: list[asyncio.Task] = []
_enricher: threading.Thread | None = None
_enricher_stop = threading.Event()


def _window_cutoff(eff: dict) -> float:
    return time.time() - int(eff["import"]["windowHours"]) * 3600


# ------------------------------------------------------------------ watch dirs
def _iter_watch_files(dirs: list[str]):
    for d in dirs:
        try:
            names = os.listdir(d)
        except OSError as e:
            log.warning("watch dir %s unreadable: %s", d, e)
            continue
        for name in sorted(names):
            if ingest.is_supported(name):
                yield os.path.join(d, name)


def import_file(path: str, origin: str) -> str | None:
    """Copy/decompress a demo file into uploads. Returns demo id or None."""
    name = os.path.basename(path)
    try:
        with open(path, "rb") as f:
            data = f.read()
        if len(data) > config.MAX_UPLOAD_BYTES:
            raise ValueError("file too large")
        did, base, _ = ingest.save_demo(name, data)
    except Exception as e:
        log.warning("import %s failed: %s", path, e)
        return None
    try:
        with open(os.path.join(config.UPLOADS_DIR, did + ".dem.name"), "w",
                  encoding="utf-8") as f:
            json.dump({"name": base, "origin": origin}, f)
    except OSError:
        pass
    return did


def _known_base_names() -> set[str]:
    """Lowercase display names of already-imported demos (dedup suggestions)."""
    return {ingest.strip_archive_suffix(d.get("name") or "").lower()
            for d in storage.list_demos()}


def _watch_suggestion(path: str) -> dict | None:
    try:
        st = os.stat(path)
    except OSError:
        return None
    return {
        "key": f"watch:{path}",
        "source": "watch",
        "name": ingest.strip_archive_suffix(os.path.basename(path)),
        "path": path,
        "size": st.st_size,
        "mtime": int(st.st_mtime),
        "date": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
    }


def _scan_once(seen: set[str], dirs: list[str], cutoff: float,
               known_names: set[str]) -> list[str]:
    imported = []
    now = time.time()
    for path in _iter_watch_files(dirs):
        if path in seen:
            continue
        seen.add(path)  # mark even on failure to avoid retry spam every poll
        try:
            mt = os.path.getmtime(path)
        except OSError:
            continue
        if now - mt < FRESH_SEC:
            seen.discard(path)  # re-check on the next poll once settled
            continue
        if mt < cutoff:  # outside the import window — offer it manually
            sugg = _watch_suggestion(path)
            if sugg and sugg["name"].lower() not in known_names:
                suggestions.upsert(sugg)
            continue
        did = import_file(path, "watch")
        if did:
            imported.append(did)
    return imported


async def _watch_loop(eff: dict, on_imported):
    dirs = eff["watch"]["dirs"]
    seen = set(_iter_watch_files(dirs))
    known = _known_base_names()
    for path in seen:  # first scan: surface known-but-unimported files only
        sugg = _watch_suggestion(path)
        if sugg and sugg["name"].lower() not in known:
            suggestions.upsert(sugg)
    suggestions.prune_missing_watch_files()
    log.info("watching %d dir(s), %d known file(s)", len(dirs), len(seen))
    while True:
        await asyncio.sleep(eff["watch"]["pollSec"])
        cutoff = _window_cutoff(eff)
        for did in _scan_once(seen, dirs, cutoff, _known_base_names()):
            log.info("watch: imported %s", did)
            on_imported(did)


# ---------------------------------------------------------------------- faceit
def _faceit_request(url: str, key: str) -> bytes:
    req = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + key,
        "User-Agent": "cs2-demo-analyzer",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def _faceit_history(eff: dict) -> list[dict]:
    """Recent matches covering the import window: [{id, started_at}]."""
    key = eff["faceit"]["apiKey"]
    cutoff = _window_cutoff(eff)
    out: list[dict] = []
    for page in range(FACEIT_HISTORY_PAGES):
        url = (f"https://api.faceit.com/data-api/v4/players/"
               f"{eff['faceit']['playerId']}/history"
               f"?limit={FACEIT_HISTORY_PAGE}&offset={page * FACEIT_HISTORY_PAGE}&game=cs2")
        items = json.loads(_faceit_request(url, key)).get("items") or []
        for it in items:
            mid = it.get("match_id") or it.get("id")
            if not mid:
                continue
            try:
                started = int(it.get("started_at") or 0)
            except (TypeError, ValueError):
                started = 0
            out.append({"id": str(mid), "started_at": started})
        if len(items) < FACEIT_HISTORY_PAGE:
            break
        oldest = min((m["started_at"] for m in out if m["started_at"]), default=0)
        if oldest and oldest < cutoff:
            break
    return out


def _faceit_demo_url(match_id: str, key: str) -> tuple[str, str] | None:
    url = f"https://api.faceit.com/matches/v1/match/{match_id}"
    payload = json.loads(_faceit_request(url, key)).get("payload") or {}
    for d in payload.get("demos") or []:
        dl = d.get("download_url") or d.get("url")
        if dl:
            return dl, d.get("name") or f"faceit-{match_id}.dem.gz"
    return None


def _faceit_match_meta(match_id: str, payload: dict) -> dict:
    """Map/teams/score/demo name from the matches/v1 payload (best effort)."""
    out: dict = {}
    teams = payload.get("teams") or {}
    f1 = teams.get("faction1") or {}
    f2 = teams.get("faction2") or {}
    if isinstance(f1, dict) and isinstance(f2, dict) and (f1.get("name") or f2.get("name")):
        out["teamNames"] = [f1.get("name") or "?", f2.get("name") or "?"]
    res = payload.get("results") or {}
    s1, s2 = res.get("score1"), res.get("score2")
    if isinstance(s1, int) and isinstance(s2, int):
        out["score"] = [s1, s2]
    gd = payload.get("gameDetails") or {}
    m = gd.get("map")
    if isinstance(m, dict):
        m = m.get("name")
    if isinstance(m, str) and m:
        out["map"] = m
    for d in payload.get("demos") or []:
        nm = d.get("name")
        if nm:
            out["name"] = ingest.strip_archive_suffix(nm)
            break
    return out


def _faceit_import_match(match_id: str, key: str) -> str | None:
    got = _faceit_demo_url(match_id, key)
    if not got:
        log.warning("faceit: no demo url for match %s", match_id)
        return None
    dl, name = got
    raw = ingest._read_capped(urllib.request.urlopen(
        urllib.request.Request(dl, headers={
            "Authorization": "Bearer " + key}), timeout=120),
        config.MAX_UPLOAD_BYTES)
    did, base, _ = ingest.save_demo(name, raw)
    with open(os.path.join(config.UPLOADS_DIR, did + ".dem.name"), "w",
              encoding="utf-8") as f:
        json.dump({"name": base, "origin": "faceit"}, f)
    return did


def _faceit_state() -> dict:
    """seen: match_id -> imported demo id ("" while not imported)."""
    path = os.path.join(config.STORE_DIR, FACEIT_STATE_FILE)
    try:
        with open(path, encoding="utf-8") as f:
            seen = json.load(f).get("seen")
    except (OSError, ValueError):
        seen = None
    if isinstance(seen, dict):
        return {"seen": {str(k): str(v) for k, v in seen.items()}}
    if isinstance(seen, list):  # legacy format: ids only
        return {"seen": {str(k): "" for k in seen}}
    return {"seen": {}}


def _save_faceit_state(st: dict) -> None:
    items = list(st["seen"].items())[-FACEIT_SEEN_CAP:]
    tmp = os.path.join(config.STORE_DIR, FACEIT_STATE_FILE + ".part")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"seen": dict(items)}, f)
    os.replace(tmp, os.path.join(config.STORE_DIR, FACEIT_STATE_FILE))


def _faceit_suggestion(item: dict) -> dict:
    started = item["started_at"]
    return {
        "key": f"faceit:{item['id']}",
        "source": "faceit",
        "name": f"faceit-{item['id']}.dem",
        "mtime": started,
        "date": datetime.fromtimestamp(started, tz=timezone.utc).isoformat() if started else "",
    }


async def _faceit_loop(eff: dict, on_imported):
    key = eff["faceit"]["apiKey"]
    st = _faceit_state()
    first = not st["seen"]
    log.info("faceit: polling every %ss for player %s",
             eff["faceit"]["pollSec"], eff["faceit"]["playerId"])
    while True:
        try:
            items = _faceit_history(eff)
            if first:
                # seed: remember everything, download nothing, suggest all
                for it in items:
                    st["seen"].setdefault(it["id"], "")
                    suggestions.upsert(_faceit_suggestion(it))
                _save_faceit_state(st)
                first = False
                log.info("faceit: seeded %d known match(es), imported none", len(items))
            else:
                cutoff = _window_cutoff(eff)
                for it in items:
                    mid = it["id"]
                    if mid not in st["seen"]:
                        st["seen"][mid] = ""
                        _save_faceit_state(st)  # persist before download: no retry loops
                        started = it["started_at"]
                        if started and started < cutoff:
                            suggestions.upsert(_faceit_suggestion(it))
                            continue
                        did = _faceit_import_match(mid, key)
                        if did:
                            st["seen"][mid] = did
                            _save_faceit_state(st)
                            log.info("faceit: imported match %s as %s", mid, did)
                            on_imported(did)
                    elif not st["seen"][mid] and not suggestions.get(f"faceit:{mid}"):
                        # legacy seed / failed download — offer it manually
                        suggestions.upsert(_faceit_suggestion(it))
        except Exception as e:
            log.warning("faceit poll failed: %s", e)
        await asyncio.sleep(eff["faceit"]["pollSec"])


# ------------------------------------------------------- suggestion enrichment
def _enrich_one(item: dict, eff: dict) -> None:
    try:
        if item["source"] == "watch":
            from .pipeline.probe import probe_demo
            info = probe_demo(item["path"])
            suggestions.update(item["key"], map=info.get("map", ""),
                               score=info.get("score", []),
                               teamNames=info.get("teamNames", []), meta=True)
            return
        if item["source"] == "faceit":
            mid = item["key"].split(":", 1)[1]
            payload = json.loads(_faceit_request(
                f"https://api.faceit.com/matches/v1/match/{mid}",
                eff["faceit"]["apiKey"])).get("payload") or {}
            fields = _faceit_match_meta(mid, payload)
            fields["meta"] = True
            suggestions.update(item["key"], **fields)
            return
    except Exception as e:
        log.warning("enrich %s failed: %s", item["key"], e)
    suggestions.update(item["key"], tries=int(item.get("tries", 0)) + 1)


def _enricher_loop() -> None:
    while not _enricher_stop.is_set():
        try:
            eff = settings.effective()
            pending = [it for it in suggestions.all_items()
                       if not it.get("meta") and int(it.get("tries", 0)) < 3]
            for item in pending:
                if _enricher_stop.is_set():
                    return
                _enrich_one(item, eff)
        except Exception as e:
            log.warning("suggestion enricher failed: %s", e)
        if _enricher_stop.wait(30):
            return


def _ensure_enricher() -> None:
    global _enricher
    if _enricher and _enricher.is_alive():
        return
    _enricher_stop.clear()
    _enricher = threading.Thread(target=_enricher_loop, daemon=True,
                                 name="suggestion-enricher")
    _enricher.start()


# ------------------------------------------------------- manual fetch (button)
def fetch_suggestion(key: str, on_imported) -> dict:
    """Import a suggestion now; synchronous — call from a worker thread."""
    item = suggestions.get(key)
    if item is None:
        return {"ok": False, "error": "unknown suggestion"}
    if item.get("fetching"):
        return {"ok": False, "error": "already fetching"}
    path = item.get("path", "")
    if item["source"] == "watch":
        root = os.path.normpath(path)
        allowed = False
        for d in settings.effective()["watch"]["dirs"]:
            nd = os.path.normpath(d)
            if root == nd or root.startswith(nd + os.sep):
                allowed = True
                break
        if not allowed:
            return {"ok": False, "error": "file is outside configured watch dirs"}
        if not os.path.exists(path):
            suggestions.remove(key)
            return {"ok": False, "error": "file is gone"}
    suggestions.update(key, fetching=True, error="")
    try:
        if item["source"] == "watch":
            did = import_file(path, "watch")
        else:
            mid = key.split(":", 1)[1]
            if not MATCH_ID_RE.match(mid):
                raise ValueError("bad match id")
            did = _faceit_import_match(mid, settings.effective()["faceit"]["apiKey"])
        if not did:
            raise RuntimeError("import failed (no demo file or too large)")
    except Exception as e:
        suggestions.update(key, fetching=False, error=f"{type(e).__name__}: {e}")
        return {"ok": False, "error": str(e)}
    suggestions.remove(key)
    on_imported(did)
    return {"ok": True, "did": did}


# ------------------------------------------------------------------- lifecycle
def _spawn_loops(on_imported) -> int:
    """Schedule enabled loops (per settings.effective()) on the running loop."""
    eff = settings.effective()
    n = 0
    if eff["watch"]["dirs"]:
        _tasks.append(asyncio.create_task(_watch_loop(eff, on_imported)))
        n += 1
    if eff["faceit"]["apiKey"] and eff["faceit"]["playerId"]:
        _tasks.append(asyncio.create_task(_faceit_loop(eff, on_imported)))
        n += 1
    _ensure_enricher()
    return n


def start(on_imported) -> int:
    """Schedule enabled loops on the running event loop. Returns task count."""
    return _spawn_loops(on_imported)


def reload(on_imported) -> int:
    """Swap running loops after a settings change; call inside the event loop."""
    for t in _tasks:
        t.cancel()
    _tasks.clear()
    n = _spawn_loops(on_imported)
    log.info("auto-import reconfigured: %d loop(s) running", n)
    return n


def status() -> dict:
    """Current auto-import configuration for the UI; never exposes the API key."""
    eff = settings.effective()
    pid = eff["faceit"]["playerId"]
    masked = (pid[:6] + "…" + pid[-4:]) if len(pid) > 12 else ("…" if pid else "")
    return {
        "import": {"windowHours": eff["import"]["windowHours"]},
        "watch": {
            "enabled": bool(eff["watch"]["dirs"]),
            "dirs": list(eff["watch"]["dirs"]),
            "pollSec": eff["watch"]["pollSec"],
        },
        "faceit": {
            "enabled": bool(eff["faceit"]["apiKey"] and eff["faceit"]["playerId"]),
            "playerId": masked,
            "pollSec": eff["faceit"]["pollSec"],
            "knownMatches": len(_faceit_state()["seen"]),
        },
        "suggestions": len(suggestions.all_items()),
    }
