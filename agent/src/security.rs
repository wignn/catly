use axum::{extract::State, http::StatusCode, Extension, Json};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    io::{Read, Write},
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
};

#[derive(Clone, Copy)]
pub struct Role(pub &'static str);

#[derive(Serialize, Clone)]
pub struct AuditEntry {
    pub ts: u64,
    pub method: String,
    pub path: String,
    pub status: u16,
    pub role: String,
}

pub struct Security {
    pub admin: String,
    pub readonly: String,
    pub directory: PathBuf,
    pub audit: VecDeque<AuditEntry>,
}
impl Security {
    pub fn role(&self, token: &str) -> Option<Role> {
        if !token.is_empty() && token == self.admin {
            Some(Role("admin"))
        } else if !token.is_empty() && token == self.readonly {
            Some(Role("readonly"))
        } else {
            None
        }
    }
    pub fn record(&mut self, method: &str, path: &str, status: u16, role: &str) {
        if self.audit.len() == 200 {
            self.audit.pop_front();
        }
        // Only known route templates are retained: never URLs, query strings or request bodies.
        self.audit.push_back(AuditEntry {
            ts: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            method: method.into(),
            path: path.into(),
            status,
            role: role.into(),
        });
    }
}
pub fn random_token() -> std::io::Result<String> {
    let mut bytes = [0u8; 32];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

pub fn save_token(path: &Path, token: &str) -> std::io::Result<()> {
    let temp = path.with_extension(format!("{}.new", random_token()?));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)?;
        file.write_all(token.as_bytes())?;
        file.sync_all()?;
        std::fs::rename(&temp, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temp);
    }
    result
}
pub fn load() -> std::io::Result<Security> {
    let directory = if Path::new("/etc/vps-agent").is_dir() {
        PathBuf::from("/etc/vps-agent")
    } else {
        PathBuf::from(".")
    };
    let admin_path = directory.join("token");
    let admin = std::fs::read_to_string(&admin_path)
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_owned())
        .or_else(|| {
            std::env::var("VPS_AGENT_TOKEN")
                .ok()
                .filter(|s| !s.trim().is_empty())
        });
    let admin = match admin {
        Some(t) => t,
        None => {
            let t = random_token()?;
            save_token(&admin_path, &t)?;
            t
        }
    };
    let readonly = std::fs::read_to_string(directory.join("readonly-token"))
        .unwrap_or_default()
        .trim()
        .to_owned();
    Ok(Security {
        admin,
        readonly,
        directory,
        audit: VecDeque::new(),
    })
}
#[derive(Deserialize)]
pub struct RotateReq {
    kind: String,
}
pub async fn rotate(
    State(state): State<crate::AppState>,
    Json(req): Json<RotateReq>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !matches!(req.kind.as_str(), "admin" | "readonly") {
        return Err(StatusCode::BAD_REQUEST);
    }
    let token = random_token().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut security = state.security.lock().unwrap();
    let name = if req.kind == "admin" {
        "token"
    } else {
        "readonly-token"
    };
    save_token(&security.directory.join(name), &token)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if req.kind == "admin" {
        security.admin = token.clone();
    } else {
        security.readonly = token.clone();
    }
    Ok(Json(serde_json::json!({"token":token,"kind":req.kind})))
}
pub async fn audit(State(state): State<crate::AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({"entries":state.security.lock().unwrap().audit}))
}
pub async fn diagnostics(
    State(state): State<crate::AppState>,
    Extension(role): Extension<Role>,
) -> Json<serde_json::Value> {
    let tailscale = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        tokio::process::Command::new("tailscale")
            .args(["ip", "-4"])
            .output(),
    )
    .await
    .ok()
    .and_then(Result::ok)
    .and_then(|o| String::from_utf8(o.stdout).ok())
    .and_then(|s| {
        s.lines()
            .find_map(|line| line.trim().parse::<std::net::Ipv4Addr>().ok())
    })
    .map(|ip| ip.to_string());
    Json(
        serde_json::json!({"bind":state.bind,"tailscale_ip":tailscale,"agent_version":crate::VERSION,"role":role.0}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rotating_a_clone_invalidates_existing_token_and_persists() {
        let dir = std::env::temp_dir().join(format!("vps-token-{}", random_token().unwrap()));
        std::fs::create_dir(&dir).unwrap();
        let security = std::sync::Arc::new(std::sync::Mutex::new(Security {
            admin: "old".into(),
            readonly: "viewer".into(),
            directory: dir.clone(),
            audit: VecDeque::new(),
        }));
        let clone = security.clone();
        let token = random_token().unwrap();
        save_token(&dir.join("token"), &token).unwrap();
        security.lock().unwrap().admin = token.clone();
        assert!(clone.lock().unwrap().role("old").is_none());
        assert_eq!(clone.lock().unwrap().role(&token).unwrap().0, "admin");
        assert_eq!(std::fs::read_to_string(dir.join("token")).unwrap(), token);
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(dir.join("token"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        for _ in 0..300 {
            security
                .lock()
                .unwrap()
                .record("POST", "/api/exec", 200, "admin");
        }
        assert_eq!(security.lock().unwrap().audit.len(), 200);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
