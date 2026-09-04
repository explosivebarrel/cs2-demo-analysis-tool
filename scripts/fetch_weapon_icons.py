"""One-time fetch of CS2 weapon/equipment SVG icons into frontend/public/icons/weapons/.

Source: https://github.com/Juknum/counter-strike-icons (auto-extracted from the
game files; Valve IP — community/educational use, matches this project's
non-commercial scope). Icon file names match weapons.py canon keys.

Usage: .venv/Scripts/python scripts/fetch_weapon_icons.py
"""
import os
import sys
import urllib.request

BASE = "https://raw.githubusercontent.com/Juknum/counter-strike-icons/main"
TREE_API = "https://api.github.com/repos/Juknum/counter-strike-icons/git/trees/main?recursive=1"
PREFIX = "cs2/panorama/images/icons/equipment/"
OUT = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "icons", "weapons")

# extras outside equipment/: kill modifiers and white UI icons (bomb/helmet/defuser)
EXTRA = [
    "cs2/panorama/images/hud/deathnotice/icon_headshot.svg",
    "cs2/panorama/images/icons/ui/bomb_c4.svg",
    "cs2/panorama/images/icons/ui/helmet.svg",
    "cs2/panorama/images/icons/ui/defuser_white.svg",
]


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    with urllib.request.urlopen(TREE_API, timeout=30) as r:
        import json
        tree = json.load(r).get("tree", [])
    all_paths = {t["path"] for t in tree}
    jobs = [(t["path"], t["path"][len(PREFIX):]) for t in tree
            if t["path"].startswith(PREFIX) and t["path"].endswith(".svg")]
    for p in EXTRA:
        if p in all_paths:
            jobs.append((p, p.rsplit("/", 1)[-1]))
    if not jobs:
        print("no icons found in repo tree")
        return 1
    done = skipped = 0
    for rel, name in jobs:
        dest = os.path.join(OUT, name)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            skipped += 1
            continue
        url = f"{BASE}/{rel}"
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                data = r.read()
            with open(dest, "wb") as f:
                f.write(data)
            done += 1
        except OSError as e:
            print(f"  ! {name}: {e}")
    print(f"icons: {done} fetched, {skipped} already present -> {os.path.abspath(OUT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
