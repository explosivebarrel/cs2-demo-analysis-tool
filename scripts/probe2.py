"""Probe events: list_game_events + sample of key events."""
import sys, json
from demoparser2 import DemoParser

DEMO = sys.argv[1] if len(sys.argv) > 1 else "demo-examples/1-9799583b-608f-4fb7-b8c1-c066c24f2259-1-1.dem"
parser = DemoParser(DEMO)

names = parser.list_game_events()
print("=== EVENT NAMES ===")
try:
    print(sorted(set(names.to_pandas()["event_name"]) if hasattr(names, "to_pandas") else set(names)))
except Exception as e:
    print("fallback:", e, type(names))
    print(names)
