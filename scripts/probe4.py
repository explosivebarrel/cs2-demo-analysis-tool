"""Probe player_hurt, round events, item events, tick props, grenades."""
import pandas as pd
from demoparser2 import DemoParser
pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 60)

DEMO = "demo-examples/1-9799583b-608f-4fb7-b8c1-c066c24f2259-1-1.dem"
parser = DemoParser(DEMO)

def show(title, res, n=3):
    print(f"\n=== {title} ===")
    if isinstance(res, list) and res and isinstance(res[0], tuple):
        df = res[0][1]
    elif isinstance(res, tuple):
        df = res[1] if len(res) > 1 else res[0]
    else:
        df = res
    print("cols:", list(df.columns))
    print(df.head(n))

show("player_hurt", parser.parse_events(["player_hurt"], player=["X", "Y", "health", "armor_value"]))

for ev in ["round_freeze_end", "round_officially_ended", "round_prestart", "round_poststart",
           "begin_new_match", "buytime_ended", "cs_pre_restart", "item_equip", "item_pickup", "other_death"]:
    try:
        show(ev, parser.parse_events([ev]))
    except Exception as e:
        print(ev, "ERR:", e)

print("\n=== TICKS ===")
props = ["X", "Y", "Z", "pitch", "yaw", "health", "armor_value", "has_helmet", "has_defuser",
         "is_alive", "active_weapon_name", "cash", "cash_spend_this_round", "total_cash_spent",
         "team_name", "team_clan_name", "team_num", "game_phase", "is_freeze_period", "is_buy_period",
         "is_bomb_planted", "total_rounds_played", "game_time", "flash_duration", "inventory",
         "is_walking", "is_scoped", "duck_amount", "has_bomb", "kills", "deaths", "assists", "mvp"]
try:
    df = parser.parse_ticks(props, ticks=list(range(7000, 7060, 10)))
    print("cols:", list(df.columns))
    print(df.head(25).to_string())
except Exception as e:
    print("parse_ticks ERR:", e)

print("\n=== GRENADES ===")
try:
    g = parser.parse_grenades()
    if isinstance(g, tuple):
        g = g[0]
    print(type(g))
    print("cols:", list(g.columns))
    print(g.head(6).to_string())
except Exception as e:
    print("parse_grenades ERR:", e)
