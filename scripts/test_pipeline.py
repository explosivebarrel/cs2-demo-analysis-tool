"""Local end-to-end pipeline test on a real demo."""
import os
import sys
import time
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.environ["CS2_DATA_DIR"] = os.path.join(ROOT, "data", "local-test")
os.environ["CS2_INBOX_DIR"] = os.path.join(ROOT, "demo-examples")

sys.path.insert(0, os.path.join(ROOT, "backend"))

demo = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    ROOT, "demo-examples", "1-9799583b-608f-4fb7-b8c1-c066c24f2259-1-1.dem")

from app import storage  # noqa: E402
from app.pipeline.run import analyze_demo  # noqa: E402

did = storage.demo_id(os.path.basename(demo), os.path.getsize(demo))
print(f"demo_id={did} file={os.path.basename(demo)}")

t0 = time.time()
info = analyze_demo(demo, did, lambda ph, pct, detail="": print(f"  {ph:10s} {pct:3d}%  {detail}  (+{time.time()-t0:.1f}s)"))
print("RESULT:", info)

# sanity checks
import gzip
ad = os.path.join(storage.analysis_dir(did), "analysis.json.gz")
with gzip.open(ad, "rt", encoding="utf-8") as f:
    a = json.load(f)
m = a["meta"]
print(f"\nmap={m['map']} rounds={m['rounds']} score={m['score']} teams={m['teamNames']}")
print(f"tickrate={m['tickrate']} duration={m['durationSec']:.0f}s")
for t in a["teams"]:
    print(f"  team {t['name']}: score={t['score']} adr={t['adr']} kast={t['kast']} rating={t['rating']} pistols={t['pistolRoundsWon']}")
print("\nTOP PLAYERS")
for p in a["players"][:3]:
    print(f"  {p['name']:15s} R={p['rating']:.2f} K/D/A={p['kills']}/{p['deaths']}/{p['assists']} "
          f"ADR={p['adr']} HS%={p['hsPct']} KAST={p['kast']} OK={p['opening']['kills']}/{p['opening']['deaths']} "
          f"clutches={p['clutches']['won']}/{p['clutches']['played']} 2k..5k={p['multiKills']['2k']}/{p['multiKills']['3k']}/{p['multiKills']['4k']}/{p['multiKills']['5k']}")
r0 = a["rounds"][0]
print(f"\nround1: winner={r0['winnerTeam']} reason={r0['reason']} pistol={r0['isPistol']} buy={r0['buyTeam0']}/{r0['buyTeam1']}")
r_last = a["rounds"][-1]
print(f"last round: n={r_last['n']} score={r_last['scoreTeam0']}:{r_last['scoreTeam1']}")

for name in ("replay.json.gz", "heatmap.json.gz"):
    p = os.path.join(storage.analysis_dir(did), name)
    print(f"{name}: {os.path.getsize(p)/1e6:.1f} MB")
with gzip.open(os.path.join(storage.analysis_dir(did), "heatmap.json.gz"), "rt", encoding="utf-8") as f:
    h = json.load(f)
print("heatmap layers:", {k: len(v) for k, v in h["layers"].items()})
with gzip.open(os.path.join(storage.analysis_dir(did), "replay.json.gz"), "rt", encoding="utf-8") as f:
    r = json.load(f)
print(f"replay frames={len(r['ticks'])} events={len(r['events'])} shots={len(r['shots'])} players={len(r['players'])}")
