"""Map overviews: radar images + coordinate reference, downloaded & cached."""
import io
import json
import os
import re
import struct
import urllib.request
import zlib

from . import config


class OverviewError(Exception):
    pass


def _kv_tokenize(text: str):
    for m in re.finditer(r'"([^"]*)"|([{}])|([^\s{}"]+)', text):
        if m.group(1) is not None:
            yield ("str", m.group(1))
        elif m.group(2):
            yield ("brace", m.group(2))
        else:
            yield ("str", m.group(3))


def parse_kv(text: str) -> dict:
    """Parse Valve KeyValues (overview .txt) into a nested dict.

    Repeated keys are folded into lists."""
    root: dict = {}
    stack = [root]
    key = None
    for kind, val in _kv_tokenize(text):
        top = stack[-1]
        if kind == "brace":
            if val == "{":
                child: dict = {}
                if key is None:
                    stack[-1] = child
                    continue
                top.setdefault(key, child)
                stack.append(child)
                key = None
            else:
                if len(stack) > 1:
                    stack.pop()
                key = None
        else:
            if key is None:
                key = val
            else:
                if key in top:
                    prev = top[key]
                    if isinstance(prev, list):
                        prev.append(val)
                    else:
                        top[key] = [prev, val]
                else:
                    top[key] = val
                key = None
    return root


def _num(v, default=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _png_size(data: bytes):
    if len(data) > 33 and data[:8] == b"\x89PNG\r\n\x1a\n":
        w, h = struct.unpack(">II", data[16:24])
        return w, h
    return None, None


def _placeholder_png(w=1024, h=1024) -> bytes:
    """Dark grid PNG used when the real radar cannot be fetched."""
    rows = []
    for y in range(h):
        row = bytearray(b"\x18\x1c\x24\xff") * w
        if y % 128 == 0:
            row = bytearray(b"\x2a\x33\x44\xff") * w
        rows.append(bytes(row))
    # horizontal lines done; add vertical lines per row copy
    lines = []
    for y in range(h):
        row = bytearray(rows[y])
        if y % 128 == 0:
            for x in range(0, w, 128):
                row[x * 4:x * 4 + 4] = b"\x2a\x33\x44\xff"
        lines.append(bytes(row))
    raw = b"".join(b"\x00" + r for r in lines)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def _download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "cs2-demo-analyzer/1.0"})
    with urllib.request.urlopen(req, timeout=config.RADAR_FETCH_TIMEOUT) as r:
        return r.read()


def load_overview(map_name: str) -> dict:
    """Overview dict with pos_x/pos_y/scale/verticalsections + image size.

    Cached as JSON next to the radar png; falls back to a rough default so the
    UI keeps working offline (isDefault=true)."""
    cache = os.path.join(config.RADARS_DIR, f"{map_name}.overview.json")
    if os.path.exists(cache):
        try:
            with open(cache, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass

    ov = {"map": map_name, "isDefault": True, "rotate": 0,
          "pos_x": -2950.0, "pos_y": 3400.0, "scale": 5.2, "verticalsections": {}}
    try:
        txt = _download(config.RADAR_INFO_URL.format(map=map_name)).decode("utf-8", "replace")
        kv = parse_kv(txt)
        px, py, sc = _num(kv.get("pos_x")), _num(kv.get("pos_y")), _num(kv.get("scale"))
        if px is not None:
            ov["pos_x"] = px
        if py is not None:
            ov["pos_y"] = py
        if sc:
            ov["scale"] = sc
        rot = _num(kv.get("rotation"), 0) or _num(kv.get("rotate"), 0) or 0
        ov["rotate"] = rot
        vs = kv.get("verticalsections")
        if isinstance(vs, dict):
            sections = {}
            for name, sec in vs.items():
                if not isinstance(sec, dict):
                    continue
                sections[name] = {
                    "altitudeMin": _num(sec.get("AltitudeMin"), -1e9),
                    "altitudeMax": _num(sec.get("AltitudeMax"), 1e9),
                    "pos_x": _num(sec.get("pos_x"), ov["pos_x"]),
                    "pos_y": _num(sec.get("pos_y"), ov["pos_y"]),
                    "scale": _num(sec.get("scale"), ov["scale"]),
                }
            ov["verticalsections"] = sections
        ov["isDefault"] = False
    except Exception as e:  # noqa: BLE001 - offline must not 500
        ov["fetchError"] = str(e)

    img = os.path.join(config.RADARS_DIR, f"{map_name}_radar.png")
    if not os.path.exists(img):
        try:
            data = _download(config.RADAR_IMG_URL.format(map=map_name))
            with open(img, "wb") as f:
                f.write(data)
        except Exception as e:  # noqa: BLE001
            ov["radarError"] = str(e)
            with open(img, "wb") as f:
                f.write(_placeholder_png())
    if os.path.exists(img):
        with open(img, "rb") as f:
            w, h = _png_size(f.read(33))
        ov["imgW"], ov["imgH"] = w or 1024, h or 1024
        # overview pos/scale refer to the 1024x1024 classic radar
        ov["imgScale"] = (ov["imgW"] / 1024.0) if ov["imgW"] else 1.0
    else:
        ov["imgW"], ov["imgH"], ov["imgScale"] = 1024, 1024, 1.0

    with open(cache, "w", encoding="utf-8") as f:
        json.dump(ov, f)
    return ov


def radar_png_path(map_name: str) -> str:
    load_overview(map_name)  # ensures fetch/cache
    return os.path.join(config.RADARS_DIR, f"{map_name}_radar.png")


def world_to_pixels(x: float, y: float, z: float, ov: dict):
    """World coords -> radar pixel coords using overview reference."""
    sec = None
    zs = ov.get("verticalsections") or {}
    for name, s in zs.items():
        mn, mx = s.get("altitudeMin", -1e9), s.get("altitudeMax", 1e9)
        if mn <= z <= mx:
            sec = s
            break
    px_ref, py_ref, scale = ov.get("pos_x", -2950), ov.get("pos_y", 3400), ov.get("scale", 5.2)
    if sec:
        px_ref, py_ref, scale = sec.get("pos_x", px_ref), sec.get("pos_y", py_ref), sec.get("scale", scale)
    k = ov.get("imgScale", 1.0)
    if ov.get("rotate"):
        px = ((py_ref - y) / scale) * k
        py = ((x - px_ref) / scale) * k
    else:
        px = ((x - px_ref) / scale) * k
        py = ((py_ref - y) / scale) * k
    return px, py


def overview_for_client(map_name: str) -> dict:
    ov = load_overview(map_name)
    out = dict(ov)
    out["availableLevels"] = ["default"] + list((ov.get("verticalsections") or {}).keys())
    return out
