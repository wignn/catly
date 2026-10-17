// Prevents additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod credentials;
mod sftp;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            credentials::credential_get,
            credentials::credential_set,
            credentials::credential_delete,
            sftp::sftp_transfer
        ])
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
