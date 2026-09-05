"""Watch-folder scan + import plumbing (no network)."""
import json
import os
import time

from app import autowatch, config, settings, suggestions


def _make_watch_dir(tmp_path, monkeypatch):
    d = tmp_path / "watch"
    d.mkdir()
    monkeypatch.setattr(config, "WATCH_DIRS", [str(d)])
    monkeypatch.setattr(suggestions, "PATH", str(tmp_path / "suggestions.json"))
    return d


def _scan(seen, dirs):
    # cutoff an hour back: everything settled counts as inside the window
    return autowatch._scan_once(seen, dirs, time.time() - 3600, set())


def _settle(path):
    old = time.time() - autowatch.FRESH_SEC - 5
    os.utime(path, (old, old))


def test_seed_ignores_non_demos(tmp_path, monkeypatch):
    d = _make_watch_dir(tmp_path, monkeypatch)
    (d / "a.dem").write_bytes(b"\xde\xad")
    (d / "b.txt").write_bytes(b"nope")

    seen = set(autowatch._iter_watch_files([str(d)]))
    assert len(seen) == 1
    assert _scan(seen, [str(d)]) == []  # nothing new afterwards


def test_scan_imports_new_file(tmp_path, monkeypatch):
    d = _make_watch_dir(tmp_path, monkeypatch)
    dirs = [str(d)]
    seen = set(autowatch._iter_watch_files(dirs))

    demo = d / "new.dem"
    demo.write_bytes(b"\x00" * 16)
    _settle(demo)

    imported = _scan(seen, dirs)
    assert len(imported) == 1
    did = imported[0]
    assert os.path.exists(os.path.join(config.UPLOADS_DIR, did + ".dem"))
    meta = json.load(open(os.path.join(config.UPLOADS_DIR, did + ".dem.name"),
                          encoding="utf-8"))
    assert meta["origin"] == "watch"

    # fresh file (still copying) is postponed, not lost
    fresh = d / "fresh.dem"
    fresh.write_bytes(b"\x00" * 16)
    assert _scan(seen, dirs) == []
    assert str(fresh) not in seen
    _settle(fresh)
    assert len(_scan(seen, dirs)) == 1


def test_import_failure_not_retried(tmp_path, monkeypatch):
    d = _make_watch_dir(tmp_path, monkeypatch)
    (d / "bad.zst").write_bytes(b"not-zstd")
    _settle(d / "bad.zst")
    dirs = [str(d)]
    seen: set[str] = set()
    assert _scan(seen, dirs) == []
    assert _scan(seen, dirs) == []  # marked seen despite failure


def test_status_masks_key_and_reports(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "FILE", str(tmp_path / "settings.json"))
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


def test_settings_override_env(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "FILE", str(tmp_path / "settings.json"))
    monkeypatch.setattr(config, "WATCH_DIRS", [])
    monkeypatch.setattr(config, "WATCH_POLL_SEC", 20)
    monkeypatch.setattr(config, "FACEIT_API_KEY", "")
    monkeypatch.setattr(config, "FACEIT_PLAYER_ID", "")

    eff = settings.effective()
    assert eff["watch"]["dirs"] == []
    assert eff["faceit"]["apiKey"] == ""

    settings.write({
        "watch": {"dirs": ["/watch"], "pollSec": 60},
        "faceit": {"apiKey": " k ", "playerId": "pid", "pollSec": 900},
    })
    eff = settings.effective()
    assert eff["watch"]["dirs"] == ["/watch"]
    assert eff["watch"]["pollSec"] == 60
    assert eff["faceit"]["apiKey"] == "k"  # stripped, overrides env
    assert eff["faceit"]["pollSec"] == 900

    # invalid patches rejected without touching the file
    for bad in ({"watch": {"dirs": "not-a-list"}}, {"faceit": {"pollSec": 999999}}):
        try:
            settings.write(bad)
            raise AssertionError("expected ValueError")
        except ValueError:
            pass
    assert settings.effective()["watch"]["dirs"] == ["/watch"]
    assert settings.effective()["faceit"]["pollSec"] == 900
