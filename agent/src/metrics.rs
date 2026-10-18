//! Pengambilan metrik sistem: CPU, load, memori, swap, disk, jaringan.

use crate::AppState;
use axum::extract::ws::{Message, WebSocket};
use axum::{extract::State, http::StatusCode, Json};
use futures_util::StreamExt;
use serde::Serialize;
use std::{
    collections::HashMap,
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use sysinfo::{Disks, Networks, System};

#[derive(Serialize)]
pub struct CpuInfo {
    pub total: f32,
    pub per_core: Vec<f32>,
}

#[derive(Serialize)]
pub struct MemInfo {
    pub total: u64,
    pub used: u64,
    pub free: u64,
    pub available: u64,
}

#[derive(Serialize)]
pub struct DiskInfo {
    pub mount: String,
    pub total: u64,
    pub used: u64,
}

#[derive(Serialize)]
pub struct NetInfo {
    pub iface: String,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    pub rx_rate: f64,
    pub tx_rate: f64,
}

#[derive(Serialize)]
pub struct MetricsSnapshot {
    pub ts: u64,
    pub cpu: CpuInfo,
    pub load: [f64; 3],
    pub mem: MemInfo,
    pub swap: MemInfo,
    pub disks: Vec<DiskInfo>,
    pub net: Vec<NetInfo>,
}

fn now_ts() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn snapshot(
    sys: &mut System,
    net_prev: &mut HashMap<String, (u64, u64, Instant)>,
) -> MetricsSnapshot {
    sys.refresh_cpu_all();
    sys.refresh_memory();

    let per_core: Vec<f32> = sys.cpus().iter().map(|c| c.cpu_usage()).collect();
    let total = if per_core.is_empty() {
        0.0
    } else {
        per_core.iter().sum::<f32>() / per_core.len() as f32
    };

    let load = System::load_average();

    let disks = Disks::new_with_refreshed_list();
    let mut disk_infos: Vec<DiskInfo> = disks
        .list()
        .iter()
        .map(|d| {
            let total = d.total_space();
            let used = total.saturating_sub(d.available_space());
            DiskInfo {
                mount: d.mount_point().to_string_lossy().into_owned(),
                total,
                used,
            }
        })
        .collect();
    disk_infos.sort_by(|a, b| a.mount.cmp(&b.mount));

    let nets = Networks::new_with_refreshed_list();
    let now = Instant::now();
    let mut net_infos: Vec<NetInfo> = nets
        .list()
        .iter()
        .filter(|(name, _)| name.as_str() != "lo")
        .map(|(name, n)| {
            let iface = name.as_str();
            let rx = n.received();
            let tx = n.transmitted();
            let (rx_rate, tx_rate) = match net_prev.get(iface) {
                Some((prx, ptx, t)) => {
                    let dt = now.duration_since(*t).as_secs_f64().max(0.001);
                    (
                        rx.saturating_sub(*prx) as f64 / dt,
                        tx.saturating_sub(*ptx) as f64 / dt,
                    )
                }
                None => (0.0, 0.0),
            };
            net_prev.insert(iface.to_string(), (rx, tx, now));
            NetInfo {
                iface: iface.to_string(),
                rx_bytes: rx,
                tx_bytes: tx,
                rx_rate,
                tx_rate,
            }
        })
        .collect();
    net_infos.sort_by(|a, b| a.iface.cmp(&b.iface));

    MetricsSnapshot {
        ts: now_ts(),
        cpu: CpuInfo { total, per_core },
        load: [load.one, load.five, load.fifteen],
        mem: MemInfo {
            total: sys.total_memory(),
            used: sys.used_memory(),
            free: sys.free_memory(),
            available: sys.available_memory(),
        },
        swap: MemInfo {
            total: sys.total_swap(),
            used: sys.used_swap(),
            free: sys.free_swap(),
            available: sys.free_swap(),
        },
        disks: disk_infos,
        net: net_infos,
    }
}

async fn collect(state: AppState) -> Result<MetricsSnapshot, StatusCode> {
    // Disk/CPU enumeration and mutex waits must not block terminal socket handling.
    tokio::task::spawn_blocking(move || {
        let mut sys = state.sys.lock().unwrap();
        let mut prev = state.net_prev.lock().unwrap();
        snapshot(&mut sys, &mut prev)
    }).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

pub async fn http_metrics(State(state): State<AppState>) -> Result<Json<MetricsSnapshot>, StatusCode> {
    collect(state).await.map(Json)
}

/// Stream metrik tiap 1 detik via WebSocket.
pub async fn stream_metrics(mut socket: WebSocket, state: AppState, token: String) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
    loop {
        tokio::select! {
            _ = interval.tick() => {
                if state.security.lock().unwrap().role(&token).is_none() {
                    break;
                }
                let snap = match collect(state.clone()).await {
                    Ok(snap) => snap,
                    Err(_) => break,
                };
                let text = serde_json::to_string(&snap).unwrap();
                if socket.send(Message::Text(text)).await.is_err() {
                    break;
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
}
