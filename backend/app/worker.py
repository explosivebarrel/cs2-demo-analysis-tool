"""Worker CLI: analyze one demo, reporting progress via status.json.

Run: python -m app.worker <demo_path> <demo_id>
"""
import sys
import traceback

from . import storage
from .pipeline.run import analyze_demo


def main():
    demo_path, did = sys.argv[1], sys.argv[2]

    def progress(phase, pct):
        storage.write_status(did, status="parsing", progress=pct, phase=phase)
        print(f"[{did}] {phase}: {pct}%", flush=True)

    storage.write_status(did, status="parsing", progress=0, phase="start")
    try:
        info = analyze_demo(demo_path, did, progress)
        storage.write_status(
            did, status="ready", progress=100, phase="done",
            result=info,
            map=info.get("map", ""),
            score=info.get("score", [0, 0]),
            teamNames=info.get("teamNames", ["", ""]),
        )
        print(f"[{did}] DONE {info}", flush=True)
    except Exception as e:  # noqa: BLE001 - report any failure to UI
        err = f"{type(e).__name__}: {e}"
        print(f"[{did}] FAILED {err}", flush=True)
        traceback.print_exc()
        storage.write_status(did, status="error", progress=0, phase="failed", error=err)
        sys.exit(1)


if __name__ == "__main__":
    main()
