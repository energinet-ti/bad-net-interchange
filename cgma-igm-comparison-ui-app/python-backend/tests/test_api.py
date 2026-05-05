import os
import logging
from fastapi.testclient import TestClient
from app.main import app
from app.graph_store import GraphStore
from app.igm_parser import load_igm_file
from app.cgma_parser import load_cgma_file

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def test_health():
    client = TestClient(app)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.text == '"ok"'


def test_combined_store_holds_both_datasets():
    store = GraphStore()

    cgma_xml = open(os.path.join(FIXTURES, "cgma_example.xml")).read()
    load_cgma_file(store, cgma_xml, "test/cgma")
    cgma_triples = store.len()

    eq_xml = open(os.path.join(FIXTURES, "eq_example.xml")).read()
    ssh_xml = open(os.path.join(FIXTURES, "ssh_example.xml")).read()
    load_igm_file(store, eq_xml, "test/eq")
    load_igm_file(store, ssh_xml, "test/ssh")

    assert store.len() > cgma_triples, "Adding IGM should increase triple count"


def test_load_endpoint_logs_timing(caplog, monkeypatch):
    """Verify that the load endpoint emits timing log messages."""
    # Mock external API calls to return empty lists (triggers availability gate)
    monkeypatch.setattr("app.main.igm_client.get_control_area_day", lambda d, s: [])
    monkeypatch.setattr("app.main.cgma_client.get_filepaths", lambda d: [])

    # Reset app state
    import app.main as m
    m._igm_cache = None
    m._cgma_store = None
    m._last_load_key = None

    with caplog.at_level(logging.INFO, logger="app.main"):
        client = TestClient(m.app)
        resp = client.post("/api/load", json={"date": "2026-03-30", "scenario": "2D"})
        assert resp.status_code == 200

    log_text = caplog.text
    assert "API calls (parallel)" in log_text
    assert "Data unavailable" in log_text


def test_load_endpoint_uses_parallel_loading(caplog, monkeypatch):
    """Verify the load endpoint uses the fast parallel path."""
    import app.main as m
    m._igm_cache = None
    m._cgma_store = None
    m._last_load_key = None

    monkeypatch.setattr("app.main.igm_client.get_control_area_day", lambda d, s: [])
    monkeypatch.setattr("app.main.cgma_client.get_filepaths", lambda d: [])

    with caplog.at_level(logging.INFO, logger="app.main"):
        client = TestClient(m.app)
        resp = client.post("/api/load", json={"date": "2026-03-31", "scenario": "2D"})
        assert resp.status_code == 200

    log_text = caplog.text
    assert "API calls (parallel)" in log_text
    assert "Data unavailable" in log_text
