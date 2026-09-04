"""Tests for the stage-progress tracker and calibration storage."""
from app import storage
from app.pipeline.progress import (
    DEFAULT_WEIGHTS,
    STAGE_ORDER,
    StageTracker,
    effective_weights,
    spans,
)

ALL_STAGES = ["probe", "events", "ticks", "grenades", "rounds", "frames",
              "players", "replay_events", "winprob", "heatmaps", "analytics",
              "chat", "writing"]


def test_spans_cover_bar_and_are_monotonic():
    sp = spans(DEFAULT_WEIGHTS)
    assert set(sp) == set(STAGE_ORDER)
    assert sp[STAGE_ORDER[0]][0] == 2
    prev_end = 2
    for s in STAGE_ORDER:
        a, b = sp[s]
        assert a >= prev_end
        assert b >= a
        prev_end = b
    assert prev_end == 98


def test_tracker_emits_monotonic_pcts_and_times_all_stages():
    seen = []
    trk = StageTracker(DEFAULT_WEIGHTS, lambda ph, pct, detail="": seen.append((ph, pct, detail)))
    for s in ALL_STAGES:
        trk.enter(s)
        trk.update(s, 0.5)
    trk.close_all()
    pcts = [p for _, p, _ in seen]
    assert pcts == sorted(pcts)
    assert 2 <= pcts[0] <= 98
    assert set(trk.seconds) == set(ALL_STAGES)
    assert all(v >= 0 for v in trk.seconds.values())


def test_tracker_zero_weight_stage_keeps_bounds():
    w = dict(DEFAULT_WEIGHTS, chat=0)
    sp = spans(w)
    assert sp["chat"][0] == sp["chat"][1]
    seen = []
    trk = StageTracker(w, lambda ph, pct, detail="": seen.append((ph, pct)))
    for s in ALL_STAGES:
        trk.enter(s)
    pcts = [p for _, p in seen]
    assert pcts == sorted(pcts)


def test_stage_record_dedupe_and_median(monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "STAGE_TIMES_PATH", str(tmp_path / "st.json"))
    storage.save_stage_record("aaa", "de_dust2", {"frames": 10.0, "probe": 4.0})
    storage.save_stage_record("bbb", "de_dust2", {"frames": 20.0, "probe": 6.0})
    storage.save_stage_record("aaa", "de_dust2", {"frames": 30.0, "probe": 8.0})
    recs = storage.load_stage_times()
    assert len(recs) == 2
    w = storage.stage_weights()
    assert w["frames"] == 25.0
    assert w["probe"] == 7.0


def test_stage_record_keeps_recent_only(monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "STAGE_TIMES_PATH", str(tmp_path / "st.json"))
    for i in range(13):
        storage.save_stage_record(f"d{i}", "de_dust2", {"frames": float(i)})
    recs = storage.load_stage_times()
    assert len(recs) == storage.STAGE_TIMES_KEEP
    assert [r["demoId"] for r in recs] == [f"d{i}" for i in range(3, 13)]


def test_env_pin_overrides_measured(monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "STAGE_TIMES_PATH", str(tmp_path / "st.json"))
    storage.save_stage_record("aaa", "de_dust2", {"frames": 10.0})
    monkeypatch.setenv("CS2_PROGRESS_WEIGHTS", '{"frames": 50}')
    w = effective_weights()
    assert w["frames"] == 50.0
    assert w["probe"] == DEFAULT_WEIGHTS["probe"]


def test_env_pin_garbage_ignored(monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "STAGE_TIMES_PATH", str(tmp_path / "missing.json"))
    monkeypatch.setenv("CS2_PROGRESS_WEIGHTS", "not json at all")
    assert effective_weights() == DEFAULT_WEIGHTS
