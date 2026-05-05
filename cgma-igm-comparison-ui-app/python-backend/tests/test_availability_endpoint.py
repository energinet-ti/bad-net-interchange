from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app, AvailabilityResponse

client = TestClient(app)


def test_availability_response_model_fields():
    resp = AvailabilityResponse(
        date="2026-04-24",
        scenario="2D",
        igm_api_entries=5,
        cgma_api_entries=12,
        available=True,
    )
    assert resp.date == "2026-04-24"
    assert resp.scenario == "2D"
    assert resp.igm_api_entries == 5
    assert resp.cgma_api_entries == 12
    assert resp.available is True


@patch("app.main.cgma_client")
@patch("app.main.igm_client")
def test_available_returns_true_when_both_have_data(mock_igm, mock_cgma):
    mock_igm.get_control_area_day.return_value = [
        {"eqLocation": "/a.xml", "sshLocation": "/b.xml"}
    ]
    mock_cgma.get_filepaths.return_value = [{"filepath": "/c.xml"}]

    resp = client.get("/api/available", params={"date": "2026-04-24", "scenario": "2D"})
    body = resp.json()

    assert resp.status_code == 200
    assert body["date"] == "2026-04-24"
    assert body["scenario"] == "2D"
    assert body["igm_api_entries"] == 1
    assert body["cgma_api_entries"] == 1
    assert body["available"] is True


@patch("app.main.cgma_client")
@patch("app.main.igm_client")
def test_available_returns_false_when_cgma_empty(mock_igm, mock_cgma):
    mock_igm.get_control_area_day.return_value = [
        {"eqLocation": "/a.xml", "sshLocation": "/b.xml"}
    ]
    mock_cgma.get_filepaths.return_value = []

    resp = client.get("/api/available", params={"date": "2026-04-24", "scenario": "2D"})
    body = resp.json()

    assert resp.status_code == 200
    assert body["available"] is False
    assert body["igm_api_entries"] == 1
    assert body["cgma_api_entries"] == 0


@patch("app.main.cgma_client")
@patch("app.main.igm_client")
def test_available_returns_false_when_igm_empty(mock_igm, mock_cgma):
    mock_igm.get_control_area_day.return_value = []
    mock_cgma.get_filepaths.return_value = [{"filepath": "/c.xml"}]

    resp = client.get("/api/available", params={"date": "2026-04-24", "scenario": "2D"})
    body = resp.json()

    assert resp.status_code == 200
    assert body["available"] is False
    assert body["igm_api_entries"] == 0
    assert body["cgma_api_entries"] == 1


@patch("app.main.cgma_client")
@patch("app.main.igm_client")
def test_available_propagates_upstream_error(mock_igm, mock_cgma):
    mock_igm.get_control_area_day.side_effect = RuntimeError("upstream 500")
    mock_cgma.get_filepaths.return_value = []

    resp = client.get("/api/available", params={"date": "2026-04-24", "scenario": "2D"})
    assert resp.status_code == 502
    assert "IGM" in resp.json()["detail"]
