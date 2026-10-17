fn target(id: &str) -> Result<Vec<u16>, String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        return Err("Invalid credential profile ID".into());
    }
    Ok(format!("VpsManager/token/{id}\0").encode_utf16().collect())
}

#[cfg(windows)]
mod platform {
    use std::{ffi::c_void, ptr};
    #[repr(C)]
    struct FileTime {
        low: u32,
        high: u32,
    }
    #[repr(C)]
    struct Credential {
        flags: u32,
        kind: u32,
        target: *mut u16,
        comment: *mut u16,
        written: FileTime,
        size: u32,
        blob: *mut u8,
        persist: u32,
        attributes_count: u32,
        attributes: *mut c_void,
        alias: *mut u16,
        username: *mut u16,
    }
    #[link(name = "Advapi32")]
    extern "system" {
        fn CredWriteW(credential: *const Credential, flags: u32) -> i32;
        fn CredReadW(
            target: *const u16,
            kind: u32,
            flags: u32,
            credential: *mut *mut Credential,
        ) -> i32;
        fn CredDeleteW(target: *const u16, kind: u32, flags: u32) -> i32;
        fn CredFree(buffer: *mut c_void);
    }
    fn error() -> String {
        format!(
            "Windows Credential Manager: {}",
            std::io::Error::last_os_error()
        )
    }
    pub fn get(target: &[u16]) -> Result<Option<String>, String> {
        let mut credential = ptr::null_mut();
        unsafe {
            if CredReadW(target.as_ptr(), 1, 0, &mut credential) == 0 {
                if std::io::Error::last_os_error().raw_os_error() == Some(1168) {
                    return Ok(None);
                }
                return Err(error());
            }
            let value = if (*credential).size == 0 {
                Ok(String::new())
            } else {
                String::from_utf8(
                    std::slice::from_raw_parts((*credential).blob, (*credential).size as usize)
                        .to_vec(),
                )
                .map_err(|_| "Invalid credential encoding".to_string())
            };
            CredFree(credential.cast());
            value.map(Some)
        }
    }
    pub fn set(target: &mut [u16], token: &str) -> Result<(), String> {
        if token.is_empty() || token.len() > 2560 || token.contains('\0') {
            return Err("Token must contain 1–2560 bytes without NUL".into());
        }
        let mut blob = token.as_bytes().to_vec();
        let credential = Credential {
            flags: 0,
            kind: 1,
            target: target.as_mut_ptr(),
            comment: ptr::null_mut(),
            written: FileTime { low: 0, high: 0 },
            size: blob.len() as u32,
            blob: blob.as_mut_ptr(),
            persist: 2,
            attributes_count: 0,
            attributes: ptr::null_mut(),
            alias: ptr::null_mut(),
            username: ptr::null_mut(),
        };
        let result = unsafe { CredWriteW(&credential, 0) };
        blob.fill(0);
        if result == 0 {
            return Err(error());
        }
        if get(target)?.as_deref() != Some(token) {
            return Err("Credential verification failed".into());
        }
        Ok(())
    }
    pub fn delete(target: &[u16]) -> Result<(), String> {
        if unsafe { CredDeleteW(target.as_ptr(), 1, 0) } == 0
            && std::io::Error::last_os_error().raw_os_error() != Some(1168)
        {
            return Err(error());
        }
        Ok(())
    }
}

#[tauri::command]
pub fn credential_get(id: String) -> Result<Option<String>, String> {
    let target = target(&id)?;
    #[cfg(windows)]
    {
        platform::get(&target)
    }
    #[cfg(not(windows))]
    {
        let _ = target;
        Err("OS credential storage is currently supported on Windows only".into())
    }
}
#[tauri::command]
pub fn credential_set(id: String, token: String) -> Result<(), String> {
    let mut target = target(&id)?;
    #[cfg(windows)]
    {
        platform::set(&mut target, &token)
    }
    #[cfg(not(windows))]
    {
        let _ = (&mut target, token);
        Err("OS credential storage is currently supported on Windows only".into())
    }
}
#[tauri::command]
pub fn credential_delete(id: String) -> Result<(), String> {
    let target = target(&id)?;
    #[cfg(windows)]
    {
        platform::delete(&target)
    }
    #[cfg(not(windows))]
    {
        let _ = target;
        Err("OS credential storage is currently supported on Windows only".into())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn scoped_credential_targets() {
        assert!(super::target("server-123_ABC").is_ok());
        for id in ["", "../other", "token\0injection", "a/b"] {
            assert!(super::target(id).is_err());
        }
    }
    #[test]
    #[cfg(windows)]
    fn windows_credential_roundtrip() {
        let id = format!("test-{}", std::process::id());
        super::credential_set(id.clone(), "test-token".into()).unwrap();
        assert_eq!(
            super::credential_get(id.clone()).unwrap().as_deref(),
            Some("test-token")
        );
        super::credential_delete(id.clone()).unwrap();
        assert!(super::credential_get(id).unwrap().is_none());
    }
}
