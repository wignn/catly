use std::{
    io::Write,
    path::Path,
    process::{Command, Stdio},
};

fn checked_path(path: &str, local: bool) -> Result<String, String> {
    // ponytail: OpenSSH batch supports more names; reject parser metacharacters until escaping is needed.
    if path.is_empty()
        || path.len() > 4096
        || path
            .chars()
            .any(|c| c.is_control() || "\"'`$*?[]{};|&<>!".contains(c))
    {
        return Err("Path contains unsupported control or batch metacharacters".into());
    }
    if (local && !Path::new(path).is_absolute()) || (!local && !path.starts_with('/')) {
        return Err("Use an absolute path".into());
    }
    if !local && path.contains('\\') {
        return Err("Remote paths must use forward slashes".into());
    }
    Ok(path.replace('\\', "/"))
}

fn staging_path(path: &str) -> String {
    format!(
        "{path}.vpsmanager-{}-{}.part",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    )
}

fn batch(
    host: &str,
    user: &str,
    port: u16,
    remote: &str,
    local: &str,
    direction: &str,
    key: Option<&str>,
) -> Result<(Vec<String>, String), String> {
    if host.is_empty()
        || host.len() > 253
        || host.starts_with('-')
        || !host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-:".contains(&b))
    {
        return Err("Host must be a hostname or unbracketed IP address".into());
    }
    if user.is_empty()
        || user.len() > 128
        || user.starts_with('-')
        || !user
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
        || port == 0
    {
        return Err("Invalid SSH username or port".into());
    }
    let remote = checked_path(remote, false)?;
    let local = checked_path(local, true)?;
    let mut args: Vec<String> = [
        "-b",
        "-",
        "-oBatchMode=yes",
        "-oStrictHostKeyChecking=yes",
        "-oConnectTimeout=15",
        "-oServerAliveInterval=15",
        "-oServerAliveCountMax=2",
        "-P",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    args.push(port.to_string());
    if let Some(key) = key.filter(|k| !k.is_empty()) {
        args.extend(["-i".into(), checked_path(key, true)?]);
    }
    args.push(if host.contains(':') {
        format!("{user}@[{host}]")
    } else {
        format!("{user}@{host}")
    });
    let line = match direction {
        "upload" => {
            let staged = staging_path(&remote);
            // OpenSSH uses posix-rename when available; servers refusing replacement fail safely.
            format!("put \"{local}\" \"{staged}\"\nrename \"{staged}\" \"{remote}\"\n")
        }
        "download" => format!("get \"{remote}\" \"{local}\"\n"),
        _ => return Err("Direction must be upload or download".into()),
    };
    Ok((args, line))
}

#[tauri::command]
pub async fn sftp_transfer(
    host: String,
    user: String,
    port: u16,
    remote: String,
    local: String,
    direction: String,
    key: Option<String>,
) -> Result<String, String> {
    let destination = checked_path(&local, true)?;
    let download = direction == "download";
    let transfer_path = if download {
        staging_path(&destination)
    } else {
        destination.clone()
    };
    let (args, line) = batch(
        &host,
        &user,
        port,
        &remote,
        &transfer_path,
        &direction,
        key.as_deref(),
    )?;
    tauri::async_runtime::spawn_blocking(move || {
        if download {
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&transfer_path)
                .map_err(|e| format!("Cannot reserve local staging file: {e}"))?;
        }
        let result = (|| {
            let mut command = Command::new("sftp");
            command
                .args(args)
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::piped());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            let mut child = command.spawn().map_err(|e| {
                format!("Cannot start OpenSSH sftp (install Windows OpenSSH Client): {e}")
            })?;
            let input = child
                .stdin
                .take()
                .ok_or("Cannot open SFTP batch input")?
                .write_all(line.as_bytes());
            if let Err(error) = input {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("SFTP batch input failed: {error}"));
            }
            let output = child.wait_with_output().map_err(|e| e.to_string())?;
            if !output.status.success() {
                return Err(format!(
                    "SFTP failed (remote .vpsmanager-*.part files may need cleanup): {}",
                    String::from_utf8_lossy(&output.stderr)
                        .chars()
                        .take(2000)
                        .collect::<String>()
                ));
            }
            if download {
                std::fs::rename(&transfer_path, &destination).map_err(|e| {
                    format!("Cannot replace local destination; original preserved: {e}")
                })?;
            }
            Ok("Transfer completed".into())
        })();
        if download && result.is_err() {
            let _ = std::fs::remove_file(&transfer_path);
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_batch_and_option_injection() {
        let local = std::env::temp_dir()
            .join("vps test.bin")
            .to_string_lossy()
            .into_owned();
        let (args, input) = batch(
            "::1",
            "root",
            22,
            "/tmp/a file.bin",
            &local,
            "download",
            None,
        )
        .unwrap();
        assert!(args.contains(&"-oStrictHostKeyChecking=yes".into()));
        assert!(args.contains(&"-oBatchMode=yes".into()));
        assert!(input.starts_with("get \"/tmp/a file.bin\""));
        let (_, upload) =
            batch("host", "root", 22, "/tmp/existing", &local, "upload", None).unwrap();
        assert!(upload.contains(".part\"\nrename \""));
        assert!(upload.ends_with("\"/tmp/existing\"\n"));
        for path in [
            "relative",
            "/tmp/a\n!whoami",
            "/tmp/\"evil",
            "/tmp/*",
            "/tmp/a\\b",
        ] {
            assert!(batch("host", "root", 22, path, &local, "upload", None).is_err());
        }
        assert!(batch(
            "-oProxyCommand=bad",
            "root",
            22,
            "/tmp/a",
            &local,
            "upload",
            None
        )
        .is_err());
        assert!(batch("host", "-root", 22, "/tmp/a", &local, "upload", None).is_err());
        assert!(batch("host", "root", 0, "/tmp/a", &local, "upload", None).is_err());
    }
}
