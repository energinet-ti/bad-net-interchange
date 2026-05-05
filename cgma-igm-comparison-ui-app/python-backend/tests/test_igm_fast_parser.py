import os

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def test_parse_eq_extracts_control_areas():
    from app.igm_fast_parser import parse_eq

    with open(os.path.join(FIXTURES, "eq_example.xml")) as f:
        records = parse_eq(f.read())

    # The fixture has at least DK1 and FLE control areas
    by_name = {r.name: r for r in records}
    assert "DK1" in by_name
    assert by_name["DK1"].energy_ident_code_eic == "10YDK-1--------W"
    assert by_name["DK1"].control_area_id == "_892742b0-6e0a-4207-b457-b534b1f53a9c"


def test_parse_eq_returns_all_control_areas():
    from app.igm_fast_parser import parse_eq

    with open(os.path.join(FIXTURES, "eq_example.xml")) as f:
        records = parse_eq(f.read())

    # Should have at least 2 control areas (DK1, FLE)
    assert len(records) >= 2
    # Each record has all fields populated
    for r in records:
        assert r.control_area_id
        assert r.energy_ident_code_eic
        assert r.name


def test_parse_ssh_extracts_scenario_and_interchange():
    from app.igm_fast_parser import parse_ssh

    with open(os.path.join(FIXTURES, "ssh_example.xml")) as f:
        records = parse_ssh(f.read())

    assert len(records) >= 1
    # Find the DK1 control area record
    dk1 = [r for r in records if r.control_area_id == "_892742b0-6e0a-4207-b457-b534b1f53a9c"]
    assert len(dk1) == 1
    assert dk1[0].scenario_time == "2026-03-05T00:30:00Z"
    assert dk1[0].net_interchange > 900.0


def test_parse_ssh_control_area_ids_match_eq():
    """SSH control_area_ids should match EQ control_area_ids for joining."""
    from app.igm_fast_parser import parse_eq, parse_ssh

    with open(os.path.join(FIXTURES, "eq_example.xml")) as f:
        eq_records = parse_eq(f.read())
    with open(os.path.join(FIXTURES, "ssh_example.xml")) as f:
        ssh_records = parse_ssh(f.read())

    eq_ids = {r.control_area_id for r in eq_records}
    ssh_ids = {r.control_area_id for r in ssh_records}
    # There should be overlap (both reference the same ControlAreas)
    assert eq_ids & ssh_ids, "EQ and SSH should share at least one ControlArea ID"


def test_parse_ssh_stamps_version_when_given():
    from app.igm_fast_parser import parse_ssh

    with open(os.path.join(FIXTURES, "ssh_example.xml")) as f:
        records = parse_ssh(f.read(), ssh_version="003")

    assert len(records) >= 1
    for r in records:
        assert r.ssh_version == "003"


def test_parse_ssh_default_version_empty_string():
    from app.igm_fast_parser import parse_ssh

    with open(os.path.join(FIXTURES, "ssh_example.xml")) as f:
        records = parse_ssh(f.read())

    for r in records:
        assert r.ssh_version == ""
