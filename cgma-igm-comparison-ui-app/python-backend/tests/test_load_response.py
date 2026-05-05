from app.main import LoadResponse


def test_load_response_has_status_fields():
    resp = LoadResponse(
        igm_files_loaded=0,
        cgma_files_loaded=0,
        total_triples=0,
        errors=[],
        data_available=False,
        message="CGMA data is not available for 2026-03-31.",
        igm_api_entries=48,
        cgma_api_entries=0,
    )
    assert resp.data_available is False
    assert resp.igm_api_entries == 48
    assert resp.cgma_api_entries == 0
    assert "CGMA" in resp.message
