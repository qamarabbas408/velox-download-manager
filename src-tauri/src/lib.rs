mod download;
mod history;
mod persist;

use download::{cancel_download, get_history, list_downloads, pause_download, probe_url, remove_download, resume_download, set_max_connections, start_download, DownloadManager};
use serde::Serialize;
use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageStats {
    total_bytes: u64,
    used_bytes: u64,
    available_bytes: u64,
}

/// Report disk usage of the volume that holds the given download directory.
/// Used for the "Storage used" meter in the sidebar.
#[tauri::command]
fn get_storage_stats(path: String) -> StorageStats {
    use sysinfo::Disks;

    let path = if path.trim().is_empty() {
        std::env::home_dir().unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/")))
    } else {
        std::path::PathBuf::from(&path)
    };

    let mut matched_total: u64 = 0;
    let mut matched_available: u64 = 0;
    let mut matched_mount_len: usize = 0;

    for disk in Disks::new_with_refreshed_list().list() {
        let mount = disk.mount_point();
        if path.starts_with(mount) && mount.as_os_str().len() > matched_mount_len {
            matched_total = disk.total_space();
            matched_available = disk.available_space();
            matched_mount_len = mount.as_os_str().len();
        }
    }

    if matched_total == 0 {
        // Fallback if no disk matched (e.g. an exotic or non-existent path).
        matched_total = 8 * 1024 * 1024 * 1024 * 1024;
        matched_available = 4 * 1024 * 1024 * 1024 * 1024;
    }

    StorageStats {
        total_bytes: matched_total,
        used_bytes: matched_total.saturating_sub(matched_available),
        available_bytes: matched_available,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
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
            get_storage_stats,
            pause_download,
            resume_download,
            cancel_download,
            remove_download,
            list_downloads,
            get_history,
            set_max_connections,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
