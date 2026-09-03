"""FastAPI application: demo registry, upload, analysis jobs, artifacts."""
import asyncio
import gzip
import json
import mimetypes
import os
import subprocess
import sys
import threading

from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse

from . import config, storage
from .overviews import overview_for_client, radar_png_path

app = FastAPI(title="CS2 Demo Analyzer")
app.add_middleware(GZipMiddleware, minimum_size=2048)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

# ---------------------------------------------------------------- WebSocket
class _WSManager:
    def __init__(self):
        self._clients: list[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            self._clients.append(ws)

    async def disconnect(self, ws: WebSocket):
        async with self._lock:
            self._clients = [c for c in self._clients if c is not ws]

    async def broadcast(self, data: dict):
        msg = json.dumps(data)
        async with self._lock:
            dead = []
            for c in self._clients:
                try:
                    await c.send_text(msg)
                except Exception:
                    dead.append(c)
            self._clients = [c for c in self._clients if c not in dead]

    @property
    def count(self) -> int:
        return len(self._clients)


_ws_manager = _WSManager()

# Background task: watch status files for changes and push updates
_status_mtimes: dict[str, float] = {}


async def _status_watcher():
    """Poll status files every 0.5 s and push diffs to WebSocket clients."""
    while True:
        await asyncio.sleep(0.1)
        if _ws_manager.count == 0:
            continue
        try:
            demos = storage.list_demos()
            for d in demos:
                did = d["id"]
                sp = storage.status_path(did)
                try:
                    mtime = os.path.getmtime(sp)
                except OSError:
                    continue
                if _status_mtimes.get(did) != mtime:
                    _status_mtimes[did] = mtime
                    st = storage.read_status(did) or {}
                    await _ws_manager.broadcast({
                        "type": "status",
                        "id": did,
                        "status": st.get("status", "new"),
                        "progress": st.get("progress", 0),
                        "phase": st.get("phase", ""),
                        "detail": st.get("detail", ""),
                        "error": st.get("error"),
                        "map": st.get("map", ""),
                        "score": st.get("score", []),
                        "teamNames": st.get("teamNames", []),
                        "date": st.get("date", ""),
                    })
        except Exception:
            pass


@app.on_event("startup")
async def _startup():
    asyncio.create_task(_status_watcher())
    # probe new demos (sync call in thread to avoid blocking event loop)
    def _probe_new():
        for demo in storage.list_demos():
            st = storage.read_status(demo["id"]) or {}
            if st.get("status") in ("new", None) and not st.get("map"):
                _start_probe(demo)
    threading.Thread(target=_probe_new, daemon=True).start()

_jobs: dict[str, subprocess.Popen] = {}
_jobs_lock = threading.Lock()


def _find_demo(did: str) -> dict:
    for d in storage.list_demos():
        if d["id"] == did:
            return d
    raise HTTPException(404, "demo not found")


def _start_probe(demo: dict) -> bool:
    did = demo["id"]
    with _jobs_lock:
        if did in _jobs and _jobs[did].poll() is None:
            return False
        proc = subprocess.Popen(
            [sys.executable, "-m", "app.worker", _demo_fs_path(demo), did, "--probe"],
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        )
        _jobs[did] = proc
    return True



def _start_job(demo: dict) -> bool:
    did = demo["id"]
    with _jobs_lock:
        if did in _jobs and _jobs[did].poll() is None:
            return False
        proc = subprocess.Popen(
            [sys.executable, "-m", "app.worker", _demo_fs_path(demo), did],
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        )
        _jobs[did] = proc
    return True


def _demo_fs_path(demo: dict) -> str:
    return storage.demo_file_path(demo["id"], demo["name"], demo["source"])


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/benchmarks")
def benchmarks():
    return config.BENCHMARKS


@app.get("/api/demos")
def demos():
    return storage.list_demos()


@app.post("/api/demos/upload")
async def upload(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > config.MAX_UPLOAD_BYTES:
        raise HTTPException(413, "file too large")
    name = file.filename or "upload.dem"
    if not name.lower().endswith(".dem"):
        name += ".dem"
    did = storage.demo_id(os.path.basename(name), len(data))
    dest = os.path.join(config.UPLOADS_DIR, did + ".dem")
    with open(dest, "wb") as f:
        f.write(data)
    with open(dest + ".name", "w", encoding="utf-8") as f:
        json.dump({"name": os.path.basename(name)}, f)
    # auto-start probe so map/teams appear immediately
    demo = _find_demo(did)
    st = storage.read_status(did)
    if not st or st.get("status") in ("new", None):
        _start_probe(demo)
    return {"id": did, "name": name, "size": len(data)}


@app.post("/api/demos/{did}/probe")
def probe(did: str):
    demo = _find_demo(did)
    st = storage.read_status(did) or {}
    # don't probe if already analyzed or currently running
    if st.get("status") in ("parsing", "probing"):
        return {"started": False, "status": st}
    started = _start_probe(demo)
    return {"started": started, "status": storage.read_status(did) or {"status": "new"}}


@app.post("/api/demos/{did}/analyze")
def analyze(did: str):
    demo = _find_demo(did)
    started = _start_job(demo)
    return {"started": started, "status": storage.read_status(did) or {"status": "new"}}


@app.delete("/api/demos/{did}")
def delete_demo(did: str):
    demo = _find_demo(did)
    if demo["source"] != "upload":
        raise HTTPException(400, "inbox demos are read-only")
    with _jobs_lock:
        proc = _jobs.get(did)
        if proc and proc.poll() is None:
            raise HTTPException(409, "analysis in progress")
    for suffix in (".dem", ".dem.name"):
        try:
            os.remove(os.path.join(config.UPLOADS_DIR, did + suffix))
        except OSError:
            pass
    return {"deleted": did}


@app.get("/api/demos/{did}/status")
def status(did: str):
    _find_demo(did)
    return storage.read_status(did) or {"status": "new", "progress": 0}


def _read_artifact(did: str, name: str):
    path = os.path.join(storage.analysis_dir(did), name)
    if not os.path.exists(path):
        raise HTTPException(404, "not analyzed yet")
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


@app.get("/api/demos/{did}/analysis")
def analysis(did: str):
    _find_demo(did)
    return _read_artifact(did, "analysis.json.gz")


@app.get("/api/demos/{did}/heatmap")
def heatmap(did: str):
    _find_demo(did)
    return _read_artifact(did, "heatmap.json.gz")


@app.get("/api/demos/{did}/replay")
def replay(did: str):
    _find_demo(did)
    return _read_artifact(did, "replay.json.gz")


@app.get("/api/demos/{did}/chat")
def chat(did: str):
    _find_demo(did)
    return _read_artifact(did, "chat.json.gz")


@app.get("/api/demos/{did}/player/{steamid}/analytics")
async def get_player_analytics(did: str, steamid: str):
    data = storage.read_player_analytics(did)
    if data is None:
        raise HTTPException(404, "Player analytics not found — re-analyze the demo")
    player_data = data.get(steamid)
    if player_data is None:
        raise HTTPException(404, f"No analytics for player {steamid}")
    return player_data


# ------------------------------------------------------------------ WebSocket endpoint
@app.websocket("/ws/demos")
async def ws_demos(ws: WebSocket):
    await _ws_manager.connect(ws)
    try:
        # send full snapshot on connect so client is immediately up-to-date
        demos_snapshot = storage.list_demos()
        for d in demos_snapshot:
            st = storage.read_status(d["id"]) or {}
            await ws.send_text(json.dumps({
                "type": "status",
                "id": d["id"],
                "status": st.get("status", "new"),
                "progress": st.get("progress", 0),
                "phase": st.get("phase", ""),
                "detail": st.get("detail", ""),
                "error": st.get("error"),
                "map": st.get("map", ""),
                "score": st.get("score", []),
                "teamNames": st.get("teamNames", []),
                "date": st.get("date", ""),
            }))
        # keep alive — wait for disconnect
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await _ws_manager.disconnect(ws)


# ------------------------------------------------------------------ maps
@app.get("/api/maps/{map_name}/overview")
def map_overview(map_name: str):
    try:
        ov = overview_for_client(map_name)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"overview unavailable: {e}") from e
    return ov


@app.get("/api/maps/{map_name}/radar")
def map_radar(map_name: str):
    try:
        path = radar_png_path(map_name)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"radar unavailable: {e}") from e
    media = mimetypes.guess_type(path)[0] or "image/png"
    return FileResponse(path, media_type=media, headers={
        "Cache-Control": "public, max-age=86400"})
