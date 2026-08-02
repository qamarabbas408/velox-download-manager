use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateSegment {
    pub index: usize,
    pub start: u64,
    pub end: u64,
    pub current: u64,
}

/// On-disk snapshot of an in-progress download. This is what lets us resume
/// across app restarts / crashes, byte-by-byte, without losing progress.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeState {
    pub id: String,
    pub url: String,
    pub file_path: String,
    pub total_size: u64,
    pub range_supported: bool,
    pub segment_count: usize,
    pub segments: Vec<StateSegment>,
}

pub fn state_path(dir: &std::path::Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.json"))
}

/// Serialize and write the state to disk atomically: write to a temp file in the
/// same directory, then rename over the target. A crash mid-write leaves either
/// the old file intact or the tmp file orphaned — never a corrupted target.
pub async fn write_state(path: &std::path::Path, state: &ResumeState) -> std::io::Result<()> {
    let bytes = serde_json::to_vec_pretty(state).map_err(io_err)?;
    let tmp = path.with_extension("json.tmp");
    // Ensure the parent directory exists (e.g. the segments dir on first run).
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(&tmp, &bytes).await?;
    tokio::fs::rename(&tmp, path).await?;
    Ok(())
}

pub async fn read_state(path: &std::path::Path) -> Option<ResumeState> {
    let bytes = tokio::fs::read(path).await.ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Best-effort removal. Also cleans up any orphaned tmp file.
pub async fn delete_state(path: &std::path::Path) {
    let tmp = path.with_extension("json.tmp");
    let _ = tokio::fs::remove_file(path).await;
    let _ = tokio::fs::remove_file(tmp).await;
}

/// List `.json` state files in a directory.
pub async fn list_state_paths(dir: &std::path::Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut entries = match tokio::fs::read_dir(dir).await {
        Ok(e) => e,
        Err(_) => return out,
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path.extension().map(|e| e == "json").unwrap_or(false) {
            out.push(path);
        }
    }
    out.sort();
    out
}

fn io_err(e: impl std::fmt::Display) -> std::io::Error {
    std::io::Error::other(format!("serialization error: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_state(id: &str) -> ResumeState {
        ResumeState {
            id: id.to_string(),
            url: "https://example.com/file.bin".to_string(),
            file_path: "/tmp/file.bin".to_string(),
            total_size: 100,
            range_supported: true,
            segment_count: 2,
            segments: vec![
                StateSegment { index: 0, start: 0, end: 50, current: 40 },
                StateSegment { index: 1, start: 50, end: 100, current: 50 },
            ],
        }
    }

    #[tokio::test]
    async fn write_read_roundtrip() {
        let dir = std::env::temp_dir().join(format!("velox-persist-{}", std::process::id()));
        let _ = tokio::fs::remove_dir_all(&dir).await;
        let path = state_path(&dir, "abc");
        let state = sample_state("abc");

        write_state(&path, &state).await.unwrap();
        let loaded = read_state(&path).await.unwrap();

        assert_eq!(loaded.id, "abc");
        assert_eq!(loaded.segments.len(), 2);
        assert_eq!(loaded.segments[0].current, 40);
        assert_eq!(loaded.total_size, 100);
        assert_eq!(loaded.range_supported, true);

        // No stray tmp file left behind.
        assert!(!tokio::fs::try_exists(&path.with_extension("json.tmp")).await.unwrap());

        let listed = list_state_paths(&dir).await;
        assert_eq!(listed.len(), 1);

        delete_state(&path).await;
        assert!(!tokio::fs::try_exists(&path).await.unwrap());

        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    #[tokio::test]
    async fn missing_file_returns_none() {
        let dir = std::env::temp_dir().join(format!("velox-persist-none-{}", std::process::id()));
        let path = state_path(&dir, "nope");
        assert!(read_state(&path).await.is_none());
    }

    #[tokio::test]
    async fn list_state_paths_ignores_non_json() {
        let dir = std::env::temp_dir().join(format!("velox-persist-lst-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        tokio::fs::write(dir.join("a.json"), b"{}").await.unwrap();
        tokio::fs::write(dir.join("b.txt"), b"{}").await.unwrap();
        tokio::fs::write(dir.join("c.json.tmp"), b"{}").await.unwrap();

        let paths = list_state_paths(&dir).await;
        let names: Vec<String> = paths
            .iter()
            .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
            .collect();
        assert_eq!(names, vec!["a.json"]);

        let _ = tokio::fs::remove_dir_all(&dir).await;
    }
}