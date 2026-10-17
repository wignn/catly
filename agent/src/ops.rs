//! Operasi sekali-jalan: info, exec, proses, service systemd, jaringan, file, log.

use crate::{TokenQuery, VERSION};
use axum::{
    Json,
    body::Body,
    extract::{Multipart, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use axum::extract::ws::{Message, WebSocket};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::os::unix::fs::PermissionsExt;
use std::process::Stdio;
use sysinfo::{ProcessesToUpdate, System, Users};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

// ---------------------------------------------------------------- info

#[derive(Serialize)]
pub struct ServerInfo {
    pub hostname: String,
    pub os: String,
    pub kernel: String,
    pub arch: String,
    pub uptime_secs: u64,
    pub agent_version: &'static str,
}

pub async fn info() -> Json<ServerInfo> {
    Json(ServerInfo {
        hostname: System::host_name().unwrap_or_else(|| "unknown".into()),
        os: System::long_os_version().unwrap_or_else(|| System::os_version().unwrap_or_default()),
        kernel: System::kernel_version().unwrap_or_default(),
        arch: std::env::consts::ARCH.to_string(),
        uptime_secs: System::uptime(),
        agent_version: VERSION,
    })
}

// ---------------------------------------------------------------- exec

#[derive(Deserialize)]
pub struct ExecReq {
    pub command: String,
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
}
fn default_timeout() -> u64 {
    30
}

#[derive(Serialize)]
pub struct ExecRes {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub timed_out: bool,
}

pub async fn exec_cmd(Json(req): Json<ExecReq>) -> Json<ExecRes> {
    let timeout = std::time::Duration::from_secs(req.timeout_secs.clamp(1, 300));
    let run = async {
        Command::new("bash")
            .arg("-lc")
            .arg(&req.command)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
    };
    match tokio::time::timeout(timeout, run).await {
        Ok(Ok(out)) => Json(ExecRes {
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
            exit_code: out.status.code().unwrap_or(-1),
            timed_out: false,
        }),
        Ok(Err(e)) => Json(ExecRes {
            stdout: String::new(),
            stderr: format!("gagal menjalankan perintah: {e}"),
            exit_code: -1,
            timed_out: false,
        }),
        Err(_) => Json(ExecRes {
            stdout: String::new(),
            stderr: "timeout".into(),
            exit_code: -1,
            timed_out: true,
        }),
    }
}

// ---------------------------------------------------------------- proses

#[derive(Serialize)]
struct ProcInfo {
    pid: u32,
    user: String,
    name: String,
    cpu: f32,
    mem: f32,
    cmd: String,
}

#[derive(Deserialize)]
pub struct ProcQuery {
    #[serde(default = "default_limit")]
    pub limit: usize,
    #[serde(default = "default_sort")]
    pub sort: String,
}
fn default_limit() -> usize {
    200
}
fn default_sort() -> String {
    "cpu".into()
}

pub async fn list_processes(
    State(state): State<crate::AppState>,
    Query(q): Query<ProcQuery>,
) -> Json<serde_json::Value> {
    let users = Users::new_with_refreshed_list();
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let total_mem = sys.total_memory().max(1) as f32;
    let mut procs: Vec<ProcInfo> = sys
        .processes()
        .iter()
        .map(|(pid, p)| {
            let user = p
                .user_id()
                .and_then(|uid| users.get_user_by_id(uid))
                .map(|u| u.name().to_string())
                .unwrap_or_else(|| "?".into());
            ProcInfo {
                pid: pid.as_u32(),
                user,
                name: p.name().to_string_lossy().into_owned(),
                cpu: p.cpu_usage(),
                mem: p.memory() as f32 / total_mem * 100.0,
                cmd: p
                    .cmd()
                    .iter()
                    .map(|s| s.to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join(" "),
            }
        })
        .collect();
    match q.sort.as_str() {
        "mem" => procs.sort_by(|a, b| b.mem.partial_cmp(&a.mem).unwrap()),
        "pid" => procs.sort_by(|a, b| b.pid.cmp(&a.pid)),
        _ => procs.sort_by(|a, b| b.cpu.partial_cmp(&a.cpu).unwrap()),
    }
    procs.truncate(q.limit.clamp(1, 1000));
    Json(serde_json::json!({ "processes": procs }))
}

#[derive(Deserialize)]
pub struct KillReq {
    pub pid: u32,
    #[serde(default = "default_signal")]
    pub signal: String,
}
fn default_signal() -> String {
    "TERM".into()
}

pub async fn kill_process(Json(req): Json<KillReq>) -> Json<serde_json::Value> {
    if req.pid <= 1 {
        return Json(serde_json::json!({ "ok": false, "error": "menolak kill PID 0/1" }));
    }
    let sig = match req.signal.as_str() {
        "TERM" | "KILL" | "HUP" | "INT" => req.signal.as_str(),
        _ => "TERM",
    };
    let out = Command::new("kill")
        .arg(format!("-{sig}"))
        .arg(req.pid.to_string())
        .output()
        .await;
    match out {
        Ok(o) if o.status.success() => Json(serde_json::json!({ "ok": true })),
        Ok(o) => Json(serde_json::json!({ "ok": false,
            "error": String::from_utf8_lossy(&o.stderr).trim().to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

// ---------------------------------------------------------------- service systemd

#[derive(Serialize)]
struct ServiceInfo {
    unit: String,
    load: String,
    active: String,
    sub: String,
    description: String,
}

pub async fn list_services() -> Json<serde_json::Value> {
    let out = Command::new("systemctl")
        .args([
            "list-units", "--type=service", "--all", "--no-legend", "--no-pager",
        ])
        .output()
        .await;
    let mut services = Vec::new();
    if let Ok(out) = out {
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            let mut parts = line.split_whitespace();
            let (Some(unit), Some(load), Some(active), Some(sub)) =
                (parts.next(), parts.next(), parts.next(), parts.next())
            else {
                continue;
            };
            services.push(ServiceInfo {
                unit: unit.to_string(),
                load: load.to_string(),
                active: active.to_string(),
                sub: sub.to_string(),
                description: parts.collect::<Vec<_>>().join(" "),
            });
        }
    }
    Json(serde_json::json!({ "services": services }))
}

#[derive(Deserialize)]
pub struct ServiceActionReq {
    pub unit: String,
    pub action: String,
}

pub async fn service_action(Json(req): Json<ServiceActionReq>) -> Json<serde_json::Value> {
    if !req.unit.ends_with(".service") || req.unit.contains("..") || req.unit.contains('/') {
        return Json(serde_json::json!({ "ok": false, "error": "nama unit tidak valid" }));
    }
    let action = match req.action.as_str() {
        "start" | "stop" | "restart" | "reload" => req.action.as_str(),
        _ => return Json(serde_json::json!({ "ok": false, "error": "aksi tidak dikenal" })),
    };
    let res = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        Command::new("systemctl").arg(action).arg(&req.unit).output(),
    )
    .await;
    match res {
        Ok(Ok(o)) if o.status.success() => Json(serde_json::json!({ "ok": true })),
        Ok(Ok(o)) => Json(serde_json::json!({ "ok": false,
            "error": String::from_utf8_lossy(&o.stderr).trim().to_string() })),
        _ => Json(serde_json::json!({ "ok": false, "error": "gagal/timeout" })),
    }
}

// ---------------------------------------------------------------- jaringan

#[derive(Serialize)]
struct IfaceInfo {
    name: String,
    addrs: Vec<String>,
    mac: Option<String>,
}

#[derive(Serialize)]
struct SockInfo {
    proto: String,
    local: String,
    remote: String,
    state: String,
    process: String,
}

async fn run(cmd: &str, args: &[&str]) -> String {
    Command::new(cmd)
        .args(args)
        .output()
        .await
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default()
}

fn proc_name(parts: &[&str]) -> String {
    // format ss: users:(("nginx",pid=123,fd=3),("nginx",pid=124,fd=3))
    parts
        .join(" ")
        .split('"')
        .nth(1)
        .unwrap_or("")
        .to_string()
}

/// `ss -tlnp` / `ss -ulnp` → kolom: State Recv-Q Send-Q Local Peer Process
fn parse_listening(out: &str, proto: &str) -> Vec<SockInfo> {
    let mut v = Vec::new();
    for line in out.lines().skip(1) {
        let p: Vec<&str> = line.split_whitespace().collect();
        if p.len() < 5 {
            continue;
        }
        v.push(SockInfo {
            proto: proto.to_string(),
            local: p[3].to_string(),
            remote: String::new(),
            state: p[0].to_string(),
            process: proc_name(&p[5..]),
        });
    }
    v
}

/// `ss -tnp state established` → kolom: Recv-Q Send-Q Local Peer Process
/// (kolom State hilang karena sudah difilter)
fn parse_established(out: &str) -> Vec<SockInfo> {
    let mut v = Vec::new();
    for line in out.lines().skip(1) {
        let p: Vec<&str> = line.split_whitespace().collect();
        if p.len() < 4 {
            continue;
        }
        v.push(SockInfo {
            proto: "tcp".to_string(),
            local: p[2].to_string(),
            remote: p[3].to_string(),
            state: "ESTABLISHED".to_string(),
            process: proc_name(&p[4..]),
        });
    }
    v
}

pub async fn net_info() -> Json<serde_json::Value> {
    // interface + alamat
    let mut interfaces = Vec::new();
    for line in run("ip", &["-brief", "address"]).await.lines() {
        let mut p = line.split_whitespace();
        let (Some(name), Some(_state)) = (p.next(), p.next()) else {
            continue;
        };
        interfaces.push(IfaceInfo {
            name: name.to_string(),
            addrs: p.map(|s| s.to_string()).collect(),
            mac: None,
        });
    }

    let mut listening = parse_listening(&run("ss", &["-tlnp"]).await, "tcp");
    listening.extend(parse_listening(&run("ss", &["-ulnp"]).await, "udp"));
    let connections = parse_established(&run("ss", &["-tnp", "state", "established"]).await);

    let public_ip = tokio::time::timeout(
        std::time::Duration::from_secs(4),
        Command::new("curl")
            .args(["-s", "--max-time", "3", "https://api.ipify.org"])
            .output(),
    )
    .await
    .ok()
    .and_then(|r| r.ok())
    .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    .filter(|s| !s.is_empty())
    .unwrap_or_else(|| "unknown".into());

    Json(serde_json::json!({
        "public_ip": public_ip,
        "interfaces": interfaces,
        "listening": listening,
        "connections": connections,
    }))
}

// ---------------------------------------------------------------- file manager

fn clean_path(raw: &str) -> Result<std::path::PathBuf, Response> {
    let p = std::path::Path::new(raw);
    if !p.is_absolute() {
        return Err((StatusCode::from_u16(403).unwrap(),
            Json(serde_json::json!({"error":"path harus absolut"}))).into_response());
    }
    // tolak komponen parent-dir agar tidak lolos
    if p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err((StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error":"path tidak valid"}))).into_response());
    }
    Ok(p.to_path_buf())
}

#[derive(Deserialize)]
pub struct PathQuery {
    pub path: String,
}

#[derive(Serialize)]
struct FileEntry {
    name: String,
    kind: String,
    size: u64,
    mode: String,
    owner: String,
    group: String,
    modified: u64,
}

pub async fn list_files(Query(q): Query<PathQuery>) -> Result<Json<serde_json::Value>, Response> {
    let path = clean_path(&q.path)?;
    let read = std::fs::read_dir(&path).map_err(|e| {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": e.to_string()}))).into_response()
    })?;
    let users = Users::new();
    let mut entries = Vec::new();
    for e in read.flatten() {
        let md = match e.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let kind = if md.is_dir() {
            "dir"
        } else if md.is_symlink() {
            "link"
        } else {
            "file"
        }
        .to_string();
        entries.push(FileEntry {
            name: e.file_name().to_string_lossy().into_owned(),
            kind,
            size: md.len(),
            mode: format!("{:o}", md.permissions().mode() & 0o777),
            owner: String::new(),
            group: String::new(),
            modified: md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0),
        });
    }
    let _ = users;
    entries.sort_by(|a, b| (&a.kind, &a.name).cmp(&(&b.kind, &b.name)));
    Ok(Json(serde_json::json!({ "path": path.to_string_lossy(), "entries": entries })))
}

pub async fn read_file(Query(q): Query<PathQuery>) -> Result<Json<serde_json::Value>, Response> {
    let path = clean_path(&q.path)?;
    let data = std::fs::read(&path).map_err(|e| {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": e.to_string()}))).into_response()
    })?;
    if data.len() > 2 * 1024 * 1024 {
        return Err((StatusCode::from_u16(413).unwrap(),
            Json(serde_json::json!({"error":"file terlalu besar (>2MB), pakai download"}))).into_response());
    }
    let content = String::from_utf8(data).map_err(|_| {
        (StatusCode::from_u16(415).unwrap(),
            Json(serde_json::json!({"error":"file biner, pakai download"}))).into_response()
    })?;
    Ok(Json(serde_json::json!({ "path": q.path, "content": content })))
}

#[derive(Deserialize)]
pub struct WriteReq {
    pub path: String,
    pub content: String,
}

pub async fn write_file(Json(req): Json<WriteReq>) -> Result<Json<serde_json::Value>, Response> {
    let path = clean_path(&req.path)?;
    std::fs::write(&path, req.content).map_err(|e| {
        (StatusCode::from_u16(500).unwrap(),
            Json(serde_json::json!({"error": e.to_string()}))).into_response()
    })?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn download_file(Query(q): Query<PathQuery>) -> Result<Response, Response> {
    let path = clean_path(&q.path)?;
    let data = std::fs::read(&path).map_err(|e| {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": e.to_string()}))).into_response()
    })?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "download".into());
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{name}\""),
        )
        .body(Body::from(data))
        .unwrap())
}

pub async fn upload_file(
    Query(q): Query<PathQuery>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, Response> {
    let dir = clean_path(&q.path)?;
    if !dir.is_dir() {
        return Err((StatusCode::from_u16(400).unwrap(),
            Json(serde_json::json!({"error":"path harus direktori"}))).into_response());
    }
    let mut saved = Vec::new();
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        (StatusCode::from_u16(400).unwrap(),
            Json(serde_json::json!({"error": e.to_string()}))).into_response()
    })? {
        let name = field
            .file_name()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "upload.bin".into());
        let name = std::path::Path::new(&name)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "upload.bin".into());
        let data = field.bytes().await.map_err(|e| {
            (StatusCode::from_u16(400).unwrap(),
                Json(serde_json::json!({"error": e.to_string()}))).into_response()
        })?;
        let dest = dir.join(&name);
        std::fs::write(&dest, &data).map_err(|e| {
            (StatusCode::from_u16(500).unwrap(),
                Json(serde_json::json!({"error": e.to_string()}))).into_response()
        })?;
        saved.push(name);
    }
    Ok(Json(serde_json::json!({ "ok": true, "saved": saved })))
}

// ---------------------------------------------------------------- tail log

#[derive(Deserialize)]
pub struct LogsQuery {
    #[serde(flatten)]
    pub base: TokenQuery,
    pub unit: String,
}

pub async fn stream_logs(mut socket: WebSocket, unit: String) {
    if !unit.ends_with(".service") || unit.contains("..") || unit.contains('/') {
        return;
    }
    let mut child = match Command::new("journalctl")
        .args(["-u", &unit, "-f", "-n", "100", "--no-pager", "-o", "cat"])
        .stdout(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return,
    };
    let stdout = child.stdout.take().unwrap();
    let mut lines = BufReader::new(stdout).lines();
    loop {
        tokio::select! {
            line = lines.next_line() => {
                match line {
                    Ok(Some(l)) => {
                        let msg = serde_json::json!({ "t": "line", "data": l }).to_string();
                        if socket.send(Message::Text(msg)).await.is_err() { break; }
                    }
                    _ => break,
                }
            }
            msg = socket.next() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
    let _ = child.kill().await;
}
