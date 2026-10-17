//! vps-agent: HTTP + WebSocket agent yang berjalan di setiap VPS.
//! Menyediakan: info, metrik realtime, terminal PTY, exec, proses, service systemd,
//! info jaringan, file manager, dan tail log. Lihat docs/AGENT_PROTOCOL.md.

mod metrics;
mod ops;
mod pty;

use axum::{
    Json, Router,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
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
    pub token: String,
    pub sys: Arc<Mutex<System>>,
    pub net_prev: Arc<Mutex<HashMap<String, (u64, u64, Instant)>>>,
}

impl AppState {
    fn bearer_ok(&self, headers: &HeaderMap) -> bool {
        headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.strip_prefix("Bearer "))
            .map(|t| t == self.token)
            .unwrap_or(false)
    }
}

#[derive(Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

fn ws_token_ok(state: &AppState, q: &TokenQuery) -> bool {
    q.token.as_deref() == Some(state.token.as_str())
}

/// Middleware autentikasi untuk semua route /api/*
async fn auth_middleware(
    State(state): State<AppState>,
    headers: HeaderMap,
    req: axum::http::Request<axum::body::Body>,
    next: Next,
) -> Response {
    if !state.bearer_ok(&headers) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "unauthorized" })),
        )
            .into_response();
    }
    next.run(req).await
}

async fn ws_metrics(
    ws: axum::extract::ws::WebSocketUpgrade,
    Query(q): Query<TokenQuery>,
    State(state): State<AppState>,
) -> Response {
    if !ws_token_ok(&state, &q) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    ws.on_upgrade(move |socket| metrics::stream_metrics(socket, state))
}

async fn ws_pty(
    ws: axum::extract::ws::WebSocketUpgrade,
    Query(q): Query<PtyQuery>,
    State(state): State<AppState>,
) -> Response {
    if !ws_token_ok(&state, &q.base) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let cols = q.cols.unwrap_or(120).clamp(20, 500);
    let rows = q.rows.unwrap_or(30).clamp(5, 200);
    ws.on_upgrade(move |socket| pty::handle(socket, cols, rows))
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
    if !ws_token_ok(&state, &q.base) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    ws.on_upgrade(move |socket| ops::stream_logs(socket, q.unit))
}

fn load_or_generate_token() -> String {
    if let Ok(t) = std::env::var("VPS_AGENT_TOKEN") {
        let t = t.trim().to_string();
        if !t.is_empty() {
            return t;
        }
    }
    for p in ["/etc/vps-agent/token", "./token"] {
        if let Ok(t) = std::fs::read_to_string(p) {
            let t = t.trim().to_string();
            if !t.is_empty() {
                eprintln!("[vps-agent] token dimuat dari {p}");
                return t;
            }
        }
    }
    // Buat token acak baru
    let raw = std::fs::read("/dev/urandom").expect("tidak bisa baca /dev/urandom");
    let token: String = raw.iter().take(32).map(|b| format!("{b:02x}")).collect();
    let _ = std::fs::write("./token", &token);
    eprintln!("================================================================");
    eprintln!("[vps-agent] TOKEN BARU dibuat (simpan di client Windows!):");
    eprintln!("[vps-agent] {token}");
    eprintln!("[vps-agent] Token juga tersimpan di ./token (mode file: baca manual)");
    eprintln!("================================================================");
    token
}

#[tokio::main]
async fn main() {
    let token = load_or_generate_token();

    // Warmup agar pembacaan CPU pertama tidak 0
    let mut sys = System::new_all();
    sys.refresh_cpu_all();
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    sys.refresh_cpu_all();

    let state = AppState {
        token,
        sys: Arc::new(Mutex::new(sys)),
        net_prev: Arc::new(Mutex::new(HashMap::new())),
    };

    let api = Router::new()
        .route("/info", get(ops::info))
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
        .layer(CorsLayer::permissive())
        .with_state(state);

    let bind: String =
        std::env::var("VPS_AGENT_BIND").unwrap_or_else(|_| "0.0.0.0:18710".to_string());
    let addr: SocketAddr = bind.parse().expect("VPS_AGENT_BIND tidak valid");
    eprintln!("[vps-agent] v{VERSION} mendengarkan di {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
