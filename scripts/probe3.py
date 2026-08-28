"""Probe event fields and tick props."""
import sys
import pandas as pd
pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 50)

DEMO = "demo-examples/1-9799583b-608f-4fb7-b8c1-c066c24f2259-1-1.dem"
parser = DemoParser(DEMO) if False else None
from demoparser2 import DemoParser
parser = DemoParser(DEMO)

def show(title, df, n=3):
    print(f"\n=== {title} ===")
    if isinstance(df, list) and df and isinstance(df[0], tuple):
        df = df[0][1]
    if isinstance(df, tuple):
        df = df[1]
    if df is None:
        print("None"); return
    print("cols:", list(df.columns))
    print(df.head(n))

# 1) player_death with player props
try:
    df = parser.parse_events(["player_death"], player=["X", "Y", "Z", "health", "active_weapon_name"])
    show("player_death", df)
except Exception as e:
    print("player_death ERR:", e)

# 2) weapon_fire
try:
    df = parser.parse_events(["weapon_fire"], player=["X", "Y", "Z", "active_weapon_name"])
    show("weapon_fire", df, 2)
except Exception as e:
    print("weapon_fire ERR:", e)

# 3) player_blind
try:
    df = parser.parse_events(["player_blind"], player=["X", "Y"])
    show("player_blind", df, 2)
except Exception as e:
    print("player_blind ERR:", e)

# 4) grenade detonations
for ev in ["smokegrenade_detonate", "inferno_startburn", "hegrenade_detonate", "flashbang_detonate"]:
    try:
        df = parser.parse_events([ev])
        show(ev, df, 2)
    except Exception as e:
        print(ev, "ERR:", e)

# 5) fire_bullets
try:
    df = parser.parse_events(["fire_bullets"])
    show("fire_bullets", df, 2)
except Exception as e:
    print("fire_bullets ERR:", e)

# 6) bomb events
for ev in ["bomb_planted", "bomb_begindefuse", "bomb_dropped"]:
    try:
        df = parser.parse_events([ev])
        show(ev, df, 2)
    except Exception as e:
        print(ev, "ERR:", e)
