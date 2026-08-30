"""FastAPI application: demo registry, upload, analysis jobs, artifacts."""
import gzip
import json
import mimetypes
import os
import subprocess
import sys
import threading

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response

from . import config, storage
from .overviews import overview_for_client, radar_png_path

app = FastAPI(title="CS2 Demo Analyzer")
app.add_middleware(GZipMiddleware, minimum_size=2048)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

_jobs: dict[str, subprocess.Popen] = {}
_jobs_lock = threading.Lock()


@app.on_event("startup")
def _probe_unprobed_demos():
    """On startup, probe any demo that has no map/team info yet."""
    for demo in storage.list_demos():
        st = storage.read_status(demo["id"]) or {}
        if st.get("status") in ("new", None) and not st.get("map"):
            _start_probe(demo)


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


@app.get("/api/demos/{did}/player/{steamid}/analytics")
async def get_player_analytics(did: str, steamid: str):
    data = storage.read_player_analytics(did)
    if data is None:
        raise HTTPException(404, "Player analytics not found — re-analyze the demo")
    player_data = data.get(steamid)
    if player_data is None:
        raise HTTPException(404, f"No analytics for player {steamid}")
    return player_data


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
