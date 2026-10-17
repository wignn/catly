//! Terminal PTY interaktif via WebSocket.
//! Satu koneksi WS = satu sesi shell ($SHELL atau /bin/bash --login).
//! Protokol JSON, lihat docs/AGENT_PROTOCOL.md.

use axum::extract::ws::{Message, WebSocket};
use futures_util::StreamExt;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

#[derive(Deserialize)]
struct ClientMsg {
    t: String,
    data: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
}

#[derive(Serialize)]
#[serde(tag = "t")]
enum ServerMsg<'a> {
    #[serde(rename = "output")]
    Output { data: &'a str },
    #[serde(rename = "exit")]
    Exit { code: i32 },
}

pub async fn handle(
    socket: WebSocket,
    cols: u16,
    rows: u16,
    state: crate::AppState,
    token: String,
) {
    if state.security.lock().unwrap().role(&token).map(|r| r.0) != Some("admin") {
        return;
    }
    state
        .security
        .lock()
        .unwrap()
        .record("WS", "/ws/pty", 101, "admin");
    let mut socket = socket;

    let pty_system = native_pty_system();
    let pair = match pty_system.openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(p) => p,
        Err(e) => {
            let msg = serde_json::to_string(&ServerMsg::Exit { code: -1 }).unwrap();
            let _ = socket.send(Message::Text(msg)).await;
            eprintln!("[pty] gagal buka pty: {e}");
            return;
        }
    };

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.env("TERM", "xterm-256color");
    if let Ok(home) = std::env::var("HOME") {
        cmd.cwd(home);
    }

    let mut child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => {
            let msg = serde_json::to_string(&ServerMsg::Exit { code: -1 }).unwrap();
            let _ = socket.send(Message::Text(msg)).await;
            eprintln!("[pty] gagal spawn {shell}: {e}");
            return;
        }
    };
    drop(pair.slave);

    let mut reader = match pair.master.try_clone_reader() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[pty] gagal clone reader: {e}");
            return;
        }
    };
    let writer = match pair.master.take_writer() {
        Ok(w) => Arc::new(Mutex::new(w)),
        Err(e) => {
            eprintln!("[pty] gagal ambil writer: {e}");
            return;
        }
    };
    let master = pair.master;

    // Task pembaca: PTY -> channel
    let (tx_out, mut rx_out) = mpsc::channel::<Vec<u8>>(128);
    let reader_task = tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if tx_out.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let mut exit_interval = tokio::time::interval(std::time::Duration::from_millis(250));
    let mut closed = false;

    while !closed {
        tokio::select! {
            msg = socket.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if state.security.lock().unwrap().role(&token).map(|r| r.0) != Some("admin") { break; }
                        if let Ok(cm) = serde_json::from_str::<ClientMsg>(&text) {
                            match cm.t.as_str() {
                                "input" => {
                                    if let Some(data) = cm.data {
                                        let w = writer.clone();
                                        // tulis di blocking task agar tidak menahan runtime
                                        let bytes = data.into_bytes();
                                        tokio::task::spawn_blocking(move || {
                                            use std::io::Write;
                                            let _ = w.lock().unwrap().write_all(&bytes);
                                        });
                                    }
                                }
                                "resize" => {
                                    let c = cm.cols.unwrap_or(cols).clamp(20, 500);
                                    let r = cm.rows.unwrap_or(rows).clamp(5, 200);
                                    let _ = master.resize(PtySize { rows: r, cols: c, pixel_width: 0, pixel_height: 0 });
                                }
                                _ => {}
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => { closed = true; }
                    _ => {}
                }
            }
            Some(data) = rx_out.recv() => {
                let text = String::from_utf8_lossy(&data);
                let msg = serde_json::to_string(&ServerMsg::Output { data: &text }).unwrap();
                if socket.send(Message::Text(msg)).await.is_err() {
                    closed = true;
                }
            }
            _ = exit_interval.tick() => {
                if state.security.lock().unwrap().role(&token).map(|r| r.0) != Some("admin") { break; }
                match child.try_wait() {
                    Ok(Some(status)) => {
                        let msg = serde_json::to_string(&ServerMsg::Exit { code: status.exit_code() as i32 }).unwrap();
                        let _ = socket.send(Message::Text(msg)).await;
                        closed = true;
                    }
                    Ok(None) => {}
                    Err(_) => { closed = true; }
                }
            }
        }
    }

    reader_task.abort();
    let _ = child.kill();
    let _ = socket.send(Message::Close(None)).await;
}
