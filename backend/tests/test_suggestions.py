"""Import window, suggestions store, and manual fetch plumbing (no network)."""
import json
import os
import time

import pytest

from app import autowatch, config, settings, storage, suggestions


def _sugg_file(tmp_path, monkeypatch):
    monkeypatch.setattr(suggestions, "PATH", str(tmp_path / "suggestions.json"))


def _watch_dir(tmp_path, monkeypatch):
    d = tmp_path / "watch"
    d.mkdir()
    monkeypatch.setattr(config, "WATCH_DIRS", [str(d)])
    return d


# ---------------------------------------------------------------- suggestions
def test_upsert_preserves_enrichment(tmp_path, monkeypatch):
    _sugg_file(tmp_path, monkeypatch)
    suggestions.upsert({"key": "watch:/w/a.dem", "source": "watch", "name": "a.dem",
                        "path": "/w/a.dem", "size": 5, "mtime": 100})
    suggestions.update("watch:/w/a.dem", map="de_dust2", score=[13, 9], meta=True)
    suggestions.upsert({"key": "watch:/w/a.dem", "source": "watch", "name": "a.dem",
                        "path": "/w/a.dem", "size": 7, "mtime": 200})
    it = suggestions.get("watch:/w/a.dem")
    assert it["size"] == 7 and it["mtime"] == 200
    assert it["map"] == "de_dust2" and it["meta"] is True


def test_cap_keeps_newest(tmp_path, monkeypatch):
    _sugg_file(tmp_path, monkeypatch)
    for i in range(suggestions.CAP + 20):
        suggestions.upsert({"key": f"faceit:m{i}", "source": "faceit", "mtime": i})
    items = suggestions.all_items()
    assert len(items) == suggestions.CAP
    assert min(int(it["mtime"]) for it in items) == 20


def test_remove_and_prune(tmp_path, monkeypatch):
    _sugg_file(tmp_path, monkeypatch)
    gone = tmp_path / "gone.dem"
    gone.write_bytes(b"x")
    suggestions.upsert({"key": f"watch:{gone}", "source": "watch",
                        "path": str(gone), "mtime": 1})
    suggestions.upsert({"key": "watch:/never/there.dem", "source": "watch",
                        "path": "/never/there.dem", "mtime": 2})
    suggestions.upsert({"key": "faceit:m1", "source": "faceit", "mtime": 3})
    suggestions.prune_missing_watch_files()
    keys = {it["key"] for it in suggestions.all_items()}
    assert keys == {"faceit:m1", f"watch:{gone}"}
    suggestions.remove(f"watch:{gone}")
    assert suggestions.get(f"watch:{gone}") is None


def test_list_entries_projection(tmp_path, monkeypatch):
    _sugg_file(tmp_path, monkeypatch)
    suggestions.upsert({"key": "faceit:m1", "source": "faceit", "name": "x.dem",
                        "mtime": 1700000000, "date": "2026-01-01T00:00:00+00:00",
                        "map": "de_mirage", "score": [10, 7], "teamNames": ["A", "B"]})
    e = suggestions.list_entries()[0]
    assert e["id"] == "faceit:m1"
    assert e["status"] == "available"
    assert e["source"] == "faceit"
    assert e["map"] == "de_mirage"
    assert e["fetching"] is False


# ------------------------------------------------------------------- settings
def test_import_window_setting(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "FILE", str(tmp_path / "settings.json"))
    monkeypatch.setattr(config, "IMPORT_WINDOW_HOURS", 12)
    assert settings.effective()["import"] == {"windowHours": 12}
    settings.write({"import": {"windowHours": 72}})
    assert settings.effective()["import"]["windowHours"] == 72
    for bad in ({"import": {"windowHours": 0}}, {"import": {"windowHours": 10000}},
                {"import": {"windowHours": "abc"}}):
        with pytest.raises(ValueError):
            settings.write(bad)


# ---------------------------------------------------------------------- watch
def test_scan_window(tmp_path, monkeypatch):
    _sugg_file(tmp_path, monkeypatch)
    d = _watch_dir(tmp_path, monkeypatch)
    now = time.time()
    fresh = d / "new.dem"
    fresh.write_bytes(b"\x00" * 16)
    os.utime(fresh, (now - 60, now - 60))              # inside the window
    old = d / "old.dem"
    old.write_bytes(b"\x00" * 16)
    os.utime(old, (now - 48 * 3600, now - 48 * 3600))  # outside

    cutoff = now - 12 * 3600
    seen: set[str] = set()
    imported = autowatch._scan_once(seen, [str(d)], cutoff, set())
    assert len(imported) == 1
    items = suggestions.all_items()
    assert len(items) == 1 and items[0]["name"] == "old.dem"

    # re-scan imports nothing and does not duplicate the suggestion
    assert autowatch._scan_once(seen, [str(d)], cutoff, set()) == []
    assert len(suggestions.all_items()) == 1


def test_scan_skips_known_names(tmp_path, monkeypatch):
    _sugg_file(tmp_path, monkeypatch)
    d = _watch_dir(tmp_path, monkeypatch)
    now = time.time()
    f = d / "known.dem.gz"
    f.write_bytes(b"\x00" * 16)
    os.utime(f, (now - 48 * 3600, now - 48 * 3600))
    imported = autowatch._scan_once(set(), [str(d)], now - 3600, {"known.dem"})
    assert imported == []
    assert suggestions.all_items() == []


# --------------------------------------------------------------------- faceit
def test_faceit_state_migrates_legacy_list(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "STORE_DIR", str(tmp_path))
    (tmp_path / "faceit_state.json").write_text(json.dumps({"seen": ["aa", "bb"]}))
    assert autowatch._faceit_state()["seen"] == {"aa": "", "bb": ""}


def test_faceit_state_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "STORE_DIR", str(tmp_path))
    autowatch._save_faceit_state({"seen": {"m1": "abc123", "m2": ""}})
    assert autowatch._faceit_state()["seen"] == {"m1": "abc123", "m2": ""}


def test_faceit_suggestion_enriched_from_history():
    item = {"id": "m1", "started_at": 1700000000,
            "teams": {"faction1": {"nickname": "NaVi"},
                      "faction2": {"nickname": "FaZe"}},
            "results": {"winner": "faction1",
                        "score": {"faction1": 16, "faction2": 14}}}
    s = autowatch._faceit_suggestion(item)
    assert s["key"] == "faceit:m1"
    assert s["teamNames"] == ["NaVi", "FaZe"]
    assert s["score"] == [16, 14]
    assert s["meta"] is True
    assert s["mtime"] == 1700000000


# ---------------------------------------------------------------------- fetch
def test_fetch_watch_file(tmp_path, monkeypatch):
    _sugg_file(tmp_path, monkeypatch)
    d = _watch_dir(tmp_path, monkeypatch)
    f = d / "manual.dem"
    f.write_bytes(b"\x00" * 16)
    suggestions.upsert({"key": f"watch:{f}", "source": "watch", "name": "manual.dem",
                        "path": str(f), "size": 16, "mtime": 1})
    got: list[str] = []
    out = autowatch.fetch_suggestion(f"watch:{f}", got.append)
    assert out["ok"] is True and len(got) == 1
    assert suggestions.get(f"watch:{f}") is None
    assert os.path.exists(os.path.join(config.UPLOADS_DIR, out["did"] + ".dem"))


def test_fetch_rejects_outside_dirs(tmp_path, monkeypatch):
    _sugg_file(tmp_path, monkeypatch)
    _watch_dir(tmp_path, monkeypatch)
    suggestions.upsert({"key": "watch:/etc/passwd.dem", "source": "watch",
                        "name": "passwd.dem", "path": "/etc/passwd.dem", "mtime": 1})
    out = autowatch.fetch_suggestion("watch:/etc/passwd.dem", lambda did: None)
    assert out["ok"] is False
    assert suggestions.get("watch:/etc/passwd.dem") is not None


def test_fetch_bad_match_id(tmp_path, monkeypatch):
    _sugg_file(tmp_path, monkeypatch)
    suggestions.upsert({"key": "faceit:../evil", "source": "faceit", "mtime": 1})
    out = autowatch.fetch_suggestion("faceit:../evil", lambda did: None)
    assert out["ok"] is False


# --------------------------------------------------- auto-import -> analyze
def test_auto_imported_starts_analysis_without_probe(monkeypatch):
    from app import main
    demo = {"id": "d1", "name": "a.dem", "source": "upload"}
    calls: list[str] = []
    monkeypatch.setattr(storage, "list_demos", lambda: [demo])
    monkeypatch.setattr(main, "_start_job", lambda d: calls.append("job") or "started")
    monkeypatch.setattr(main, "_start_probe", lambda d: calls.append("probe"))
    main._auto_imported("d1")
    assert calls == ["job"]


def test_auto_imported_probes_when_already_analyzed(monkeypatch):
    from app import main
    demo = {"id": "d1", "name": "a.dem", "source": "upload"}
    os.makedirs(storage.analysis_dir("d1"), exist_ok=True)
    with open(os.path.join(storage.analysis_dir("d1"), "analysis.json.gz"), "wb"):
        pass
    calls: list[str] = []
    monkeypatch.setattr(storage, "list_demos", lambda: [demo])
    monkeypatch.setattr(storage, "read_status", lambda did: {"status": "new"})
    monkeypatch.setattr(main, "_start_job", lambda d: calls.append("job") or "started")
    monkeypatch.setattr(main, "_start_probe", lambda d: calls.append("probe"))
    main._auto_imported("d1")
    assert calls == ["probe"]
