"""Background auto-import: watch folders + FACEIT match history polling.

Both loops are optional (enabled by env vars in config) and call `on_imported`
with a demo id whenever a new demo lands in uploads; main.py wires that to
probe + automatic analysis.

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

from . import config, ingest

log = logging.getLogger("autowatch")

FRESH_SEC = 10  # younger mtime = file is probably still being written/copied
FACEIT_STATE_FILE = "faceit_state.json"
FACEIT_SEEN_CAP = 500


# ------------------------------------------------------------------ watch dirs
def _iter_watch_files():
    for d in config.WATCH_DIRS:
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


def _scan_once(seen: set[str]) -> list[str]:
    imported = []
    now = time.time()
    for path in _iter_watch_files():
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


async def _watch_loop(on_imported):
    seen = set(_iter_watch_files())
    log.info("watching %d dir(s), %d known file(s)", len(config.WATCH_DIRS), len(seen))
    while True:
        await asyncio.sleep(config.WATCH_POLL_SEC)
        for did in _scan_once(seen):
            log.info("watch: imported %s", did)
            on_imported(did)


# ---------------------------------------------------------------------- faceit
def _faceit_request(url: str) -> bytes:
    req = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + config.FACEIT_API_KEY,
        "User-Agent": "cs2-demo-analyzer",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def _faceit_history_match_ids() -> list[str]:
    url = (f"https://api.faceit.com/data-api/v4/players/"
           f"{config.FACEIT_PLAYER_ID}/history?limit=20&game=cs2")
    payload = json.loads(_faceit_request(url))
    items = payload.get("items") or []
    return [it.get("match_id") or it.get("id") for it in items
            if it.get("match_id") or it.get("id")]


def _faceit_demo_url(match_id: str) -> tuple[str, str] | None:
    url = f"https://api.faceit.com/matches/v1/match/{match_id}"
    payload = json.loads(_faceit_request(url)).get("payload") or {}
    for d in payload.get("demos") or []:
        dl = d.get("download_url") or d.get("url")
        if dl:
            return dl, d.get("name") or f"faceit-{match_id}.dem.gz"
    return None


def _faceit_import_match(match_id: str) -> str | None:
    got = _faceit_demo_url(match_id)
    if not got:
        log.warning("faceit: no demo url for match %s", match_id)
        return None
    dl, name = got
    raw = ingest._read_capped(urllib.request.urlopen(
        urllib.request.Request(dl, headers={
            "Authorization": "Bearer " + config.FACEIT_API_KEY}), timeout=120),
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


async def _faceit_loop(on_imported):
    st = _faceit_state()
    first = not st["seen"]
    log.info("faceit: polling every %ss for player %s",
             config.FACEIT_POLL_SEC, config.FACEIT_PLAYER_ID)
    while True:
        try:
            mids = _faceit_history_match_ids()
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
                did = _faceit_import_match(mid)
                if did:
                    log.info("faceit: imported match %s as %s", mid, did)
                    on_imported(did)
        except Exception as e:
            log.warning("faceit poll failed: %s", e)
        await asyncio.sleep(config.FACEIT_POLL_SEC)


def start(on_imported) -> int:
    """Schedule enabled loops on the running event loop. Returns task count."""
    n = 0
    if config.WATCH_DIRS:
        asyncio.create_task(_watch_loop(on_imported))
        n += 1
    if config.FACEIT_API_KEY and config.FACEIT_PLAYER_ID:
        asyncio.create_task(_faceit_loop(on_imported))
        n += 1
    return n


def status() -> dict:
    """Current auto-import configuration for the UI; never exposes the API key."""
    pid = config.FACEIT_PLAYER_ID
    masked = (pid[:6] + "…" + pid[-4:]) if len(pid) > 12 else ("…" if pid else "")
    return {
        "watch": {
            "enabled": bool(config.WATCH_DIRS),
            "dirs": list(config.WATCH_DIRS),
            "pollSec": config.WATCH_POLL_SEC,
        },
        "faceit": {
            "enabled": bool(config.FACEIT_API_KEY and config.FACEIT_PLAYER_ID),
            "playerId": masked,
            "pollSec": config.FACEIT_POLL_SEC,
            "knownMatches": len(_faceit_state()["seen"]),
        },
    }
