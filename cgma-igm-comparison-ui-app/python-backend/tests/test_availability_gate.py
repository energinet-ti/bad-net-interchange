from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


@patch("app.main.cgma_client")
@patch("app.main.igm_client")
def test_load_returns_unavailable_when_cgma_empty(mock_igm, mock_cgma):
    mock_igm.get_control_area_day.return_value = [
        {"eqLocation": "/fake/eq.xml", "sshLocation": "/fake/ssh.xml"}
    ]
    mock_cgma.get_filepaths.return_value = []

    resp = client.post("/api/load", json={"date": "2026-03-31", "scenario": "2D"})
    body = resp.json()

    assert resp.status_code == 200
    assert body["data_available"] is False
    assert body["igm_api_entries"] == 1
    assert body["cgma_api_entries"] == 0
    assert body["igm_files_loaded"] == 0  # no files loaded
    assert body["cgma_files_loaded"] == 0
    assert "CGMA" in body["message"]


@patch("app.main.cgma_client")
@patch("app.main.igm_client")
def test_load_returns_unavailable_when_igm_empty(mock_igm, mock_cgma):
    mock_igm.get_control_area_day.return_value = []
    mock_cgma.get_filepaths.return_value = [{"filepath": "/fake/cgma.xml"}]

    resp = client.post("/api/load", json={"date": "2026-03-31", "scenario": "2D"})
    body = resp.json()

    assert resp.status_code == 200
    assert body["data_available"] is False
    assert body["igm_api_entries"] == 0
    assert body["cgma_api_entries"] == 1
    assert "IGM" in body["message"]


@patch("app.main.cgma_client")
@patch("app.main.igm_client")
def test_load_returns_unavailable_when_both_empty(mock_igm, mock_cgma):
    mock_igm.get_control_area_day.return_value = []
    mock_cgma.get_filepaths.return_value = []

    resp = client.post("/api/load", json={"date": "2026-03-31", "scenario": "2D"})
    body = resp.json()

    assert resp.status_code == 200
    assert body["data_available"] is False
    assert "IGM" in body["message"]
    assert "CGMA" in body["message"]
