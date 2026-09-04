"""Weapon name normalization: raw demo names -> canonical id / labels / class."""

# raw name (lowercase, demo uses mixed styles) -> (en label, ru label, class)
_WEAPON_TABLE = {
    # rifles
    "ak47": ("AK-47", "АК-47", "rifle"),
    "m4a4": ("M4A4", "M4A4", "rifle"),
    "m4a1": ("M4A1", "M4A1", "rifle"),
    "m4a1_silencer": ("M4A1-S", "M4A1-S", "rifle"),
    "galilar": ("Galil AR", "Галил", "rifle"),
    "famas": ("FAMAS", "ФАМАС", "rifle"),
    "sg556": ("SG 553", "SG 553", "rifle"),
    "aug": ("AUG", "AUG", "rifle"),
    # snipers
    "awp": ("AWP", "AWP", "sniper"),
    "ssg08": ("SSG 08", "Скаут", "sniper"),
    "scar20": ("SCAR-20", "SCAR-20", "sniper"),
    "g3sg1": ("G3SG1", "G3SG1", "sniper"),
    # smg
    "mp9": ("MP9", "MP9", "smg"),
    "mac10": ("MAC-10", "MAC-10", "smg"),
    "mp7": ("MP7", "MP7", "smg"),
    "ump45": ("UMP-45", "UMP-45", "smg"),
    "p90": ("P90", "P90", "smg"),
    "bizon": ("PP-Bizon", "Бизон", "smg"),
    "mp5sd": ("MP5-SD", "MP5-SD", "smg"),
    # heavy
    "nova": ("Nova", "Нова", "heavy"),
    "xm1014": ("XM1014", "XM1014", "heavy"),
    "mag7": ("MAG-7", "MAG-7", "heavy"),
    "m249": ("M249", "M249", "heavy"),
    "negev": ("Negev", "Негев", "heavy"),
    # pistols
    "glock": ("Glock-18", "Глок", "pistol"),
    "glock18": ("Glock-18", "Глок", "pistol"),
    "usp": ("USP-S", "USP-S", "pistol"),
    "usp_s": ("USP-S", "USP-S", "pistol"),
    "usp_silencer": ("USP-S", "USP-S", "pistol"),
    "hkp2000": ("P2000", "P2000", "pistol"),
    "p2000": ("P2000", "P2000", "pistol"),
    "p250": ("P250", "P250", "pistol"),
    "fiveseven": ("Five-SeveN", "Five-SeveN", "pistol"),
    "cz75a": ("CZ75-Auto", "CZ75", "pistol"),
    "tec9": ("Tec-9", "Тек-9", "pistol"),
    "deagle": ("Desert Eagle", "Deagle", "pistol"),
    "revolver": ("R8 Revolver", "R8", "pistol"),
    "elite": ("Dual Berettas", "Беретты", "pistol"),
    "dual_berettas": ("Dual Berettas", "Беретты", "pistol"),
    "elite_knife": ("Dual Berettas", "Беретты", "pistol"),
    # grenades
    "flashbang": ("Flashbang", "Флешка", "grenade"),
    "smokegrenade": ("Smoke", "Смок", "grenade"),
    "hegrenade": ("HE Grenade", "Граната", "grenade"),
    "molotov": ("Molotov", "Молотов", "grenade"),
    "incgrenade": ("Incendiary", "Зажигательная", "grenade"),
    "decoy": ("Decoy", "Ловушка", "grenade"),
    "inferno": ("Fire", "Огонь", "grenade"),
    "molotov_fire": ("Fire", "Огонь", "grenade"),
    # gear / bomb
    "c4": ("C4", "Бомба", "gear"),
    "knife": ("Knife", "Нож", "knife"),
    "knife_t": ("Knife", "Нож", "knife"),
    "knife_default": ("Knife", "Нож", "knife"),
    "bayonet": ("Bayonet", "Штык-нож", "knife"),
    "taser": ("Zeus x27", "Зевс", "gear"),
    "healthshot": ("Medi-Shot", "Мед-шот", "gear"),
    "kevlar": ("Kevlar", "Кевлар", "gear"),
    "kevlar_helmet": ("Kevlar+Helmet", "Кевлар+шлем", "gear"),
    "defuser": ("Defuse Kit", "Кит", "gear"),
}

_CLASS_ORDER = {"rifle": 0, "sniper": 1, "smg": 2, "heavy": 3, "pistol": 4,
                "grenade": 5, "gear": 6, "knife": 7}

# slug variants produced by display-style names ("Glock-18", "USP-S", ...)
_SLUG_ALIASES = {
    "glock18": "glock", "usps": "usp_s", "m4a1s": "m4a1_silencer",
    "dualberettas": "elite", "ppbizon": "bizon", "sg553": "sg556",
    "r8revolver": "revolver", "deserteagle": "deagle", "zeusx27": "taser",
    "fivesevenn": "fiveseven", "m4a1sir": "m4a1_silencer",
}

# inventory display-name ("AK-47", "C4 Explosive", ...) extras the slug table misses
_INVENTORY_ALIASES = {
    "c4": "c4", "c4 explosive": "c4",
    "smoke grenade": "smokegrenade",
    "he grenade": "hegrenade", "high explosive grenade": "hegrenade",
    "incendiary grenade": "incgrenade", "incendiary": "incgrenade",
    "decoy grenade": "decoy",
    "kevlar vest": "kevlar", "kevlar vest + helmet": "kevlar_helmet",
    "defuse kit": "defuser",
}

_WEAPON_ID = {}


def _slug(raw: str) -> str:
    return "".join(c for c in raw.lower() if c.isalnum())


def inventory_keys(names) -> list[str]:
    """Inventory display-name list -> sorted canonical id list (stable for diffing)."""
    out = set()
    for name in names if isinstance(names, (list, tuple)) else []:
        low = str(name).strip().lower()
        if not low or low == "world":
            continue
        if low in _INVENTORY_ALIASES:
            out.add(_INVENTORY_ALIASES[low])
            continue
        slug = _slug(low)
        if slug in _SLUG_ALIASES:
            slug = _SLUG_ALIASES[slug]
        if slug in _WEAPON_TABLE:
            out.add(slug)
        elif "knife" in low:
            out.add("knife")
    return sorted(out)


def _canon_key(raw: str) -> str:
    """Canon table key for a raw weapon name ('AK-47'/'weapon_ak47' -> 'ak47')."""
    if not raw:
        return "?"
    key = str(raw).strip()
    if key.startswith("weapon_"):
        key = key[7:]
    low = key.lower()
    if low in _WEAPON_TABLE:
        return low
    slug = _slug(key)
    if slug in _SLUG_ALIASES:
        low = _SLUG_ALIASES[slug]
        if low in _WEAPON_TABLE:
            return low
    if slug in _WEAPON_TABLE:
        return slug
    if "knife" in low:
        return "knife"
    if low.endswith("_t") and low[:-2] in _WEAPON_TABLE:
        return low[:-2]
    return low


def canon(raw: str):
    """Return (en, ru, cls) for a raw weapon name; fallback -> (raw, raw, 'other')."""
    key = _canon_key(raw)
    if key in _WEAPON_TABLE:
        return _WEAPON_TABLE[key]
    if not raw:
        return ("?", "?", "other")
    return (raw, raw, "other")


def weapon_id(raw: str) -> int:
    """Stable small integer id for a raw weapon name (per-process)."""
    key = str(raw) if raw else "?"
    if key not in _WEAPON_ID:
        _WEAPON_ID[key] = len(_WEAPON_ID)
    return _WEAPON_ID[key]


def weapon_id_table():
    """id -> canonical info for all ids issued so far."""
    out = {}
    for raw, wid in _WEAPON_ID.items():
        en, ru, cls = canon(raw)
        out[wid] = {"raw": raw, "key": _canon_key(raw), "en": en, "ru": ru, "cls": cls}
    return out


def inventory_table() -> dict:
    """Canon inventory id -> {en, ru, cls}; the full closed set inventory_keys() can emit."""
    return {key: {"en": en, "ru": ru, "cls": cls}
            for key, (en, ru, cls) in _WEAPON_TABLE.items()}


def class_order(cls: str) -> int:
    return _CLASS_ORDER.get(cls, 8)
