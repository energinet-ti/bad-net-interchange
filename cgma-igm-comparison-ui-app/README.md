#  CGMA / IGM Comparison UI

A SvelteKit application with two interchangeable backends (Rust and Python) that loads CGMA (Common Grid Model Alignment) and IGM (Individual Grid Model) data, computes net interchange comparisons, and displays the results in a sortable table and interactive chart. Both backends expose the same 4 API endpoints, so the frontend works identically with either one. The **Rust backend** uses [Oxigraph](https://github.com/oxigraph/oxigraph) with SPARQL queries and is intended for production. The **Python backend** uses a hybrid approach — fast ElementTree XML parsing with Python dict joins for IGM data and [rdflib](https://rdflib.readthedocs.io/) with SPARQL for CGMA data — and is intended for local development and testing on machines where Rust is unavailable (e.g., Windows without a Rust toolchain).

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick Start (Rust)](#quick-start-rust)
- [Quick Start (Python)](#quick-start-python)
- [Configuration](#configuration)
- [Running in Development](#running-in-development)
- [Production Build](#production-build)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [How It Works](#how-it-works)
- [Docker](#docker)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Browser                       │
│         SvelteKit SPA (Svelte 5)                │
│   Date picker / Scenario selector / Load btn    │
│   ComparisonTable (sortable) / Chart.js chart   │
└────────────────────┬────────────────────────────┘
                     │ /api/*
        ┌────────────┴────────────┐
        │                         │
┌───────▼──────────────┐  ┌───────▼───────────────┐
│  Rust / Axum Backend │  │  Python / FastAPI     │
│  (production)        │  │  (local testing)      │
│                      │  │                       │
│  Oxigraph store      │  │  Fast ElementTree +   │
│  quick-xml parser    │  │  Python dict join     │
│  reqwest + retry     │  │  requests + retry     │
└──────────┬───────────┘  └───────────┬───────────┘
           │                          │
      Same 4 endpoints:  /api/health, /api/scenarios,
                         /api/load, /api/query
           │                          │
      IGM Cloud API            CGMA Cloud API
      (scenario data)          (document paths)
```

Both backends expose identical API endpoints. The frontend connects to whichever backend is running on port 3001. In production, Axum serves both the API and the pre-built SvelteKit static files from a single port. In development, Vite runs a dev server with hot reload and proxies `/api/*` requests to the backend.

## Prerequisites

You need **one** of the two backends, plus a JavaScript runtime for the frontend.

### For the Rust backend (production)

| Tool        | Version | Notes                                                                                                       |
| ----------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| **Rust**    | 1.85+   | Required for Rust edition 2024. Install via [rustup](https://rustup.rs/) or Homebrew (`brew install rust`). |
| **Bun** or **Node.js** | Bun 1.0+ / Node 18+ | For building the SvelteKit frontend. Bun is recommended (faster installs, no separate npm needed). |

### For the Python backend (local testing)

| Tool         | Version | Notes                                                        |
| ------------ | ------- | ------------------------------------------------------------ |
| **Python**   | 3.10+   | Tested with 3.13. No Rust toolchain required.                |
| **Bun** or **Node.js** | Bun 1.0+ / Node 18+ | For building the SvelteKit frontend. Bun is recommended. |

> **Bun vs Node.js:** The frontend has no Node-specific dependencies. You can use `bun install` / `bun run build` / `bun run dev` everywhere this README says `npm install` / `npm run build` / `npm run dev`. All commands are interchangeable.

Verify your installations:

```bash
# Rust backend
rustc --version   # Must be >= 1.85.0

# Python backend
python3 --version # Must be >= 3.10

# Frontend (pick one)
bun --version     # Recommended
node --version    # Alternative (must be >= 18)
```

## Quick Start (Rust)

```bash
# 1. Clone and navigate to the project
cd experiments/cgma-igm-comparison-ui-app

# 2. Set up environment variables
cp backend/.env.example backend/.env
# Edit backend/.env and add your real API keys:
#   IGM_API_KEY=your-real-igm-key
#   CGMA_API_KEY=your-real-cgma-key

# 3. Install frontend dependencies and build
cd frontend && bun install && bun run build && cd ..
# (or: npm install && npm run build)

# 4. Build and run the Rust backend
cd backend && cargo run --release
# Server starts on http://localhost:3001
```

Or use the one-step build script: `chmod +x build.sh && ./build.sh`

Open `http://localhost:3001` in your browser. Select a date and scenario, then click **Load & Compare** to fetch IGM/CGMA files, parse them into the RDF store, and run the comparison query. Results are shown in a sortable table and an interactive Chart.js line chart.

## Quick Start (Python)

The Python backend is a drop-in replacement for the Rust backend. Use it when Rust is unavailable or you want a faster setup on Windows/macOS.

```bash
# 1. Clone and navigate to the project
cd experiments/cgma-igm-comparison-ui-app

# 2. Set up environment variables
cp python-backend/.env.example python-backend/.env
# Edit python-backend/.env and add your real API keys:
#   IGM_API_KEY=your-real-igm-key
#   CGMA_API_KEY=your-real-cgma-key

# 3. Install Python dependencies
cd python-backend
python3 -m pip install -r requirements.txt

# 4. Start the Python backend
python3 -m app.main
# Server starts on http://localhost:3001
```

Then, in a separate terminal:

```bash
# 5. Start the frontend dev server
cd frontend
bun install    # First time only (or: npm install)
bun run dev
# Vite dev server on http://localhost:5173
# API requests proxied to http://localhost:3001
```

Open `http://localhost:5173` in your browser. The frontend works identically with either backend.

## Configuration

All configuration is via environment variables, loaded from `.env` in the respective backend directory. Both backends use the same variables. Copy the example file to get started:

```bash
# Rust backend
cp backend/.env.example backend/.env

# Python backend
cp python-backend/.env.example python-backend/.env
```


| Variable        | Required | Default                                    | Description                                                 |
| --------------- | -------- | ------------------------------------------ | ----------------------------------------------------------- |
| `IGM_API_KEY`   | **Yes**  | --                                         | API key for the IGM Cloud API. Sent as `X-API-KEY` header.  |
| `CGMA_API_KEY`  | **Yes**  | --                                         | API key for the CGMA Cloud API. Sent as `X-API-KEY` header. |
| `IGM_API_HOST`  | No       | `http://localhost:5212`                    | Base URL for the IGM Cloud API.                             |
| `CGMA_API_HOST` | No       | `https://cgma-cloud-api.azurewebsites.net` | Base URL for the CGMA Cloud API.                            |
| `PORT`          | No       | `3001`                                     | Port the backend server listens on.                         |


The Rust backend will **panic on startup** if either API key is missing. The Python backend will start but API calls will fail with 502 errors.

## Running in Development

Development mode runs the frontend and backend as separate processes. Vite provides hot module reload for the frontend and proxies API requests to whichever backend is running on port 3001.

### Option A: Rust backend

**Terminal 1 -- Backend:**

```bash
cd backend
cp .env.example .env   # Edit with real API keys
cargo run
# Listening on 0.0.0.0:3001
```

### Option B: Python backend

**Terminal 1 -- Backend:**

```bash
cd python-backend
cp .env.example .env   # Edit with real API keys
python3 -m pip install -r requirements.txt  # First time only
python3 -m app.main
# Listening on 0.0.0.0:3001
```

### Frontend (same for both backends)

**Terminal 2 -- Frontend:**

```bash
cd frontend
bun install            # First time only (or: npm install)
bun run dev
# Vite dev server on http://localhost:5173
# API requests proxied to http://localhost:3001
```

Open `http://localhost:5173` for the frontend with hot reload. API calls (`/api/*`) are automatically proxied to whichever backend is running.

### Useful development commands

```bash
# Rust backend
cd backend
cargo check            # Fast type-check without building
cargo run              # Build and run (debug mode)
cargo test             # Run all tests (unit + integration)
cargo test query       # Run only query module tests

# Python backend
cd python-backend
python3 -m app.main                   # Run the server
python3 -m pytest tests/ -v           # Run all tests
python3 -m pytest tests/test_query.py # Run only query tests

# Frontend (use bun or npm interchangeably)
cd frontend
bun run dev            # Dev server with hot reload
bun run build          # Production build to frontend/build/
bun run check          # Svelte/TypeScript type checking
```

## Production Build

The `build.sh` script builds both the frontend and backend in one step:

```bash
./build.sh
```

This will:

1. Build the SvelteKit frontend (`npm run build`) -- outputs static files to `frontend/build/`
2. Build the Rust backend in release mode (`cargo build --release`)

Then run the production binary:

```bash
cd backend
cargo run --release
```

The Axum server serves both the API endpoints and the static frontend files on a single port (default `3001`). No separate web server or reverse proxy is needed.

The compiled binary is at `backend/target/release/cgma-igm-backend` and can be deployed standalone (alongside the `frontend/build/` directory one level up from wherever the binary runs).

### Production with the Python backend

If you only have Python (no Rust), build the frontend separately and let the Python backend serve the static files:

```bash
cd frontend
bun install && bun run build   # (or: npm install && npm run build)
cd ../python-backend
python3 -m app.main
# Serves API on :3001 and static files from ../frontend/build/
```

## API Reference

### `GET /api/health`

Health check endpoint.

**Response:** `200 OK` with body `ok`

### `GET /api/scenarios`

Lists available scenario types from the IGM Cloud API.

**Response:** `200 OK`

```json
["2D", "ID", "1D"]
```

**Errors:** `502 Bad Gateway` if the upstream IGM API is unreachable.

### `POST /api/load`

Orchestrates the full data loading pipeline: first checks both APIs for data availability, then (if both have data) fetches file paths from both APIs, reads files from the filesystem, parses them, and loads everything into the in-memory store. If either API returns 0 entries, file loading is skipped entirely and a descriptive message is returned.

**Request body:**

```json
{
  "date": "2026-03-05",
  "scenario": "2D"
}
```

**Response:** `200 OK`

```json
{
  "igm_files_loaded": 42,
  "cgma_files_loaded": 3,
  "total_triples": 185230,
  "errors": [
    "EQ file error: file not found: /path/to/missing.xml"
  ],
  "data_available": true,
  "message": "",
  "igm_api_entries": 48,
  "cgma_api_entries": 3
}
```

When either data source is unavailable, the response indicates which source is missing:

```json
{
  "igm_files_loaded": 0,
  "cgma_files_loaded": 0,
  "total_triples": 0,
  "errors": [],
  "data_available": false,
  "message": "CGMA data is not available for 2026-03-05. IGM data is available with 48 entries (scenario 2D), but both data sources are required for comparison.",
  "igm_api_entries": 48,
  "cgma_api_entries": 0
}
```

The `errors` array contains non-fatal warnings for individual files that failed to load. The overall request succeeds even if some files fail. If the same date+scenario is requested again and both sources were available, cached data is returned without re-fetching. If data was previously unavailable, the cache is cleared to force a fresh check.

**Errors:**

- `502 Bad Gateway` -- upstream API unreachable
- `500 Internal Server Error` -- store creation failed

### `POST /api/query`

Runs the IGM vs CGMA comparison query against the loaded data. Executes two SPARQL queries (IGM ControlArea + CGMA B65 timeseries), aligns them by EIC code and truncated hour, and returns joined comparison rows.

**Request body:** None (uses the previously loaded data)

**Response:** `200 OK`

```json
[
  {
    "scenarioTime": "2026-03-05T00:30:00Z",
    "cgmaTime": "2026-03-05T00:00:00Z",
    "energyIdentCodeEic": "10YDK-1--------W",
    "name": "DK1",
    "businessType": "B65",
    "netInterchange": 987.13,
    "cgmaNetPosition": 829.195,
    "difference": 157.935,
    "measurementUnit": "MAW",
    "resolution": "PT1H"
  }
]
```

**Errors:**

- `400 Bad Request` -- no data loaded yet (call `/api/load` first)
- `500 Internal Server Error` -- SPARQL query execution failed

### `GET /`* (fallback)

Serves the static SvelteKit build. Any path not matching `/api/`* returns `index.html` for SPA client-side routing.

## Project Structure

```
cgma-igm-comparison-ui-app/
├── build.sh                          # One-step production build script
├── Dockerfile                        # Multi-stage Docker build for Azure
├── .dockerignore
├── README.md
│
├── backend/                          # Rust backend (production)
│   ├── Cargo.toml                    # Rust dependencies (edition 2024)
│   ├── .env.example                  # Environment variable template
│   ├── src/
│   │   ├── main.rs                   # Axum server, routes, app state, caching
│   │   ├── lib.rs                    # Public module exports (for integration tests)
│   │   ├── config.rs                 # Environment configuration with defaults
│   │   ├── igm_client.rs            # HTTP client for IGM Cloud API (with retry)
│   │   ├── cgma_client.rs           # HTTP client for CGMA Cloud API (with retry)
│   │   ├── retry.rs                 # Exponential backoff retry helper
│   │   ├── file_loader.rs           # File I/O, ZIP extraction, deduplication
│   │   ├── graph_store.rs           # Oxigraph store wrapper (RDF load, SPARQL query)
│   │   ├── igm_parser.rs            # RDF/XML parser for IGM (CIM16) files
│   │   ├── cgma_parser.rs           # XML state-machine parser for CGMA documents
│   │   └── query.rs                 # Comparison logic: SPARQL queries, time alignment, join
│   └── tests/
│       ├── integration_test.rs       # 7 integration tests
│       └── fixtures/                 # Real CIM/CGMA XML test data
│           ├── cgma_example.xml
│           ├── eq_example.xml
│           └── ssh_example.xml
│
├── python-backend/                   # Python backend (local testing)
│   ├── requirements.txt              # Python dependencies
│   ├── .env.example                  # Environment variable template
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                   # FastAPI app, endpoints, parallel loading, caching
│   │   ├── config.py                 # Environment variable loading (python-dotenv)
│   │   ├── graph_store.py            # rdflib ConjunctiveGraph wrapper with SPARQL
│   │   ├── igm_client.py            # HTTP client for IGM Cloud API (with retry)
│   │   ├── cgma_client.py           # HTTP client for CGMA Cloud API (with retry)
│   │   ├── igm_parser.py            # RDF/XML loader for IGM files into named graphs
│   │   ├── igm_fast_parser.py       # Fast ElementTree parser for EQ/SSH → typed records
│   │   ├── cgma_parser.py           # XML parser converting CGMA to RDF triples
│   │   ├── query.py                 # Fast dict join (IGM) + SPARQL (CGMA), time alignment
│   │   └── file_loader.py           # ZIP extraction, file deduplication
│   └── tests/
│       ├── __init__.py
│       ├── fixtures/                 # Copies of backend/tests/fixtures/
│       │   ├── cgma_example.xml
│       │   ├── eq_example.xml
│       │   └── ssh_example.xml
│       ├── test_api.py               # Health, combined store, parallel loading tests
│       ├── test_availability_gate.py  # API availability gate tests
│       ├── test_cache_clear.py        # Stale cache clearing tests
│       ├── test_cgma_parser.py       # CGMA XML parsing + B65/A66 queries
│       ├── test_file_loader.py       # File reading + deduplication
│       ├── test_graph_store.py       # rdflib store: load, query, clear
│       ├── test_igm_parser.py        # IGM RDF/XML loading + cross-graph query
│       ├── test_igm_fast_parser.py   # Fast EQ/SSH ElementTree parser tests
│       ├── test_load_response.py      # LoadResponse model field tests
│       └── test_query.py             # Time alignment, fast comparison, deduplication
│
├── frontend/
│   ├── package.json                  # Svelte 5 + SvelteKit 2 + Vite 6 + Chart.js
│   ├── svelte.config.js             # Static adapter (SPA mode)
│   ├── vite.config.ts               # Dev proxy to backend on :3001
│   ├── tsconfig.json
│   ├── static/
│   │   └── favicon.png
│   └── src/
│       ├── app.html                  # HTML shell
│       ├── app.d.ts                  # SvelteKit type declarations
│       ├── routes/
│       │   ├── +layout.ts           # SPA config (prerender + no SSR)
│       │   └── +page.svelte         # Comparison UI: load, table/chart tabs
│       └── lib/
│           ├── api.ts               # Typed fetch wrappers for /api/* endpoints
│           ├── ComparisonTable.svelte # Sortable comparison data table
│           └── ComparisonChart.svelte # Chart.js line chart (IGM vs CGMA)
│
└── docs/
    └── plans/
        ├── 2026-03-13-sparql-query-and-comparison-ui.md
        └── 2026-03-31-api-availability-gate.md
```

## How It Works

### Data Loading Pipeline

When the user clicks **Load Data**, the backend executes this pipeline:

1. **Check API availability** -- Calls both the IGM and CGMA Cloud APIs to check if data is available for the requested date and scenario. If either API returns 0 entries, the pipeline stops here and returns a descriptive message explaining which data source is missing. The frontend displays this in an amber warning banner instead of proceeding to query.
2. **Fetch IGM file paths** -- Calls the IGM Cloud API with the selected date and scenario to get a list of `ScenarioEntry` records, each containing file paths to EQ (Equipment) and SSH (Steady State Hypothesis) files on network storage.
3. **Load IGM files** -- For each entry, reads the EQ and SSH files from the filesystem. If a file is a ZIP archive, the first `.xml` or `.rdf` entry is extracted. EQ files shared across multiple entries are deduplicated (loaded only once). The **Rust backend** parses each file as RDF/XML into a separate named graph (`urn:igm:{filepath}`) using Oxigraph's native parser. The **Python backend** uses a fast ElementTree parser (`igm_fast_parser.py`) that extracts EQ records (ControlArea ID, name, EIC code) and SSH records (ControlArea ID, scenarioTime, netInterchange) directly into typed Python dicts, bypassing RDF entirely. IGM files are loaded in parallel using a `ThreadPoolExecutor` (8 workers).
4. **Fetch CGMA file paths** -- Calls the CGMA Cloud API with the selected date to get a list of `CgmaDocument` records with file paths.
5. **Load CGMA files** -- Reads each CGMA XML file from the filesystem (ZIP-aware). CGMA files are plain XML (not RDF), so a custom parser converts the document structure into RDF triples using the `https://example.com/cgma#` namespace, stored in named graphs (`urn:cgma:{filepath}`). The Rust backend uses a `quick-xml` state-machine parser; the Python backend uses `xml.etree.ElementTree`.
6. **Store result** -- The Rust backend stores a populated RDF store in shared application state. The Python backend stores IGM data as lists of typed records (`EqRecord`, `SshRecord`) and CGMA data in an rdflib `GraphStore`. The cache key is updated so the same date+scenario won't re-fetch. If data was previously unavailable, any stale cache is cleared.
7. **Run comparison query** -- Immediately after loading, the frontend calls `POST /api/query`. The **Rust backend** executes two SPARQL queries (IGM ControlArea + CGMA B65 timeseries), aligns them by EIC code and truncated hour, computes net position and difference. The **Python backend** uses a hybrid approach: IGM comparison is done via fast Python dict joins (indexing EQ records by ControlArea ID, then joining with SSH records), while CGMA comparison still uses SPARQL. EQ records are deduplicated by `control_area_id` to prevent duplicate rows when the same EQ content appears in multiple files.

### Time Alignment

IGM `scenarioTime` values have 30-minute offsets (e.g., `00:30:00Z`). These are truncated to the hour (`00:00:00Z`) for matching. CGMA timestamps are computed from `periodStart + position * resolution` (e.g., `23:00Z + 1 * PT1H = 00:00:00Z`). Rows are joined on exact EIC code + truncated hour equality.

### Comparison Output

Each comparison row contains:

- **netInterchange** (IGM) -- the control area's net interchange from the SSH model
- **cgmaNetPosition** (CGMA) -- sum of import quantities minus sum of export quantities for the matching area and hour
- **difference** -- `netInterchange - cgmaNetPosition`

### RDF Graph Organization

**Rust backend:** All data lives in named graphs within a single Oxigraph RDF store:

- **IGM graphs** (`urn:igm:{filepath}`) -- Standard CIM16 RDF/XML. EQ graphs contain equipment topology (ControlArea, name, EIC codes). SSH graphs contain operational state (netInterchange values).
- **CGMA graphs** (`urn:cgma:{filepath}`) -- Converted from plain XML. TimeSeries with businessType (B65 = net position forecast, A66 = flow exchange), periods, and data points with position/quantity values.

Cross-graph SPARQL queries can join data from both datasets, e.g., matching a ControlArea's EIC code in IGM with the corresponding domain MRIDs in CGMA timeseries.

**Python backend:** Uses a hybrid storage model for performance:

- **IGM data** -- Stored as plain Python dicts (`EqRecord` and `SshRecord` typed dicts) rather than RDF triples. EQ records contain `control_area_id`, `name`, and `eic`. SSH records contain `control_area_id`, `scenario_time`, and `net_interchange`. Comparison is done via Python dict joins instead of SPARQL.
- **CGMA data** -- Still stored in an rdflib `ConjunctiveGraph` with named graphs (`urn:cgma:{filepath}`), queried via SPARQL. The CGMA dataset is small enough that SPARQL performance is not a bottleneck.

## Docker

A multi-stage Dockerfile is provided for Azure deployment (or any container runtime):

```bash
docker build -t cgma-igm-comparison .
docker run -p 8080:8080 \
  -e IGM_API_KEY=your-key \
  -e CGMA_API_KEY=your-key \
  -e IGM_API_HOST=https://your-igm-api \
  -e CGMA_API_HOST=https://your-cgma-api \
  cgma-igm-comparison
```

The image uses three build stages:

1. **Frontend build** (Node 20 Alpine) -- `npm ci` + `npm run build`
2. **Backend build** (Rust 1.85 Bookworm) -- `cargo build --release` with dependency caching
3. **Runtime** (Debian Bookworm slim) -- minimal image with the compiled binary and static frontend assets

The container listens on port 8080 by default (configurable via `PORT`).

## Testing

### Rust backend

Run the integration tests from the backend directory:

```bash
cd backend
cargo test
```

The test suite includes 15 tests (4 unit + 4 unit duplicate in bin + 7 integration) using real CIM/CGMA XML fixtures:


| Test                                        | What it verifies                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| `test_cgma_loading_produces_triples`        | CGMA XML parsing produces triples in the store                                 |
| `test_cgma_b65_query_returns_results`       | SPARQL query filtering `businessType = "B65"` returns expected data points     |
| `test_cgma_non_b65_excluded_by_filter`      | SPARQL filter correctly excludes non-B65 timeseries                            |
| `test_igm_loading_produces_triples`         | RDF/XML EQ + SSH loading produces triples                                      |
| `test_igm_control_area_query`               | Cross-graph SPARQL join finds ControlArea with netInterchange                  |
| `test_combined_store_holds_both_datasets`   | Both CGMA and IGM data coexist in a single store                               |
| `test_comparison_query_returns_joined_rows` | Full comparison pipeline: load both datasets, run query, verify joined DK1 row |
| `test_truncate_to_hour`                     | IGM scenarioTime truncation (unit)                                             |
| `test_cgma_timestamp_pt1h`                  | CGMA timestamp computation from period+position (unit)                         |
| `test_cgma_timestamp_with_seconds`          | CGMA timestamp with seconds format (unit)                                      |
| `test_strip_literal`                        | SPARQL literal string parsing (unit)                                           |

### Python backend

Run the test suite from the python-backend directory:

```bash
cd python-backend
python3 -m pytest tests/ -v
```

The Python test suite includes 33 tests covering all modules:

| Test file                    | Tests | What it verifies                                                                 |
| ---------------------------- | ----- | -------------------------------------------------------------------------------- |
| `test_file_loader.py`        | 3     | File reading, deduplication, missing file handling                                |
| `test_graph_store.py`        | 4     | rdflib store creation, RDF/XML loading, SPARQL query, clear                       |
| `test_igm_parser.py`         | 2     | IGM RDF/XML loading into named graphs, cross-graph ControlArea SPARQL query       |
| `test_igm_fast_parser.py`    | 4     | Fast ElementTree EQ/SSH parsing, record extraction, ID consistency                |
| `test_cgma_parser.py`        | 3     | CGMA XML-to-RDF conversion, B65 timeseries query, A66 filtering                  |
| `test_query.py`              | 8     | Time truncation, CGMA timestamps, fast comparison join, EQ deduplication          |
| `test_api.py`                | 4     | Health endpoint, combined store, timing logs, parallel loading                    |
| `test_load_response.py`      | 1     | LoadResponse model has data_available, message, and API entry count fields        |
| `test_availability_gate.py`  | 3     | Availability gate: returns unavailable when CGMA, IGM, or both are empty          |
| `test_cache_clear.py`        | 1     | Stale cache is cleared when data becomes unavailable                              |

### Frontend

```bash
cd frontend
bun run check          # Svelte/TypeScript type checking (or: npx svelte-check)
bun run build          # Verify production build succeeds
```

## Troubleshooting

### Backend panics on startup with "API key not set"

The Rust backend **panics** if either `IGM_API_KEY` or `CGMA_API_KEY` is missing. The Python backend will start but API calls will fail with 502 errors. Make sure you have a `.env` file with valid keys in the appropriate backend directory:

```bash
# Rust
cp backend/.env.example backend/.env

# Python
cp python-backend/.env.example python-backend/.env
```

### Frontend dev server can't reach the API

Make sure whichever backend you chose is running on port 3001 (the default). The Vite dev server proxies `/api/*` to `http://localhost:3001`. If you changed the backend port, update `frontend/vite.config.ts` accordingly.

### Python: `ModuleNotFoundError` or missing dependencies

Make sure you installed dependencies from the correct directory:

```bash
cd python-backend
python3 -m pip install -r requirements.txt
```

If you have multiple Python versions, ensure `python3` points to 3.10+. You can check with `python3 --version`.

### Python: `ConjunctiveGraph` / `Dataset` deprecation warnings

rdflib 7.x emits deprecation warnings from its internal SPARQL evaluator (`Dataset.default_context`, `Dataset.contexts`). These originate inside rdflib itself, not in our code, and do not affect functionality. They will be resolved in a future rdflib release.

### RDF/XML parse errors (InvalidIri)

CIM/CGMES files use `rdf:ID` and `rdf:about` with relative IRIs that require an `xml:base` attribute in the document root. If you see `InvalidIri` errors, the source XML file may be missing its `xml:base` declaration. This is a property of the input data, not a bug in the parser.

### ZIP extraction fails

The file loader expects ZIP archives to contain at least one `.xml` or `.rdf` file. If the archive uses a different structure or naming convention, the extraction will fail with a descriptive error that appears in the `errors` array of the load response.

### Slow first build (Rust)

The first `cargo build` compiles all dependencies from source (including Oxigraph and the TLS stack). This can take 2-5 minutes. Subsequent builds are incremental and much faster.

### API request failures

Both the IGM and CGMA clients have built-in retry logic with exponential backoff (up to 3 retries with 500ms, 1s, 2s delays). Transient network errors are automatically retried. If all retries fail, the error is returned to the frontend.