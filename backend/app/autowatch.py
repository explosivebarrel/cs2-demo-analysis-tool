"""Background auto-import: watch folders + FACEIT match history polling.

Both loops are optional and call `on_imported` with a demo id whenever a new
demo lands in uploads; main.py wires that to probe + automatic analysis.
Configuration comes from settings.effective() (env defaults overridden by
store/settings.json); `reload()` swaps the running loops after a change.

First scan of a watch dir / FACEIT history only seeds the "seen" set without
importing, so pointing CS2_WATCH_DIRS at an archive folder doesn't trigger a
mass import on startup — only files that appear later are picked up.
"""
import asyncio
import json
import logging
import os
import time
import urllib.request

from . import config, ingest, settings

log = logging.getLogger("autowatch")

FRESH_SEC = 10  # younger mtime = file is probably still being written/copied
FACEIT_STATE_FILE = "faceit_state.json"
FACEIT_SEEN_CAP = 500

_tasks: list[asyncio.Task] = []


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


def _scan_once(seen: set[str], dirs: list[str]) -> list[str]:
    imported = []
    now = time.time()
    for path in _iter_watch_files(dirs):
        if path in seen:
            continue
        seen.add(path)  # mark even on failure to avoid retry spam every poll
        try:
            if now - os.path.getmtime(path) < FRESH_SEC:
                seen.discard(path)  # re-check on the next poll once settled
                continue
        except OSError:
            continue
        did = import_file(path, "watch")
        if did:
            imported.append(did)
    return imported


async def _watch_loop(eff: dict, on_imported):
    dirs = eff["watch"]["dirs"]
    seen = set(_iter_watch_files(dirs))
    log.info("watching %d dir(s), %d known file(s)", len(dirs), len(seen))
    while True:
        await asyncio.sleep(eff["watch"]["pollSec"])
        for did in _scan_once(seen, dirs):
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


def _faceit_history_match_ids(eff: dict) -> list[str]:
    url = (f"https://api.faceit.com/data-api/v4/players/"
           f"{eff['faceit']['playerId']}/history?limit=20&game=cs2")
    payload = json.loads(_faceit_request(url, eff["faceit"]["apiKey"]))
    items = payload.get("items") or []
    return [it.get("match_id") or it.get("id") for it in items
            if it.get("match_id") or it.get("id")]


def _faceit_demo_url(match_id: str, key: str) -> tuple[str, str] | None:
    url = f"https://api.faceit.com/matches/v1/match/{match_id}"
    payload = json.loads(_faceit_request(url, key)).get("payload") or {}
    for d in payload.get("demos") or []:
        dl = d.get("download_url") or d.get("url")
        if dl:
            return dl, d.get("name") or f"faceit-{match_id}.dem.gz"
    return None


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
    path = os.path.join(config.STORE_DIR, FACEIT_STATE_FILE)
    try:
        with open(path, "r", encoding="utf-8") as f:
            st = json.load(f)
        if isinstance(st.get("seen"), list):
            st["seen"] = set(st["seen"])
            return st
    except (OSError, ValueError):
        pass
    return {"seen": set()}


def _save_faceit_state(st: dict) -> None:
    st["seen"] = list(st["seen"])[-FACEIT_SEEN_CAP:]
    tmp = os.path.join(config.STORE_DIR, FACEIT_STATE_FILE + ".part")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(st, f)
    os.replace(tmp, os.path.join(config.STORE_DIR, FACEIT_STATE_FILE))


async def _faceit_loop(eff: dict, on_imported):
    key = eff["faceit"]["apiKey"]
    st = _faceit_state()
    first = not st["seen"]
    log.info("faceit: polling every %ss for player %s",
             eff["faceit"]["pollSec"], eff["faceit"]["playerId"])
    while True:
        try:
            mids = _faceit_history_match_ids(eff)
            if first:
                st["seen"].update(mids)
                _save_faceit_state(st)
                first = False
                log.info("faceit: seeded %d known match(es), will import new ones only", len(mids))
            for mid in mids:
                if mid in st["seen"]:
                    continue
                st["seen"].add(mid)
                _save_faceit_state(st)  # persist before download: no retry loops
                did = _faceit_import_match(mid, key)
                if did:
                    log.info("faceit: imported match %s as %s", mid, did)
                    on_imported(did)
        except Exception as e:
            log.warning("faceit poll failed: %s", e)
        await asyncio.sleep(eff["faceit"]["pollSec"])


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
    }
