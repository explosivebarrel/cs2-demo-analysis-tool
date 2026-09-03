from app.weapons import canon, weapon_id, weapon_id_table


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
