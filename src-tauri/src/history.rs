use std::path::Path;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::Row;

use crate::download::DownloadStatus;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS downloads (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    extension     TEXT NOT NULL,
    url           TEXT NOT NULL,
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    downloaded_bytes INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL,
    range_supported INTEGER NOT NULL DEFAULT 0,
    segment_count INTEGER NOT NULL DEFAULT 1,
    source        TEXT NOT NULL,
    download_dir  TEXT NOT NULL,
    error_message TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
CREATE INDEX IF NOT EXISTS idx_downloads_updated ON downloads(updated_at);
"#;

pub async fn open_pool(db_path: &Path) -> sqlx::Result<SqlitePool> {
    let options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new().max_connections(4).connect_with(options).await?;
    sqlx::query(SCHEMA).execute(&pool).await?;
    Ok(pool)
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRow {
    pub id: String,
    pub name: String,
    pub extension: String,
    pub url: String,
    pub size_bytes: u64,
    pub downloaded_bytes: u64,
    pub status: String,
    pub range_supported: bool,
    pub segment_count: usize,
    pub source: String,
    pub download_dir: String,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub async fn upsert_download(
    pool: &SqlitePool,
    row: &DownloadRow,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO downloads (
            id, name, extension, url, size_bytes, downloaded_bytes, status,
            range_supported, segment_count, source, download_dir, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            downloaded_bytes = excluded.downloaded_bytes,
            status = excluded.status,
            error_message = excluded.error_message,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(&row.id)
    .bind(&row.name)
    .bind(&row.extension)
    .bind(&row.url)
    .bind(row.size_bytes as i64)
    .bind(row.downloaded_bytes as i64)
    .bind(&row.status)
    .bind(row.range_supported as i64)
    .bind(row.segment_count as i64)
    .bind(&row.source)
    .bind(&row.download_dir)
    .bind(&row.error_message)
    .bind(&row.created_at)
    .bind(&row.updated_at)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn fetch_history(pool: &SqlitePool, limit: i64) -> sqlx::Result<Vec<DownloadRow>> {
    let rows = sqlx::query("SELECT * FROM downloads ORDER BY updated_at DESC LIMIT ?")
        .bind(limit)
        .fetch_all(pool)
        .await?;
    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(row_from_sql(&r));
    }
    Ok(out)
}

fn row_from_sql(r: &sqlx::sqlite::SqliteRow) -> DownloadRow {
    DownloadRow {
        id: r.get("id"),
        name: r.get("name"),
        extension: r.get("extension"),
        url: r.get("url"),
        size_bytes: r.get::<i64, _>("size_bytes").max(0) as u64,
        downloaded_bytes: r.get::<i64, _>("downloaded_bytes").max(0) as u64,
        status: r.get("status"),
        range_supported: r.get::<i64, _>("range_supported") != 0,
        segment_count: r.get::<i64, _>("segment_count").max(0) as usize,
        source: r.get("source"),
        download_dir: r.get("download_dir"),
        error_message: r.get("error_message"),
        created_at: r.get("created_at"),
        updated_at: r.get("updated_at"),
    }
}

pub fn status_str(status: &DownloadStatus) -> &'static str {
    match status {
        DownloadStatus::Queued => "queued",
        DownloadStatus::Downloading => "downloading",
        DownloadStatus::Paused => "paused",
        DownloadStatus::Completed => "completed",
        DownloadStatus::Error => "error",
    }
}

pub fn now_str() -> String {
    chrono::Utc::now().to_rfc3339()
}

// Re-export so consumers can type the pool without importing sqlx directly.
pub type HistoryPool = SqlitePool;

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, status: &str) -> DownloadRow {
        DownloadRow {
            id: id.to_string(),
            name: "file".to_string(),
            extension: "bin".to_string(),
            url: "https://example.com/file.bin".to_string(),
            size_bytes: 1000,
            downloaded_bytes: 500,
            status: status.to_string(),
            range_supported: true,
            segment_count: 4,
            source: "https://example.com/file.bin".to_string(),
            download_dir: "/tmp".to_string(),
            error_message: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[tokio::test]
    async fn upsert_then_fetch() {
        let path = std::env::temp_dir().join(format!("velox-hist-{}.sqlite", std::process::id()));
        let _ = tokio::fs::remove_file(&path).await;
        let pool = open_pool(&path).await.unwrap();

        upsert_download(&pool, &sample("a", "downloading")).await.unwrap();
        upsert_download(&pool, &sample("b", "completed")).await.unwrap();

        let all = fetch_history(&pool, 100).await.unwrap();
        assert_eq!(all.len(), 2);

        // Re-upsert "a" should update status, not duplicate.
        let mut updated = sample("a", "completed");
        updated.downloaded_bytes = 1000;
        upsert_download(&pool, &updated).await.unwrap();
        let all = fetch_history(&pool, 100).await.unwrap();
        assert_eq!(all.len(), 2);
        let a = all.iter().find(|r| r.id == "a").unwrap();
        assert_eq!(a.status, "completed");
        assert_eq!(a.downloaded_bytes, 1000);

        pool.close().await;
        let _ = tokio::fs::remove_file(&path).await;
    }

    #[tokio::test]
    async fn fetch_orders_by_updated_desc() {
        let path = std::env::temp_dir().join(format!("velox-hist2-{}.sqlite", std::process::id()));
        let pool = open_pool(&path).await.unwrap();
        upsert_download(&pool, &sample("older", "completed")).await.unwrap();
        let mut newer = sample("newer", "completed");
        newer.updated_at = "2026-06-01T00:00:00Z".to_string();
        upsert_download(&pool, &newer).await.unwrap();

        let rows = fetch_history(&pool, 10).await.unwrap();
        assert_eq!(rows[0].id, "newer");
        assert_eq!(rows[1].id, "older");

        pool.close().await;
        let _ = tokio::fs::remove_file(&path).await;
    }
}