import os
import logging
from app.graph_store import GraphStore
from app.igm_parser import load_igm_file
from app.cgma_parser import load_cgma_file
from app.query import run_comparison_query, truncate_to_hour, cgma_timestamp, _join_results, _aggregate_cgma

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def test_truncate_to_hour():
    assert truncate_to_hour("2026-03-05T00:30:00Z") == "2026-03-05T00:00:00Z"
    assert truncate_to_hour("2026-03-05T14:30:00Z") == "2026-03-05T14:00:00Z"


def test_cgma_timestamp_pt1h():
    # position is 1-indexed: position 1 = interval starting at periodStart
    assert cgma_timestamp("2026-03-04T23:00Z", 1, "PT1H") == "2026-03-04T23:00:00Z"
    assert cgma_timestamp("2026-03-04T23:00Z", 10, "PT1H") == "2026-03-05T08:00:00Z"


def test_cgma_timestamp_with_seconds():
    assert cgma_timestamp("2026-03-04T23:00:00Z", 1, "PT1H") == "2026-03-04T23:00:00Z"


def test_cgma_timestamp_summer_time():
    # Summer: period starts at 22:00Z (midnight CEST)
    assert cgma_timestamp("2026-04-13T22:00Z", 1, "PT1H") == "2026-04-13T22:00:00Z"
    assert cgma_timestamp("2026-04-13T22:00Z", 3, "PT1H") == "2026-04-14T00:00:00Z"


def test_cgma_timestamp_winter_time():
    # Winter: period starts at 23:00Z (midnight CET)
    assert cgma_timestamp("2026-03-16T23:00Z", 1, "PT1H") == "2026-03-16T23:00:00Z"
    assert cgma_timestamp("2026-03-16T23:00Z", 2, "PT1H") == "2026-03-17T00:00:00Z"


def test_join_direct_match_only():
    """Only rows where IGM and CGMA share the same (EIC, hour) are joined.

    CGMA timestamps are computed from periodStart + (position-1) * resolution,
    so they naturally span across day boundaries. No D-1 fallback needed.
    """
    igm_rows = [
        {"scenarioTime": "2026-03-05T22:30:00Z", "energyIdentCodeEic": "10YDK-1--------W", "name": "DK1", "netInterchange": 100.0},
        {"scenarioTime": "2026-03-05T23:30:00Z", "energyIdentCodeEic": "10YDK-1--------W", "name": "DK1", "netInterchange": 200.0},
    ]
    # CGMA period starts at 23:00 D-1; position 1 = 23:00 D-1, position 24 = 22:00 D
    # cgma_timestamp("2026-03-04T23:00Z", 1, "PT1H") = "2026-03-04T23:00:00Z"
    # cgma_timestamp("2026-03-04T23:00Z", 24, "PT1H") = "2026-03-05T22:00:00Z"
    cgma_rows = [
        {"eic": "10YDK-1--------W", "periodStart": "2026-03-04T23:00Z", "resolution": "PT1H",
         "position": 1, "quantity": 50.0, "isImport": True, "measurementUnit": "MAW", "businessType": "B65"},
        {"eic": "10YDK-1--------W", "periodStart": "2026-03-04T23:00Z", "resolution": "PT1H",
         "position": 24, "quantity": 80.0, "isImport": True, "measurementUnit": "MAW", "businessType": "B65"},
    ]
    cgma_map = _aggregate_cgma(cgma_rows)
    result = _join_results(igm_rows, cgma_map)

    # pos 24 -> 2026-03-05T22:00:00Z matches IGM 22:30 (truncated to 22:00)
    # pos 1  -> 2026-03-04T23:00:00Z does NOT match IGM 23:30 (truncated to 2026-03-05T23:00:00Z)
    assert len(result) == 1, f"Expected 1 direct match but got {len(result)}"
    assert result[0]["scenarioTime"] == "2026-03-05T22:30:00Z"


def test_join_direct_match_summer_time():
    """Summer time: CGMA starts at 22:00 D-1. Only direct timestamp matches join."""
    igm_rows = [
        {"scenarioTime": "2026-04-14T21:30:00Z", "energyIdentCodeEic": "10YDK-1--------W", "name": "DK1", "netInterchange": 100.0},
        {"scenarioTime": "2026-04-14T22:30:00Z", "energyIdentCodeEic": "10YDK-1--------W", "name": "DK1", "netInterchange": 200.0},
        {"scenarioTime": "2026-04-14T23:30:00Z", "energyIdentCodeEic": "10YDK-1--------W", "name": "DK1", "netInterchange": 300.0},
    ]
    # cgma_timestamp("2026-04-13T22:00Z", 1, "PT1H")  = "2026-04-13T22:00:00Z"
    # cgma_timestamp("2026-04-13T22:00Z", 2, "PT1H")  = "2026-04-13T23:00:00Z"
    # cgma_timestamp("2026-04-13T22:00Z", 24, "PT1H") = "2026-04-14T21:00:00Z"
    cgma_rows = [
        {"eic": "10YDK-1--------W", "periodStart": "2026-04-13T22:00Z", "resolution": "PT1H",
         "position": 1, "quantity": 50.0, "isImport": True, "measurementUnit": "MAW", "businessType": "B65"},
        {"eic": "10YDK-1--------W", "periodStart": "2026-04-13T22:00Z", "resolution": "PT1H",
         "position": 2, "quantity": 60.0, "isImport": True, "measurementUnit": "MAW", "businessType": "B65"},
        {"eic": "10YDK-1--------W", "periodStart": "2026-04-13T22:00Z", "resolution": "PT1H",
         "position": 24, "quantity": 80.0, "isImport": True, "measurementUnit": "MAW", "businessType": "B65"},
    ]
    cgma_map = _aggregate_cgma(cgma_rows)
    result = _join_results(igm_rows, cgma_map)

    # pos 24 -> 2026-04-14T21:00:00Z matches IGM 21:30 (truncated to 21:00)
    # pos 1  -> 2026-04-13T22:00:00Z does NOT match IGM 22:30 (truncated to 2026-04-14T22:00:00Z)
    # pos 2  -> 2026-04-13T23:00:00Z does NOT match IGM 23:30 (truncated to 2026-04-14T23:00:00Z)
    assert len(result) == 1, f"Expected 1 direct match but got {len(result)}"
    assert result[0]["scenarioTime"] == "2026-04-14T21:30:00Z"


def test_comparison_query_returns_joined_rows():
    store = GraphStore()

    cgma_xml = open(os.path.join(FIXTURES, "cgma_example.xml")).read()
    load_cgma_file(store, cgma_xml, "test/cgma")
    eq_xml = open(os.path.join(FIXTURES, "eq_example.xml")).read()
    ssh_xml = open(os.path.join(FIXTURES, "ssh_example.xml")).read()
    load_igm_file(store, eq_xml, "test/eq")
    load_igm_file(store, ssh_xml, "test/ssh")

    rows = run_comparison_query(store)

    assert len(rows) > 0, "Should have comparison rows"

    dk1_rows = [r for r in rows if r["name"] == "DK1"]
    assert len(dk1_rows) > 0, "Should have a DK1 row"

    row = dk1_rows[0]
    assert row["energyIdentCodeEic"] == "10YDK-1--------W"
    assert row["businessType"] == "B65"
    assert row["netInterchange"] > 900.0
    expected_diff = row["netInterchange"] - row["cgmaNetPosition"]
    assert abs(row["difference"] - expected_diff) < 0.01


def test_comparison_query_logs_timing(caplog):
    """Verify that run_comparison_query emits timing log messages."""
    store = GraphStore()
    # Load minimal fixtures
    with open(os.path.join(FIXTURES, "eq_example.xml")) as f:
        load_igm_file(store, f.read(), "eq.xml")
    with open(os.path.join(FIXTURES, "ssh_example.xml")) as f:
        load_igm_file(store, f.read(), "ssh.xml")
    with open(os.path.join(FIXTURES, "cgma_example.xml")) as f:
        load_cgma_file(store, f.read(), "cgma.xml")

    with caplog.at_level(logging.INFO, logger="app.query"):
        run_comparison_query(store)

    log_text = caplog.text
    assert "IGM query" in log_text
    assert "CGMA query" in log_text


def test_no_duplicate_rows_with_multiple_eq_files():
    """Loading same EQ content in two graphs must not produce duplicate rows."""
    store = GraphStore()
    with open(os.path.join(FIXTURES, "eq_example.xml")) as f:
        eq_content = f.read()
    with open(os.path.join(FIXTURES, "ssh_example.xml")) as f:
        ssh_content = f.read()
    with open(os.path.join(FIXTURES, "cgma_example.xml")) as f:
        cgma_content = f.read()

    # Load same EQ content twice under different graph names (simulates two EQ files with same data)
    load_igm_file(store, eq_content, "eq_file_1.xml")
    load_igm_file(store, eq_content, "eq_file_2.xml")
    load_igm_file(store, ssh_content, "ssh.xml")
    load_cgma_file(store, cgma_content, "cgma.xml")

    rows = run_comparison_query(store)

    # Count rows per (name, scenarioTime) — should be exactly 1 each
    from collections import Counter
    counts = Counter((r["name"], r["scenarioTime"]) for r in rows)
    duplicates = {k: v for k, v in counts.items() if v > 1}
    assert duplicates == {}, f"Duplicate rows found: {duplicates}"


def test_fast_no_duplicates_with_multiple_eq_files():
    """Loading same EQ content twice must not produce duplicate result rows."""
    from app.igm_fast_parser import parse_eq, parse_ssh
    from app.query import run_comparison_fast

    with open(os.path.join(FIXTURES, "eq_example.xml")) as f:
        eq_content = f.read()
    with open(os.path.join(FIXTURES, "ssh_example.xml")) as f:
        ssh_records = parse_ssh(f.read())

    # Simulate loading same EQ content from two different files
    eq_records = parse_eq(eq_content) + parse_eq(eq_content)

    store = GraphStore()
    with open(os.path.join(FIXTURES, "cgma_example.xml")) as f:
        load_cgma_file(store, f.read(), "cgma.xml")

    rows = run_comparison_fast(eq_records, ssh_records, store)

    from collections import Counter
    counts = Counter((r["name"], r["scenarioTime"]) for r in rows)
    duplicates = {k: v for k, v in counts.items() if v > 1}
    assert duplicates == {}, f"Duplicate rows found: {duplicates}"


def test_run_comparison_fast_matches_sparql():
    """Fast path should produce the same results as the SPARQL path."""
    from app.igm_fast_parser import parse_eq, parse_ssh
    from app.query import run_comparison_fast

    store = GraphStore()
    with open(os.path.join(FIXTURES, "cgma_example.xml")) as f:
        load_cgma_file(store, f.read(), "cgma.xml")

    with open(os.path.join(FIXTURES, "eq_example.xml")) as f:
        eq_records = parse_eq(f.read())
    with open(os.path.join(FIXTURES, "ssh_example.xml")) as f:
        ssh_records = parse_ssh(f.read())

    fast_rows = run_comparison_fast(eq_records, ssh_records, store)

    # Also run the SPARQL path for comparison
    sparql_store = GraphStore()
    with open(os.path.join(FIXTURES, "eq_example.xml")) as f:
        load_igm_file(sparql_store, f.read(), "eq.xml")
    with open(os.path.join(FIXTURES, "ssh_example.xml")) as f:
        load_igm_file(sparql_store, f.read(), "ssh.xml")
    with open(os.path.join(FIXTURES, "cgma_example.xml")) as f:
        load_cgma_file(sparql_store, f.read(), "cgma.xml")
    sparql_rows = run_comparison_query(sparql_store)

    # Guard against vacuous pass
    assert len(fast_rows) > 0, "Fast path returned no rows"

    # Same number of rows
    assert len(fast_rows) == len(sparql_rows), (
        f"Fast: {len(fast_rows)} rows, SPARQL: {len(sparql_rows)} rows"
    )

    # Same data (compare sorted by name + scenarioTime)
    for fast_r, sparql_r in zip(fast_rows, sparql_rows):
        assert fast_r["name"] == sparql_r["name"]
        assert fast_r["scenarioTime"] == sparql_r["scenarioTime"]
        assert fast_r["energyIdentCodeEic"] == sparql_r["energyIdentCodeEic"]
        assert abs(fast_r["netInterchange"] - sparql_r["netInterchange"]) < 0.001
        assert abs(fast_r["cgmaNetPosition"] - sparql_r["cgmaNetPosition"]) < 0.001
        assert abs(fast_r["difference"] - sparql_r["difference"]) < 0.001


def test_join_results_passes_through_ssh_version():
    """_join_results must copy sshVersion from IGM rows to output rows."""
    igm_rows = [
        {"scenarioTime": "2026-04-09T23:30:00Z",
         "energyIdentCodeEic": "10YDK-1--------W",
         "name": "DK1", "netInterchange": 100.0, "sshVersion": "001"},
        {"scenarioTime": "2026-04-09T23:30:00Z",
         "energyIdentCodeEic": "10YDK-1--------W",
         "name": "DK1", "netInterchange": 110.0, "sshVersion": "003"},
    ]
    cgma_rows = [
        {"eic": "10YDK-1--------W", "periodStart": "2026-04-09T23:00Z",
         "resolution": "PT1H", "position": 1, "quantity": 90.0,
         "isImport": True, "measurementUnit": "MAW", "businessType": "B65"},
    ]
    cgma_map = _aggregate_cgma(cgma_rows)
    result = _join_results(igm_rows, cgma_map)

    assert len(result) == 2, f"Expected 2 rows, got {len(result)}"
    versions = sorted(r["sshVersion"] for r in result)
    assert versions == ["001", "003"], f"Expected ['001','003'], got {versions}"
