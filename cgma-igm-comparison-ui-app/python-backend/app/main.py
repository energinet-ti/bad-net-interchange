import os
import time
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from app.config import config
from app.graph_store import GraphStore
from app.file_loader import read_file_content, FileDeduplicator
from app.igm_fast_parser import parse_eq, parse_ssh, EqRecord, SshRecord
from app.cgma_parser import load_cgma_file
from app.query import run_comparison_fast
import app.igm_client as igm_client
import app.cgma_client as cgma_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Application state
_last_load_key: str | None = None
_igm_cache: dict | None = None  # {"eq": list[EqRecord], "ssh": list[SshRecord]}
_cgma_store: GraphStore | None = None


class LoadRequest(BaseModel):
    date: str
    scenario: str


class LoadResponse(BaseModel):
    igm_files_loaded: int
    cgma_files_loaded: int
    total_triples: int
    errors: list[str]
    data_available: bool = True
    message: str = ""
    igm_api_entries: int = 0
    cgma_api_entries: int = 0


class AvailabilityResponse(BaseModel):
    date: str
    scenario: str
    igm_api_entries: int
    cgma_api_entries: int
    available: bool


@app.get("/api/health")
def health():
    return "ok"


@app.get("/api/scenarios")
def get_scenarios():
    try:
        return igm_client.get_scenarios()
    except Exception as e:
        logger.error(f"Failed to fetch scenarios: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/available", response_model=AvailabilityResponse)
def get_available(date: str, scenario: str) -> AvailabilityResponse:
    """Lightweight availability probe: calls IGM and CGMA APIs and returns counts."""
    try:
        igm_entries = igm_client.get_control_area_day(date, scenario)
    except Exception as e:
        logger.error(f"IGM availability check failed: {e}")
        raise HTTPException(status_code=502, detail=f"IGM API error: {e}")

    try:
        cgma_docs = cgma_client.get_filepaths(date)
    except Exception as e:
        logger.error(f"CGMA availability check failed: {e}")
        raise HTTPException(status_code=502, detail=f"CGMA API error: {e}")

    igm_count = len(igm_entries)
    cgma_count = len(cgma_docs)

    return AvailabilityResponse(
        date=date,
        scenario=scenario,
        igm_api_entries=igm_count,
        cgma_api_entries=cgma_count,
        available=igm_count > 0 and cgma_count > 0,
    )


def _load_eq_file(path: str) -> tuple[str, list[EqRecord] | None, str | None]:
    """Read and parse an EQ file. Returns (path, records, error)."""
    try:
        t0 = time.time()
        content = read_file_content(path)
        t_read = time.time() - t0
        records = parse_eq(content)
        t_parse = time.time() - t0 - t_read
        logger.info("  EQ file: read=%.2fs parse=%.2fs %s", t_read, t_parse, path)
        return (path, records, None)
    except Exception as e:
        return (path, None, f"EQ error: {e}")


def _load_ssh_file(path: str, ssh_version: str = "") -> tuple[str, list[SshRecord] | None, str | None]:
    """Read and parse an SSH file. Returns (path, records, error).

    The ``ssh_version`` argument comes from the IGM API response (the
    ``sshVersion`` field on each control-area-day entry) and is stamped onto
    each parsed ``SshRecord`` so the query layer can emit it downstream to the
    frontend's version dropdown.
    """
    try:
        t0 = time.time()
        content = read_file_content(path)
        t_read = time.time() - t0
        records = parse_ssh(content, ssh_version=ssh_version)
        t_parse = time.time() - t0 - t_read
        logger.info("  SSH file: read=%.2fs parse=%.2fs v=%s %s", t_read, t_parse, ssh_version, path)
        return (path, records, None)
    except Exception as e:
        return (path, None, f"SSH error: {e}")


def _build_availability_message(
    date: str, scenario: str,
    igm_entries: list[dict], cgma_docs: list[dict],
) -> str:
    """Build a user-facing message describing which data sources are missing."""
    parts = []

    if not igm_entries and not cgma_docs:
        parts.append(
            f"Neither IGM nor CGMA data is available for {date} (scenario {scenario})."
        )
        parts.append("Both data sources are required for comparison.")
    elif not igm_entries:
        parts.append(
            f"IGM data is not available for {date} (scenario {scenario})."
        )
        parts.append(
            f"CGMA data is available with {len(cgma_docs)} document(s), "
            "but both data sources are required for comparison."
        )
    else:
        parts.append(f"CGMA data is not available for {date}.")
        parts.append(
            f"IGM data is available with {len(igm_entries)} entries (scenario {scenario}), "
            "but both data sources are required for comparison."
        )

    return " ".join(parts)


@app.post("/api/load")
def load_data(req: LoadRequest) -> LoadResponse:
    global _last_load_key, _igm_cache, _cgma_store

    load_key = f"{req.date}:{req.scenario}"

    # Check cache
    if _last_load_key == load_key and _igm_cache is not None and _cgma_store is not None:
        logger.info("Using cached data for %s", load_key)
        return LoadResponse(
            igm_files_loaded=0,
            cgma_files_loaded=0,
            total_triples=0,
            errors=["Using cached data"],
        )

    t_total = time.time()
    errors: list[str] = []

    # ── Phase 1: Call both APIs in parallel to check availability ──
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=2) as api_pool:
        igm_future = api_pool.submit(igm_client.get_control_area_day, req.date, req.scenario)
        cgma_future = api_pool.submit(cgma_client.get_filepaths, req.date)

        try:
            igm_entries = igm_future.result()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"IGM API error: {e}")

        try:
            cgma_docs = cgma_future.result()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"CGMA API error: {e}")
    logger.info(
        "API calls (parallel): %.2fs (IGM=%d entries, CGMA=%d docs)",
        time.time() - t0, len(igm_entries), len(cgma_docs),
    )

    igm_available = len(igm_entries) > 0
    cgma_available = len(cgma_docs) > 0

    # ── Phase 2: Availability gate ─────────────────────────────────
    if not igm_available or not cgma_available:
        missing = _build_availability_message(
            req.date, req.scenario, igm_entries, cgma_docs
        )
        logger.info("Data unavailable — skipping file load: %s", missing)
        # Clear any stale cache for this key
        _last_load_key = None
        _igm_cache = None
        _cgma_store = None
        return LoadResponse(
            igm_files_loaded=0,
            cgma_files_loaded=0,
            total_triples=0,
            errors=[],
            data_available=False,
            message=missing,
            igm_api_entries=len(igm_entries),
            cgma_api_entries=len(cgma_docs),
        )

    # ── Phase 3: Load files (both sources available) ───────────────
    dedup = FileDeduplicator()
    all_eq: list[EqRecord] = []
    all_ssh: list[SshRecord] = []
    igm_count = 0
    cgma_count = 0

    # Load IGM files in parallel
    t0 = time.time()
    eq_futures = []
    ssh_futures = []

    with ThreadPoolExecutor(max_workers=32) as pool:
        for entry in igm_entries:
            eq_loc = entry.get("eqLocation", "")
            ssh_loc = entry.get("sshLocation", "")

            if eq_loc and dedup.should_load(eq_loc):
                eq_futures.append(pool.submit(_load_eq_file, eq_loc))

            if ssh_loc and dedup.should_load(ssh_loc):
                raw_version = entry.get("sshVersion")
                ssh_version = str(raw_version) if raw_version is not None else ""
                ssh_futures.append(pool.submit(_load_ssh_file, ssh_loc, ssh_version))

        for future in as_completed(eq_futures):
            path, records, error = future.result()
            if error:
                errors.append(error)
            elif records is not None:
                all_eq.extend(records)
                igm_count += 1

        for future in as_completed(ssh_futures):
            path, records, error = future.result()
            if error:
                errors.append(error)
            elif records is not None:
                all_ssh.extend(records)
                igm_count += 1

    logger.info("IGM files total: %.2fs (%d files, %d EQ records, %d SSH records)",
                time.time() - t0, igm_count, len(all_eq), len(all_ssh))

    # Load CGMA files (read in parallel, parse sequentially into shared GraphStore)
    t0 = time.time()
    cgma_store = GraphStore()

    cgma_paths = [
        doc.get("filepath", "") for doc in cgma_docs
        if doc.get("filepath", "") and dedup.should_load(doc.get("filepath", ""))
    ]

    def _read_cgma(path: str) -> tuple[str, str | None, float, str | None]:
        try:
            t_file = time.time()
            content = read_file_content(path)
            return (path, content, time.time() - t_file, None)
        except Exception as e:
            return (path, None, 0.0, f"CGMA read error: {e}")

    if cgma_paths:
        with ThreadPoolExecutor(max_workers=min(16, len(cgma_paths))) as pool:
            for path, content, t_read, err in pool.map(_read_cgma, cgma_paths):
                if err:
                    errors.append(err)
                    continue
                try:
                    t_parse_start = time.time()
                    load_cgma_file(cgma_store, content, path)
                    t_parse = time.time() - t_parse_start
                    logger.info("  CGMA file: read=%.2fs parse=%.2fs %s", t_read, t_parse, path)
                    cgma_count += 1
                except Exception as e:
                    errors.append(f"CGMA parse error: {e}")
    logger.info("CGMA files total: %.2fs (%d files)", time.time() - t0, cgma_count)

    # Store in app state
    _igm_cache = {"eq": all_eq, "ssh": all_ssh}
    _cgma_store = cgma_store
    _last_load_key = load_key

    logger.info("Total load: %.2fs | %d IGM + %d CGMA files",
                time.time() - t_total, igm_count, cgma_count)

    return LoadResponse(
        igm_files_loaded=igm_count,
        cgma_files_loaded=cgma_count,
        total_triples=cgma_store.len() + len(all_eq) + len(all_ssh),
        errors=errors,
        data_available=True,
        message="",
        igm_api_entries=len(igm_entries),
        cgma_api_entries=len(cgma_docs),
    )


@app.post("/api/query")
def query_comparison():
    if _igm_cache is None or _cgma_store is None:
        raise HTTPException(status_code=400, detail="No data loaded. Call /api/load first.")

    try:
        t0 = time.time()
        rows = run_comparison_fast(_igm_cache["eq"], _igm_cache["ssh"], _cgma_store)
        logger.info("Query endpoint: %.2fs (%d rows returned)", time.time() - t0, len(rows))
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query error: {e}")


# Serve frontend build if it exists (production mode)
frontend_build = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "build")
if os.path.isdir(frontend_build):
    app.mount("/", StaticFiles(directory=frontend_build, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=config.port, reload=True)
