mod download;
mod history;
mod persist;

use download::{cancel_download, get_history, list_downloads, pause_download, probe_url, resume_download, start_download, DownloadManager};
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
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("velox"));
            let resume_dir = data_dir.join("resume");
            std::fs::create_dir_all(&resume_dir).ok();
            let db_path = data_dir.join("downloads.sqlite");
            let hist = tauri::async_runtime::block_on(history::open_pool(&db_path)).ok();
            app.manage(DownloadManager::new(resume_dir, hist));
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
            get_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
