pub fn allowed(role: &str, method: &str, path: &str) -> bool {
    role == "admin"
        || (role == "readonly"
            && method == "GET"
            && matches!(
                path,
                "/api/info"
                    | "/api/metrics"
                    | "/api/services"
                    | "/api/diagnostics"
                    | "/api/update/status"
                    | "/ws/metrics"
            ))
}

pub fn service_unit(unit: &str) -> bool {
    unit.len() > 8
        && unit.len() <= 255
        && unit.ends_with(".service")
        && !unit.starts_with('-')
        && !unit.contains("..")
        && unit
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.@:".contains(&b))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn readonly_has_only_monitoring_access() {
        for path in [
            "/api/info",
            "/api/metrics",
            "/api/services",
            "/api/diagnostics",
            "/api/update/status",
            "/ws/metrics",
        ] {
            assert!(allowed("readonly", "GET", path), "{path}");
            assert!(!allowed("readonly", "POST", path));
        }
        for path in [
            "/api/files",
            "/api/net",
            "/api/processes",
            "/api/exec",
            "/ws/pty",
            "/ws/logs",
            "/api/security/audit",
        ] {
            assert!(!allowed("readonly", "GET", path), "{path}");
        }
    }
    #[test]
    fn rejects_systemctl_options_and_path_traversal() {
        for unit in [
            "--help.service",
            "../a.service",
            "a/b.service",
            "a b.service",
            "a\n.service",
            ".service",
        ] {
            assert!(!service_unit(unit), "{unit}");
        }
        for unit in ["ssh.service", "user@1000.service", "foo-bar_2.service"] {
            assert!(service_unit(unit));
        }
    }
}
