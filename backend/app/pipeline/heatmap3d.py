"""3D voxel heatmap of player positions (ground-only samples).

Aggregates ctx.ticks (8 Hz, already downsampled) into sparse voxels:
32-unit cells in the horizontal plane, 32-unit vertical steps. Only samples
with the player alive and on the ground (is_airborne False) inside a
recognized round are counted — jumps/falls must not inflate positions.

Payload schema (heatmap3d.json.gz):
{
  "cell": 32.0,                      # horizontal cell size, world units
  "zStep": 32.0,                     # vertical step
  "minX": f, "minY": f, "minZ": f,   # index-space origin (world coords)
  "samples": N,                      # total accepted samples
  "players": [steamid, ...],         # count columns align with this order
  "cells": [[ix, iy, iz, c0, c1, ...], ...]   # lexicographically sorted
}
"""
import numpy as np

from app import config

CELL = config.HM3D_CELL
Z_STEP = config.HM3D_Z_STEP


def _empty(steamids):
    return {"cell": CELL, "zStep": Z_STEP, "minX": 0.0, "minY": 0.0, "minZ": 0.0,
            "samples": 0, "players": [str(s) for s in steamids], "cells": []}


def build_heatmap3d(ctx, rb, steamids):
    steamids = [str(s) for s in steamids]
    df = ctx.ticks
    if df is None or not len(df) or not len(rb.rounds) or not steamids:
        return _empty(steamids)

    need = {"tick", "steamid", "X", "Y", "Z", "is_alive", "is_airborne"}
    if not need.issubset(df.columns):
        raise ValueError(f"ticks missing columns for heatmap3d: {need - set(df.columns)}")

    sub = df[list(need)]
    sub = sub[sub["is_alive"].fillna(False).astype(bool)]
    # unknown ground state is treated as airborne: positions must be ground-only
    sub = sub[~sub["is_airborne"].fillna(True).astype(bool)]
    sub = sub[sub["steamid"].astype(str).isin(set(steamids))]
    if not len(sub):
        return _empty(steamids)

    t = sub["tick"].to_numpy(dtype="int64")
    fe = np.array([r["freezeEndTick"] for r in rb.rounds], dtype="int64")
    en = np.array([r["endTick"] for r in rb.rounds], dtype="int64")
    ri = np.searchsorted(fe, t, side="right") - 1
    ok = ri >= 0
    ok[ok] = t[ok] <= en[ri[ok]]
    if not ok.any():
        return _empty(steamids)
    sub = sub.iloc[np.nonzero(ok)[0]]

    xs = sub["X"].to_numpy(dtype="float64")
    ys = sub["Y"].to_numpy(dtype="float64")
    zs = sub["Z"].to_numpy(dtype="float64")
    finite = np.isfinite(xs) & np.isfinite(ys) & np.isfinite(zs)
    if not finite.all():
        xs, ys, zs = xs[finite], ys[finite], zs[finite]
    if not len(xs):
        return _empty(steamids)

    col = {s: i for i, s in enumerate(steamids)}
    pcol = sub["steamid"].astype(str).map(col).to_numpy(dtype="int64")

    minx, miny, minz = float(xs.min()), float(ys.min()), float(zs.min())
    ix = np.floor((xs - minx) / CELL).astype("int64")
    iy = np.floor((ys - miny) / CELL).astype("int64")
    iz = np.floor((zs - minz) / Z_STEP).astype("int64")

    keys = np.stack([ix, iy, iz, pcol], axis=1)
    uniq, counts = np.unique(keys, axis=0, return_counts=True)

    n = len(steamids)
    cells: dict[tuple, list] = {}
    for (a, b, c, pi), cnt in zip(uniq.tolist(), counts.tolist()):
        row = cells.setdefault((a, b, c), [0] * n)
        row[pi] = int(cnt)

    return {
        "cell": CELL, "zStep": Z_STEP,
        "minX": round(minx, 1), "minY": round(miny, 1), "minZ": round(minz, 1),
        "samples": int(counts.sum()),
        "players": steamids,
        "cells": [[k[0], k[1], k[2], *v] for k, v in sorted(cells.items())],
    }
