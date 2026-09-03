"""Snapshot key analysis aggregates for regression comparison.

Usage:
  python scripts/baseline_snapshot.py <out.json> [demo.dem]

Runs the full pipeline on a demo (or reads an existing local-test artifact if
present and --reuse is passed) and writes a compact JSON with team/player
aggregates used as the regression baseline.
"""
import gzip
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("CS2_DATA_DIR", os.path.join(ROOT, "data", "local-test"))
os.environ.setdefault("CS2_INBOX_DIR", os.path.join(ROOT, "demo-examples"))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app import storage  # noqa: E402
from app.pipeline.run import analyze_demo  # noqa: E402


def snapshot_from_analysis(a: dict) -> dict:
    return {
        "map": a["meta"]["map"],
        "score": a["meta"]["score"],
        "rounds": a["meta"]["rounds"],
        "teams": [
            {"name": t["name"], "score": t["score"], "adr": t["adr"],
             "kast": t["kast"], "rating": t["rating"],
             "pistolsWon": t["pistolRoundsWon"], "firstKills": t["firstKills"]}
            for t in a["teams"]
        ],
        "players": [
            {"name": p["name"], "kills": p["kills"], "deaths": p["deaths"],
             "assists": p["assists"], "adr": p["adr"], "kast": p["kast"],
             "hsPct": p["hsPct"], "rating": p["rating"], "rws": p.get("rws"),
             "imp": p.get("imp"), "saves": p["movement"]["saves"],
             "holds": p["holdsCount"],
             "clutchWon": p["clutches"]["won"], "clutchPlayed": p["clutches"]["played"],
             "tradeKills": p["trades"]["tradeKills"],
             "tradedDeaths": p["trades"]["tradedDeaths"],
             "openK": p["opening"]["kills"], "openD": p["opening"]["deaths"]}
            for p in a["players"]
        ],
        "round_reasons": [r["reason"] for r in a["rounds"]],
        "round_winners": [r["winnerTeam"] for r in a["rounds"]],
        "round_sites": [r.get("bombSite") for r in a["rounds"]],
    }


def main():
    out_path = sys.argv[1]
    reuse = "--reuse" in sys.argv
    did = None
    for d in storage.list_demos():
        if storage.read_status(d["id"]) or {}.get("status"):
            pass
    # find any demo with an existing analysis artifact
    for d in storage.list_demos():
        if os.path.exists(os.path.join(storage.analysis_dir(d["id"]), "analysis.json.gz")):
            did = d["id"]
            break
    if not reuse or did is None:
        demo = next((f for f in os.listdir(os.environ["CS2_INBOX_DIR"]) if f.endswith(".dem")), None)
        if not demo:
            raise SystemExit("no demo found in inbox")
        demo_path = os.path.join(os.environ["CS2_INBOX_DIR"], demo)
        did = storage.demo_id(os.path.basename(demo_path), os.path.getsize(demo_path))
        print(f"analyzing {demo} ...")
        analyze_demo(demo_path, did)
    else:
        print(f"reusing analysis of {did}")

    with gzip.open(os.path.join(storage.analysis_dir(did), "analysis.json.gz"), "rt", encoding="utf-8") as f:
        a = json.load(f)
    snap = snapshot_from_analysis(a)
    snap["_demo_id"] = did
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, indent=1)
    print(f"baseline written: {out_path} (demo {did}, score {snap['score']})")


if __name__ == "__main__":
    main()
