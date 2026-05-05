mod cgma_client;
mod cgma_parser;
mod config;
mod file_loader;
mod graph_store;
mod igm_client;
mod igm_parser;
mod query;
mod retry;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::routing::post;
use axum::{Json, Router, extract::{State, Query}, http::StatusCode, routing::get};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

use crate::cgma_client::CgmaClient;
use crate::cgma_parser::load_cgma_file;
use crate::config::Config;
use crate::file_loader::{FileDeduplicator, read_file_content};
use crate::graph_store::GraphStore;
use crate::igm_client::IgmClient;
use crate::igm_parser::load_igm_file;
use crate::query::run_comparison_query;

#[derive(Clone)]
struct AppState {
    config: Arc<Config>,
    igm_client: Arc<IgmClient>,
    cgma_client: Arc<CgmaClient>,
    store: Arc<RwLock<Option<GraphStore>>>,
    last_load_key: Arc<RwLock<Option<String>>>,
}

#[derive(Deserialize)]
struct LoadRequest {
    date: String,
    scenario: String,
}

#[derive(Serialize)]
struct LoadResponse {
    igm_files_loaded: usize,
    cgma_files_loaded: usize,
    total_triples: usize,
    errors: Vec<String>,
}

#[derive(Deserialize)]
struct AvailabilityQuery {
    date: String,
    scenario: String,
}

#[derive(Serialize)]
struct AvailabilityResponse {
    date: String,
    scenario: String,
    igm_api_entries: usize,
    cgma_api_entries: usize,
    available: bool,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    dotenvy::dotenv().ok();

    let config = Config::from_env();
    let igm_client = Arc::new(IgmClient::new(
        config.igm_api_host.clone(),
        config.igm_api_key.clone(),
    ));
    let cgma_client = Arc::new(CgmaClient::new(
        config.cgma_api_host.clone(),
        config.cgma_api_key.clone(),
    ));
    let state = AppState {
        config: Arc::new(config.clone()),
        igm_client,
        cgma_client,
        store: Arc::new(RwLock::new(None)),
        last_load_key: Arc::new(RwLock::new(None)),
    };

    let app = Router::new()
        .route("/api/health", get(|| async { "ok" }))
        .route("/api/scenarios", get(get_scenarios))
        .route("/api/available", get(get_available))
        .route("/api/load", post(load_data))
        .route("/api/query", post(query_comparison))
        .fallback_service(ServeDir::new("../frontend/build").append_index_html_on_directories(true))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    tracing::info!("Backend listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn get_scenarios(
    State(state): State<AppState>,
) -> Result<Json<Vec<String>>, StatusCode> {
    state
        .igm_client
        .get_scenarios()
        .await
        .map(Json)
        .map_err(|e| {
            tracing::error!("Failed to fetch scenarios: {e}");
            StatusCode::BAD_GATEWAY
        })
}

async fn get_available(
    State(state): State<AppState>,
    Query(params): Query<AvailabilityQuery>,
) -> Result<Json<AvailabilityResponse>, (StatusCode, String)> {
    let igm_entries = state
        .igm_client
        .get_control_area_day(&params.date, &params.scenario)
        .await
        .map_err(|e| {
            tracing::error!("IGM availability check failed: {e}");
            (StatusCode::BAD_GATEWAY, format!("IGM API error: {e}"))
        })?;

    let cgma_docs = state
        .cgma_client
        .get_filepaths(&params.date)
        .await
        .map_err(|e| {
            tracing::error!("CGMA availability check failed: {e}");
            (StatusCode::BAD_GATEWAY, format!("CGMA API error: {e}"))
        })?;

    let igm_count = igm_entries.len();
    let cgma_count = cgma_docs.len();

    Ok(Json(AvailabilityResponse {
        date: params.date,
        scenario: params.scenario,
        igm_api_entries: igm_count,
        cgma_api_entries: cgma_count,
        available: igm_count > 0 && cgma_count > 0,
    }))
}

async fn load_data(
    State(state): State<AppState>,
    Json(req): Json<LoadRequest>,
) -> Result<Json<LoadResponse>, (StatusCode, String)> {
    // Check cache: skip re-fetching if same date+scenario
    let load_key = format!("{}:{}", req.date, req.scenario);
    {
        let cached = state.last_load_key.read().await;
        if cached.as_deref() == Some(&load_key) {
            if let Some(store) = state.store.read().await.as_ref() {
                return Ok(Json(LoadResponse {
                    igm_files_loaded: 0,
                    cgma_files_loaded: 0,
                    total_triples: store.len(),
                    errors: vec!["Using cached data".into()],
                }));
            }
        }
    }

    let store = GraphStore::new()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut dedup = FileDeduplicator::default();
    let mut errors = Vec::new();
    let mut igm_count = 0;
    let mut cgma_count = 0;

    // 1. Fetch IGM file paths
    let igm_entries = state
        .igm_client
        .get_control_area_day(&req.date, &req.scenario)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("IGM API error: {e}")))?;

    // 2. Load EQ files (deduplicated) then SSH files
    for entry in &igm_entries {
        if dedup.should_load(&entry.eq_location) {
            match read_file_content(&entry.eq_location) {
                Ok(content) => {
                    if let Err(e) = load_igm_file(&store, &content, &entry.eq_location, None) {
                        errors.push(format!("EQ parse error: {e}"));
                    } else {
                        igm_count += 1;
                    }
                }
                Err(e) => errors.push(format!("EQ file error: {e}")),
            }
        }

        if dedup.should_load(&entry.ssh_location) {
            match read_file_content(&entry.ssh_location) {
                Ok(content) => {
                    // Skip the version triple when upstream omits the version
                    // (empty string) so the "no version" path matches the
                    // integration test and never inserts an empty-literal triple.
                    let version = if entry.ssh_version.is_empty() {
                        None
                    } else {
                        Some(entry.ssh_version.as_str())
                    };
                    if let Err(e) = load_igm_file(
                        &store,
                        &content,
                        &entry.ssh_location,
                        version,
                    ) {
                        errors.push(format!("SSH parse error: {e}"));
                    } else {
                        igm_count += 1;
                    }
                }
                Err(e) => errors.push(format!("SSH file error: {e}")),
            }
        }
    }

    // 3. Fetch CGMA file paths
    let cgma_docs = state
        .cgma_client
        .get_filepaths(&req.date)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("CGMA API error: {e}")))?;

    // 4. Load CGMA files
    for doc in &cgma_docs {
        if dedup.should_load(&doc.filepath) {
            match read_file_content(&doc.filepath) {
                Ok(content) => {
                    if let Err(e) = load_cgma_file(&store, &content, &doc.filepath) {
                        errors.push(format!("CGMA parse error: {e}"));
                    } else {
                        cgma_count += 1;
                    }
                }
                Err(e) => errors.push(format!("CGMA file error: {e}")),
            }
        }
    }

    let total_triples = store.len();

    // 5. Store the graph in app state and update cache key
    *state.store.write().await = Some(store);
    *state.last_load_key.write().await = Some(load_key);

    Ok(Json(LoadResponse {
        igm_files_loaded: igm_count,
        cgma_files_loaded: cgma_count,
        total_triples,
        errors,
    }))
}

async fn query_comparison(
    State(state): State<AppState>,
) -> Result<Json<Vec<query::ComparisonRow>>, (StatusCode, String)> {
    let guard = state.store.read().await;
    let store = guard
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "No data loaded. Call /api/load first.".into()))?;

    let rows = run_comparison_query(store)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Query error: {e}")))?;

    Ok(Json(rows))
}
