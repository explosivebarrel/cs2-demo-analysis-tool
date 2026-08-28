"""Probe a demo file: header, available events, available props."""
import sys, json
from demoparser2 import DemoParser

DEMO = sys.argv[1] if len(sys.argv) > 1 else "demo-examples/1-9799583b-608f-4fb7-b8c1-c066c24f2259-1-1.dem"

parser = DemoParser(DEMO)

print("=== HEADER ===")
header = parser.parse_header()
print(json.dumps(header, indent=1, default=str))

print("=== LIST EVENTS ===")
try:
    evs = parser.list_events()
    print(evs)
except Exception as e:
    print("list_events failed:", e)
