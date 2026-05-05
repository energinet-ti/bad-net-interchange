from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app
import app.main as main_module


def test_load_threads_ssh_version_from_api():
    """/api/load should call _load_ssh_file with the sshVersion from each IGM entry."""
    client = TestClient(app)

    igm_entries = [{
        "scenarioTime": "2026-04-09T23:30:00Z",
        "scenario": "2D",
        "sshVersion": "003",
        "sshId": "ssh-1",
        "sshLocation": "/tmp/ssh_003.zip",
        "eqId": "eq-1",
        "eqLocation": "/tmp/eq_001.zip",
    }]
    cgma_docs = [{"filepath": "/tmp/cgma.zip"}]

    captured_calls = []

    def fake_load_ssh(path, ssh_version=""):
        captured_calls.append((path, ssh_version))
        return (path, [], None)

    def fake_load_eq(path):
        return (path, [], None)

    # Reset cache so the load actually runs
    main_module._last_load_key = None
    main_module._igm_cache = None
    main_module._cgma_store = None

    with patch("app.main.igm_client.get_control_area_day", return_value=igm_entries), \
         patch("app.main.cgma_client.get_filepaths", return_value=cgma_docs), \
         patch("app.main._load_ssh_file", side_effect=fake_load_ssh), \
         patch("app.main._load_eq_file", side_effect=fake_load_eq), \
         patch("app.main.read_file_content", return_value=""), \
         patch("app.main.load_cgma_file"):
        resp = client.post("/api/load", json={"date": "2026-04-09", "scenario": "2D"})
        assert resp.status_code == 200

    assert any(version == "003" for (_, version) in captured_calls), (
        f"Expected _load_ssh_file to be called with ssh_version='003', got {captured_calls}"
    )


def test_load_handles_null_ssh_version_as_empty_string():
    """If upstream sends sshVersion=None, we pass '' not 'None'."""
    client = TestClient(app)

    igm_entries = [{
        "scenarioTime": "2026-04-09T23:30:00Z",
        "scenario": "2D",
        "sshVersion": None,
        "sshId": "ssh-1",
        "sshLocation": "/tmp/ssh_noversion.zip",
        "eqId": "eq-1",
        "eqLocation": "/tmp/eq_001.zip",
    }]
    cgma_docs = [{"filepath": "/tmp/cgma.zip"}]

    captured_calls = []

    def fake_load_ssh(path, ssh_version=""):
        captured_calls.append((path, ssh_version))
        return (path, [], None)

    def fake_load_eq(path):
        return (path, [], None)

    main_module._last_load_key = None
    main_module._igm_cache = None
    main_module._cgma_store = None

    with patch("app.main.igm_client.get_control_area_day", return_value=igm_entries), \
         patch("app.main.cgma_client.get_filepaths", return_value=cgma_docs), \
         patch("app.main._load_ssh_file", side_effect=fake_load_ssh), \
         patch("app.main._load_eq_file", side_effect=fake_load_eq), \
         patch("app.main.read_file_content", return_value=""), \
         patch("app.main.load_cgma_file"):
        resp = client.post("/api/load", json={"date": "2026-04-09", "scenario": "2D"})
        assert resp.status_code == 200

    versions = [v for (_, v) in captured_calls]
    assert "None" not in versions, f"Expected no 'None' string, got {versions}"
    assert "" in versions, f"Expected empty string version, got {versions}"
