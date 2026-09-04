"""Watch-folder scan + import plumbing (no network)."""
import json
import os
import time

from app import autowatch, config


def _make_watch_dir(tmp_path, monkeypatch):
    d = tmp_path / "watch"
    d.mkdir()
    monkeypatch.setattr(config, "WATCH_DIRS", [str(d)])
    return d


def _settle(path):
    old = time.time() - autowatch.FRESH_SEC - 5
    os.utime(path, (old, old))


def test_seed_ignores_non_demos(tmp_path, monkeypatch):
    d = _make_watch_dir(tmp_path, monkeypatch)
    (d / "a.dem").write_bytes(b"\xde\xad")
    (d / "b.txt").write_bytes(b"nope")

    seen = set(autowatch._iter_watch_files())
    assert len(seen) == 1
    assert autowatch._scan_once(seen) == []  # nothing new afterwards


def test_scan_imports_new_file(tmp_path, monkeypatch):
    d = _make_watch_dir(tmp_path, monkeypatch)
    seen = set(autowatch._iter_watch_files())

    demo = d / "new.dem"
    demo.write_bytes(b"\x00" * 16)
    _settle(demo)

    imported = autowatch._scan_once(seen)
    assert len(imported) == 1
    did = imported[0]
    assert os.path.exists(os.path.join(config.UPLOADS_DIR, did + ".dem"))
    meta = json.load(open(os.path.join(config.UPLOADS_DIR, did + ".dem.name"),
                          encoding="utf-8"))
    assert meta["origin"] == "watch"

    # fresh file (still copying) is postponed, not lost
    fresh = d / "fresh.dem"
    fresh.write_bytes(b"\x00" * 16)
    assert autowatch._scan_once(seen) == []
    assert str(fresh) not in seen
    _settle(fresh)
    assert len(autowatch._scan_once(seen)) == 1


def test_import_failure_not_retried(tmp_path, monkeypatch):
    d = _make_watch_dir(tmp_path, monkeypatch)
    (d / "bad.zst").write_bytes(b"not-zstd")
    _settle(d / "bad.zst")
    seen: set[str] = set()
    assert autowatch._scan_once(seen) == []
    assert autowatch._scan_once(seen) == []  # marked seen despite failure


def test_status_masks_key_and_reports(monkeypatch):
    monkeypatch.setattr(config, "WATCH_DIRS", ["/data/watch"])
    monkeypatch.setattr(config, "WATCH_POLL_SEC", 20)
    monkeypatch.setattr(config, "FACEIT_API_KEY", "secret-key")
    monkeypatch.setattr(config, "FACEIT_PLAYER_ID", "f0e1d2c3-1111-2222-3333-444455556666")

    st = autowatch.status()
    assert st["watch"] == {"enabled": True, "dirs": ["/data/watch"], "pollSec": 20}
    assert st["faceit"]["enabled"] is True
    assert st["faceit"]["playerId"].startswith("f0e1d2")
    assert "secret-key" not in json.dumps(st)

    monkeypatch.setattr(config, "WATCH_DIRS", [])
    monkeypatch.setattr(config, "FACEIT_API_KEY", "")
    monkeypatch.setattr(config, "FACEIT_PLAYER_ID", "")
    st = autowatch.status()
    assert st["watch"]["enabled"] is False
    assert st["faceit"]["enabled"] is False
    assert st["faceit"]["knownMatches"] >= 0
