from app.weapons import canon, inventory_keys, weapon_id, weapon_id_table


def test_canon_known_weapons():
    assert canon("weapon_ak47") == ("AK-47", "АК-47", "rifle")
    assert canon("ak47") == ("AK-47", "АК-47", "rifle")
    assert canon("awp") == ("AWP", "AWP", "sniper")


def test_canon_display_style_names():
    assert canon("Glock-18") == ("Glock-18", "Глок", "pistol")
    assert canon("USP-S") == ("USP-S", "USP-S", "pistol")
    assert canon("M4A1-S") == ("M4A1-S", "M4A1-S", "rifle")
    assert canon("Dual Berettas") == ("Dual Berettas", "Беретты", "pistol")


def test_canon_knife_variants():
    en, ru, cls = canon("knife_t")
    assert cls == "knife"
    assert canon("knife_butterfly_fade")[2] == "knife"


def test_canon_fallbacks():
    assert canon(None) == ("?", "?", "other")
    assert canon("totally_unknown_thing")[2] == "other"


def test_weapon_id_stable():
    a = weapon_id("ak47")
    b = weapon_id("ak47")
    assert a == b
    table = weapon_id_table()
    assert table[a]["cls"] == "rifle"


def test_inventory_keys_display_names():
    # real display names from demoparser2 inventory prop
    assert inventory_keys(["AK-47", "USP-S", "Smoke Grenade"]) == ["ak47", "smokegrenade", "usp_s"]
    assert inventory_keys(["Gut Knife", "Glock-18", "C4 Explosive"]) == ["c4", "glock", "knife"]
    assert inventory_keys(["knife", "Dual Berettas", "Incendiary Grenade"]) == ["elite", "incgrenade", "knife"]
    assert inventory_keys(["Galil AR", "HE Grenade", "Kevlar Vest + Helmet"]) == ["galilar", "hegrenade", "kevlar_helmet"]
    assert inventory_keys(["Bayonet", "Flashbang", "Zeus x27"]) == ["bayonet", "flashbang", "taser"]


def test_inventory_keys_edge_cases():
    assert inventory_keys(None) == []
    assert inventory_keys([]) == []
    assert inventory_keys(["world", "", "totally_unknown_skin"]) == []
    assert inventory_keys(["Desert Eagle", "Five-SeveN", "R8 Revolver"]) == ["deagle", "fiveseven", "revolver"]
    assert inventory_keys(["M4A1-S", "SG 553", "PP-Bizon", "MAC-10"]) == ["bizon", "m4a1_silencer", "mac10", "sg556"]
