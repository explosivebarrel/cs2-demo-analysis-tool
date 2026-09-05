"""Worker CLI: analyze one demo, reporting progress via status.json.

Run: python -m app.worker <demo_path> <demo_id> [--probe]
"""
import sys
import threading
import traceback

from . import storage
from .pipeline.run import analyze_demo


def run_probe(demo_path: str, did: str):
    from .pipeline.probe import probe_demo
    storage.write_status(did, status="probing", progress=10, phase="probe")
    try:
        info = probe_demo(demo_path)
        storage.write_status(
            did, status="probed", progress=100, phase="probed",
            map=info.get("map", ""),
            score=info.get("score", [0, 0]),
            teamNames=info.get("teamNames", ["", ""]),
            players=info.get("players", []),
            date=info.get("date", ""),
        )
        print(f"[{did}] PROBE DONE {info['map']} {info['score']}", flush=True)
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        print(f"[{did}] PROBE FAILED {err}", flush=True)
        traceback.print_exc()
        storage.write_status(did, status="new", progress=0, phase="", error=err)
        sys.exit(1)


def run_analyze(demo_path: str, did: str):
    def progress(phase: str, pct: int, detail: str = ""):
        storage.write_status(did, status="parsing", progress=pct, phase=phase, detail=detail)
        print(f"[{did}] {phase}: {pct}%{' — ' + detail if detail else ''}", flush=True)

    storage.write_status(did, status="parsing", progress=0, phase="start", detail="")
    # long parse phases can stall real progress for tens of seconds; bump the
    # status file periodically so WS watchers see the job is alive
    stop = threading.Event()

    def heartbeat():
        while not stop.wait(3.0):
            storage.write_status(did)

    threading.Thread(target=heartbeat, daemon=True).start()
    try:
        try:
            info = analyze_demo(demo_path, did, progress)
        finally:
            stop.set()
        # grab date from file mtime
        import os
        from datetime import datetime, timezone
        try:
            mtime = os.path.getmtime(demo_path)
            date_iso = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
        except Exception:
            date_iso = ""
        storage.write_status(
            did, status="ready", progress=100, phase="done", detail="",
            result=info,
            map=info.get("map", ""),
            score=info.get("score", [0, 0]),
            teamNames=info.get("teamNames", ["", ""]),
            date=date_iso,
        )
        print(f"[{did}] DONE {info}", flush=True)
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        print(f"[{did}] FAILED {err}", flush=True)
        traceback.print_exc()
        storage.write_status(did, status="error", progress=0, phase="failed", detail="", error=err)
        sys.exit(1)


def main():
    args = sys.argv[1:]
    if "--probe" in args:
        args.remove("--probe")
        demo_path, did = args[0], args[1]
        run_probe(demo_path, did)
    else:
        demo_path, did = args[0], args[1]
        run_analyze(demo_path, did)


if __name__ == "__main__":
    main()
