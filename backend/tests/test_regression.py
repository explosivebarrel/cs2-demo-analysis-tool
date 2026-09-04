"""Regression guard: compare analysis aggregates against the golden baseline.

Runs fast (no demo parsing): reads the existing analysis artifact from the
local-test data dir and compares it with backend/tests/baseline_after.json.
Regenerate the baseline with:
  python scripts/baseline_snapshot.py backend/tests/baseline_after.json
(full pipeline run, ~60 s). Skipped when artifacts are absent.
"""
import gzip
import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

DATA = os.path.join(ROOT, "data", "local-test")
BASELINE = os.path.join(os.path.dirname(__file__), "baseline_after.json")

_need = [BASELINE,
         os.path.join(DATA, "store", "analyses"),
         os.path.join(os.path.dirname(BASELINE), "..", "demo-examples")]
pytestmark = pytest.mark.skipif(
    not (os.path.exists(BASELINE) and os.path.isdir(_need[1])),
    reason="baseline or analysis artifact not present",
)


def _load_analysis():
    did = json.load(open(BASELINE, encoding="utf-8"))["_demo_id"]
    path = os.path.join(DATA, "store", "analyses", did, "analysis.json.gz")
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def _snapshot(a: dict) -> dict:
    from baseline_snapshot import snapshot_from_analysis
    return snapshot_from_analysis(a)


def test_score_and_round_count_unchanged():
    base = json.load(open(BASELINE, encoding="utf-8"))
    snap = _snapshot(_load_analysis())
    assert snap["score"] == base["score"]
    assert snap["rounds"] == base["rounds"]
    assert snap["round_winners"] == base["round_winners"]


def test_player_core_metrics_unchanged():
    base = {p["name"]: p for p in json.load(open(BASELINE, encoding="utf-8"))["players"]}
    snap = _snapshot(_load_analysis())
    for p in snap["players"]:
        o = base[p["name"]]
        assert p["kills"] == o["kills"], p["name"]
        assert p["deaths"] == o["deaths"], p["name"]
        assert p["adr"] == o["adr"], p["name"]
        assert p["kast"] == o["kast"], p["name"]
        assert p["saves"] == o["saves"], p["name"]
        assert p["holds"] == o["holds"], p["name"]
