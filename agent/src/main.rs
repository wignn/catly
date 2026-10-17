//! vps-agent: HTTP + WebSocket agent yang berjalan di setiap VPS.
//! Menyediakan: info, metrik realtime, terminal PTY, exec, proses, service systemd,
//! info jaringan, file manager, dan tail log. Lihat docs/AGENT_PROTOCOL.md.

mod maintenance;
mod metrics;
mod ops;
mod pty;
mod security;
mod security_policy;

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::Instant,
};
use sysinfo::System;
use tower_http::cors::CorsLayer;

pub const VERSION: &str = "0.1.0";

#[derive(Clone)]
pub struct AppState {
    pub security: Arc<Mutex<security::Security>>,
    pub bind: String,
    pub sys: Arc<Mutex<System>>,
    pub net_prev: Arc<Mutex<HashMap<String, (u64, u64, Instant)>>>,
}

#[derive(Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

fn ws_token_ok(state: &AppState, q: &TokenQuery, path: &str) -> bool {
    q.token
        .as_deref()
        .and_then(|t| state.security.lock().unwrap().role(t))
        .map(|role| security_policy::allowed(role.0, "GET", path))
        .unwrap_or(false)
}

/// Middleware autentikasi untuk semua route /api/*
async fn auth_middleware(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut req: axum::http::Request<axum::body::Body>,
    next: Next,
) -> Response {
    let role = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .and_then(|t| state.security.lock().unwrap().role(t));
    let Some(role) = role else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let route = req
        .extensions()
        .get::<axum::extract::MatchedPath>()
        .map(|p| p.as_str())
        .unwrap_or("unknown");
    let path = if route.starts_with("/api/") {
        route.to_owned()
    } else {
        format!("/api{route}")
    };
    let method = req.method().as_str().to_owned();
    if !security_policy::allowed(role.0, &method, &path) {
        if method != "GET" {
            state
                .security
                .lock()
                .unwrap()
                .record(&method, &path, 403, role.0);
        }
        return StatusCode::FORBIDDEN.into_response();
    }
    req.extensions_mut().insert(role);
    let response = next.run(req).await;
    if method != "GET" {
        state
            .security
            .lock()
            .unwrap()
            .record(&method, &path, response.status().as_u16(), role.0);
    }
    response
}

async fn ws_metrics(
    ws: axum::extract::ws::WebSocketUpgrade,
    Query(q): Query<TokenQuery>,
    State(state): State<AppState>,
) -> Response {
    if !ws_token_ok(&state, &q, "/ws/metrics") {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    ws.on_upgrade(move |socket| metrics::stream_metrics(socket, state, q.token.unwrap()))
}

async fn ws_pty(
    ws: axum::extract::ws::WebSocketUpgrade,
    Query(q): Query<PtyQuery>,
    State(state): State<AppState>,
) -> Response {
    if !ws_token_ok(&state, &q.base, "/ws/pty") {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let cols = q.cols.unwrap_or(120).clamp(20, 500);
    let rows = q.rows.unwrap_or(30).clamp(5, 200);
    ws.on_upgrade(move |socket| pty::handle(socket, cols, rows, state, q.base.token.unwrap()))
}

#[derive(Deserialize)]
struct PtyQuery {
    #[serde(flatten)]
    base: TokenQuery,
    cols: Option<u16>,
    rows: Option<u16>,
}

async fn ws_logs(
    ws: axum::extract::ws::WebSocketUpgrade,
    Query(q): Query<ops::LogsQuery>,
    State(state): State<AppState>,
) -> Response {
    if !ws_token_ok(&state, &q.base, "/ws/logs") {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    ws.on_upgrade(move |socket| ops::stream_logs(socket, q.unit, state, q.base.token.unwrap()))
}

#[tokio::main]
async fn main() {
    let security = security::load().expect("cannot load or persist agent tokens");
    let bind = std::env::var("VPS_AGENT_BIND").unwrap_or_else(|_| "127.0.0.1:18710".into());

    // Warmup agar pembacaan CPU pertama tidak 0
    let mut sys = System::new_all();
    sys.refresh_cpu_all();
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    sys.refresh_cpu_all();

    let state = AppState {
        security: Arc::new(Mutex::new(security)),
        bind: bind.clone(),
        sys: Arc::new(Mutex::new(sys)),
        net_prev: Arc::new(Mutex::new(HashMap::new())),
    };

    let api = Router::new()
        .route("/info", get(ops::info))
        .route("/diagnostics", get(security::diagnostics))
        .route("/security/rotate", post(security::rotate))
        .route("/security/audit", get(security::audit))
        .route("/update/status", get(maintenance::status))
        .route("/update", post(maintenance::update))
        .route("/metrics", get(metrics::http_metrics))
        .route("/exec", post(ops::exec_cmd))
        .route("/processes", get(ops::list_processes))
        .route("/processes/kill", post(ops::kill_process))
        .route("/services", get(ops::list_services))
        .route("/services/action", post(ops::service_action))
        .route("/net", get(ops::net_info))
        .route("/files", get(ops::list_files))
        .route("/files/read", get(ops::read_file))
        .route("/files/write", post(ops::write_file))
        .route("/files/download", get(ops::download_file))
        .route("/files/upload", post(ops::upload_file))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    let app = Router::new()
        .route("/ws/metrics", get(ws_metrics))
        .route("/ws/pty", get(ws_pty))
        .route("/ws/logs", get(ws_logs))
        .nest("/api", api)
        .layer(axum::extract::DefaultBodyLimit::max(34 * 1024 * 1024))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr: SocketAddr = bind.parse().expect("VPS_AGENT_BIND tidak valid");
    eprintln!("[vps-agent] v{VERSION} mendengarkan di {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
