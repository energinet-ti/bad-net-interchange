from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app
import app.main as main_module

client = TestClient(app)


@patch("app.main.cgma_client")
@patch("app.main.igm_client")
def test_unavailable_load_clears_stale_cache(mock_igm, mock_cgma):
    """If a previous load cached data for this key, and now an API returns 0,
    the cache should be cleared so /api/query doesn't serve stale results."""
    # Simulate stale cache
    main_module._last_load_key = "2026-03-31:2D"
    main_module._igm_cache = {"eq": [], "ssh": []}
    main_module._cgma_store = None  # doesn't matter, just needs to exist

    mock_igm.get_control_area_day.return_value = [{"eqLocation": "/f.xml", "sshLocation": "/s.xml"}]
    mock_cgma.get_filepaths.return_value = []

    resp = client.post("/api/load", json={"date": "2026-03-31", "scenario": "2D"})
    body = resp.json()

    assert body["data_available"] is False
    # Cache should be cleared
    assert main_module._last_load_key is None
    assert main_module._igm_cache is None
