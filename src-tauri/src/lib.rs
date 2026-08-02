mod download;
mod persist;

use download::{cancel_download, list_downloads, pause_download, probe_url, resume_download, start_download, DownloadManager};
use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let resume_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("velox"))
                .join("resume");
            std::fs::create_dir_all(&resume_dir).ok();
            app.manage(DownloadManager::new(resume_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            probe_url,
            start_download,
            pause_download,
            resume_download,
            cancel_download,
            list_downloads,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
