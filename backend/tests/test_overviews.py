from app.overviews import parse_kv


def test_parse_kv_flat():
    text = '"pos_x" "-2950"\n"pos_y" "3400"\n"scale" "5.2"'
    kv = parse_kv(text)
    assert kv["pos_x"] == "-2950"
    assert kv["scale"] == "5.2"


def test_parse_kv_nested_sections():
    text = '''
    "verticalsections"
    {
        "lower"
        {
            "AltitudeMin" "-1000000"
            "AltitudeMax" "0"
        }
    }
    '''
    kv = parse_kv(text)
    lower = kv["verticalsections"]["lower"]
    assert lower["AltitudeMin"] == "-1000000"
    assert lower["AltitudeMax"] == "0"


def test_parse_kv_duplicate_keys_become_list():
    kv = parse_kv('"tag" "a"\n"tag" "b"')
    assert kv["tag"] == ["a", "b"]
