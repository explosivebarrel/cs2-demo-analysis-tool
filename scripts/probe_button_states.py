"""Probe button_states prop: bit frequencies and correlation with movement.

Usage: .venv/Scripts/python scripts/probe_button_states.py <demo path>
"""
import sys

import numpy as np
from demoparser2 import DemoParser

path = sys.argv[1]
p = DemoParser(path)

# a mid-match window of ticks at full rate
df = p.parse_ticks(
    ["X", "Y", "yaw", "button_states", "is_walking", "duck_amount", "velocity_X", "velocity_Y", "is_alive"],
    ticks=list(range(60000, 63000)),
)
df = df.reset_index() if df.index.name or "tick" not in df.columns else df
print("columns:", list(df.columns))

bs = df["button_states"]
print("dtype:", bs.dtype, "unique sample:", bs.dropna().unique()[:10])

vals = bs.fillna(0).astype("int64").to_numpy()
yaw = df["yaw"].fillna(0).to_numpy(dtype="float64")
vx = df["velocity_X"].fillna(0).to_numpy(dtype="float64")
vy = df["velocity_Y"].fillna(0).to_numpy(dtype="float64")
walk = df["is_walking"].fillna(False).astype(bool).to_numpy()
duck = df["duck_amount"].fillna(0).to_numpy(dtype="float64")
alive = df["is_alive"].fillna(False).astype(bool).to_numpy()

speed = np.hypot(vx, vy)
moving = alive & (speed > 50)

# movement direction relative to view yaw: CS world yaw vs velocity vector angle
ang = np.degrees(np.arctan2(-vy, vx))          # screen-style angle (y down)
rel = (ang - (-yaw)) % 360                      # yaw uses dy=-sin(yaw) convention

names = {
    0: "ATTACK", 1: "JUMP", 2: "DUCK", 3: "FORWARD", 4: "BACK", 5: "USE",
    9: "MOVELEFT", 10: "MOVERIGHT", 17: "SPEED?", 18: "WALK?", 19: "ZOOM?",
}
print(f"\nalive rows: {alive.sum()}, moving rows: {moving.sum()}, walk rows: {walk.sum()}, duck>0.3: {(duck > 0.3).sum()}")
print(f"{'bit':>4} {'name':<10} {'freq%':>7} {'fwd+bit':>8} {'back+bit':>9} {'left+bit':>9} {'right+bit':>10} {'walk+bit':>9} {'duck+bit':>9}")
for bit in range(24):
    mask = (vals >> bit) & 1 == 1
    if mask.sum() == 0:
        continue
    freq = mask.mean() * 100
    fwd = (mask & moving & (rel > 315) | (mask & moving & (rel < 45))).mean() * 100 if True else 0
    # conditional P(direction | bit set)
    mm = mask & moving
    fwd = (((rel[mm] > 315) | (rel[mm] < 45)).mean() * 100) if mm.sum() else 0
    back = (((rel[mm] > 135) & (rel[mm] < 225)).mean() * 100) if mm.sum() else 0
    left = (((rel[mm] > 45) & (rel[mm] < 135)).mean() * 100) if mm.sum() else 0
    right = (((rel[mm] > 225) & (rel[mm] < 315)).mean() * 100) if mm.sum() else 0
    wlk = (walk[mask].mean() * 100) if mask.sum() else 0
    dck = ((duck[mask] > 0.3).mean() * 100) if mask.sum() else 0
    print(f"{bit:>4} {names.get(bit, ''):<10} {freq:>6.1f} {fwd:>7.1f} {back:>8.1f} {left:>8.1f} {right:>9.1f} {wlk:>8.1f} {dck:>8.1f}")

# sample of raw values while a player is moving forward-ish
print("\nraw samples (alive, speed>100):")
sub = df[moving][["name", "tick", "button_states", "is_walking", "duck_amount"]].head(12)
print(sub.to_string())
