use axum::{extract::State, http::StatusCode, Json};
use serde::Deserialize;

pub async fn status() -> Json<serde_json::Value> {
    let mut result = std::fs::read("/opt/vps-agent/update-status.json")
        .ok()
        .filter(|b| b.len() <= 8192)
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .unwrap_or_else(|| serde_json::json!({"state":"idle"}));
    result["installed_version"] = crate::VERSION.into();
    result["rollback_available"] = std::path::Path::new("/opt/vps-agent/vps-agent.previous")
        .is_file()
        .into();
    Json(result)
}
#[derive(Deserialize)]
pub struct UpdateReq {
    action: String,
}
pub async fn update(
    State(_state): State<crate::AppState>,
    Json(req): Json<UpdateReq>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !matches!(req.action.as_str(), "update" | "rollback") {
        return Err(StatusCode::BAD_REQUEST);
    }
    let output = tokio::process::Command::new("systemctl")
        .args([
            "start",
            "--no-block",
            &format!("vps-agent-update@{}.service", req.action),
        ])
        .output()
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    if !output.status.success() {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }
    Ok(Json(serde_json::json!({"ok":true})))
}
