"""Benchmark per-stage analysis speed on this machine.

Usage: .venv/Scripts/python scripts/benchmark_stages.py [path/to/demo.dem]
Runs the full pipeline, prints a per-stage timing table and a ready
CS2_PROGRESS_WEIGHTS line to pin the distribution via .env.
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("CS2_DATA_DIR", os.path.join(ROOT, "data", "local-bench"))
os.environ.setdefault("CS2_INBOX_DIR", os.path.join(ROOT, "demo-examples"))

sys.path.insert(0, os.path.join(ROOT, "backend"))

demo = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    ROOT, "demo-examples", "1-9799583b-608f-4fb7-b8c1-c066c24f2259-1-1.dem")

from app.pipeline.progress import DISPLAY_PHASE, STAGE_ORDER  # noqa: E402
from app.pipeline.run import analyze_demo  # noqa: E402

if not os.path.exists(demo):
    sys.exit(f"demo not found: {demo}")

t0 = time.time()
print(f"benchmark: {os.path.basename(demo)}")
info = analyze_demo(demo, "benchmark", lambda ph, pct, detail="": print(
    f"  {ph:10s} {pct:3d}%{' — ' + detail if detail else ''}  (+{time.time() - t0:.1f}s)",
    flush=True))

stages = info.get("stages", {})
total = sum(stages.values()) or 1.0
print(f"\n{'stage':16s} {'sec':>8s} {'share':>7s}")
for s in STAGE_ORDER:
    if s in stages:
        print(f"{DISPLAY_PHASE.get(s, s):16s} {stages[s]:8.1f} {stages[s] / total * 100:6.1f}%")
print(f"{'TOTAL':16s} {total:8.1f}   (wall {time.time() - t0:.1f}s)")

weights = {s: round(stages[s], 1) for s in STAGE_ORDER if stages.get(s, 0) > 0}
print("\nPin in .env to skip auto-calibration:")
print(f"CS2_PROGRESS_WEIGHTS='{weights}'")
