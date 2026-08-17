use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::header::{ACCEPT_RANGES, CONTENT_DISPOSITION, CONTENT_TYPE, RANGE};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::fs::{File, OpenOptions};
use tokio::io::{AsyncSeekExt, AsyncWriteExt, SeekFrom};
use tokio::sync::{Mutex, Semaphore};
use tokio::task::JoinSet;

use crate::history;
use crate::persist;

const PROGRESS_INTERVAL: Duration = Duration::from_millis(400);
const MAX_SEGMENT_RETRIES: u32 = 12;
const RETRY_BACKOFF: Duration = Duration::from_millis(800);
const STATE_FLUSH_INTERVAL: Duration = Duration::from_secs(5);
const PROBE_TIMEOUT: Duration = Duration::from_secs(20);
const DEFAULT_MAX_CONN: usize = 32;

#[derive(Debug)]
struct SegmentError {
    message: String,
    retriable: bool,
}

impl SegmentError {
    fn permanent(msg: String) -> Self {
        Self { message: msg, retriable: false }
    }
    fn transient(msg: String) -> Self {
        Self { message: msg, retriable: true }
    }
}

#[derive(Clone, Copy, PartialEq, Serialize, Deserialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Queued,
    Downloading,
    Paused,
    Completed,
    Error,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub url: String,
    pub name: String,
    pub extension: String,
    pub size_bytes: u64,
    pub range_supported: bool,
    pub content_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    pub id: String,
    pub url: String,
    pub name: String,
    pub extension: String,
    pub size_bytes: u64,
    pub download_dir: String,
    pub range_supported: bool,
    pub segments: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentState {
    pub index: usize,
    pub start: u64,
    pub end: u64,
    pub current: u64,
    pub state: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub id: String,
    pub status: DownloadStatus,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_bytes_per_sec: u64,
    pub error: Option<String>,
    pub segments: Vec<SegmentState>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeSummary {
    pub id: String,
    pub url: String,
    pub name: String,
    pub extension: String,
    pub download_dir: String,
    pub size_bytes: u64,
    pub downloaded_bytes: u64,
    pub range_supported: bool,
    pub segment_count: usize,
    pub progress_percent: u64,
}

pub struct ActiveDownload {
    pub id: String,
    pub url: String,
    pub file_path: PathBuf,
    pub total_size: u64,
    pub range_supported: bool,
    pub segment_count: usize,
    pub status: Mutex<DownloadStatus>,
    pub last_error: Mutex<Option<String>>,
    pub pause_flag: AtomicBool,
    pub cancel_flag: AtomicBool,
    pub segments: Mutex<Vec<SegmentState>>,
    pub retries: Mutex<HashMap<usize, u32>>,
    pub speed: AtomicU64,
    pub last_state_flush: Mutex<Instant>,
    pub conn_pool: Arc<Semaphore>,
}

pub struct DownloadManager {
    pub client: reqwest::Client,
    pub resume_dir: PathBuf,
    pub hist: Option<history::HistoryPool>,
    pub conn_pool: Arc<Semaphore>,
    pub max_conn: AtomicUsize,
    downloads: Mutex<HashMap<String, Arc<ActiveDownload>>>,
}

impl DownloadManager {
    pub fn new(resume_dir: PathBuf, hist: Option<history::HistoryPool>) -> Self {
        Self {
            client: reqwest::Client::new(),
            resume_dir,
            hist,
            conn_pool: Arc::new(Semaphore::new(DEFAULT_MAX_CONN)),
            max_conn: AtomicUsize::new(DEFAULT_MAX_CONN),
            downloads: Mutex::new(HashMap::new()),
        }
    }
}

fn root_cause(e: &(dyn std::error::Error + 'static)) -> String {
    let mut msg = e.to_string();
    let mut src = e.source();
    while let Some(s) = src {
        msg = s.to_string();
        src = s.source();
    }
    msg
}

/// Shorten a URL for display in error messages: strip any userinfo
/// (credentials) and truncate very long URLs so they never blow up the UI.
fn display_url(url: &str) -> String {
    let mut out = url.to_string();
    if let Some(scheme_end) = out.find("://") {
        if let Some(at) = out[scheme_end + 3..].find('@') {
            let at = scheme_end + 3 + at;
            out = format!("{}…@{}", &out[..scheme_end + 3], &out[at + 1..]);
        }
    }
    if out.chars().count() > 80 {
        let truncated: String = out.chars().take(80).collect();
        format!("{truncated}…")
    } else {
        out
    }
}

fn describe_reqwest_error(url: &str, e: &reqwest::Error) -> String {
    let cause = root_cause(e);
    let c = cause.to_lowercase();
    let friendly = if e.is_timeout() {
        "timed out waiting for the server to respond".to_string()
    } else if c.contains("dns") || c.contains("nodename") || c.contains("not known")
        || c.contains("temporarily failed") || c.contains("cannot resolve")
    {
        "could not resolve the hostname (check your connection or the URL)".to_string()
    } else if c.contains("refused") {
        "connection refused by the server".to_string()
    } else if c.contains("timed out") || c.contains("timedout") {
        "connection timed out".to_string()
    } else if c.contains("certificate") || c.contains("tls") {
        "TLS/SSL handshake failed (the site may be misconfigured)".to_string()
    } else {
        cause
    };
    format!("Could not reach {} — {}", display_url(url), friendly)
}

async fn describe_http_status(resp: reqwest::Response) -> String {
    let status = resp.status();
    let body = resp.bytes().await.unwrap_or_default();
    let body_lower = String::from_utf8_lossy(&body).to_lowercase();

    let cloudflare =
        body_lower.contains("cloudflare") || body_lower.contains("cf-mitigated") || body_lower.contains("challenge");

    let reason = match status.as_u16() {
        403 if cloudflare => " — blocked by Cloudflare bot protection (this host refuses non-browser downloads)".to_string(),
        403 => " — forbidden: the server refuses to serve this file (may require login or a browser)".to_string(),
        401 => " — unauthorized: the file needs authentication".to_string(),
        404 => " — not found: the file no longer exists at this URL".to_string(),
        410 => " — gone: the file has been permanently removed".to_string(),
        429 => " — too many requests: the server is rate-limiting (try fewer connections)".to_string(),
        500 => " — server error: the server hit an internal error".to_string(),
        502 => " — bad gateway: an upstream server failed".to_string(),
        503 => " — service unavailable: the server is overloaded or down".to_string(),
        504 => " — gateway timeout: an upstream server timed out".to_string(),
        n => format!(" (HTTP {n})"),
    };
    reason
}

fn derive_filename(url: &str, content_disposition: Option<&str>) -> (String, String) {
    if let Some(cd) = content_disposition {
        if let Some(start) = cd.find("filename=") {
            let rest = &cd[start + 9..];
            let trimmed = rest
                .trim_matches('"')
                .trim()
                .split(|c: char| c == ';' || c == ' ' || c == '"')
                .next()
                .unwrap_or("");
            if !trimmed.is_empty() {
                let basename = trimmed
                    .rsplit(['/', '\\'])
                    .next()
                    .unwrap_or("")
                    .trim()
                    .trim_start_matches('-');
                if !basename.is_empty() {
                    let dot = basename.rfind('.');
                    if let Some(d) = dot {
                        return (basename[..d].to_string(), basename[d + 1..].to_string());
                    }
                    return (basename.to_string(), "bin".to_string());
                }
            }
        }
    }
    let raw = url
        .split('?')
        .next()
        .unwrap_or("")
        .rsplit('/')
        .next()
        .unwrap_or("download");
    let dot = raw.rfind('.');
    match dot {
        Some(d) if d > 0 && d < raw.len() - 1 => {
            (raw[..d].to_string(), raw[d + 1..].to_string())
        }
        _ => (raw.to_string(), "bin".to_string()),
    }
}

async fn probe_impl(client: &reqwest::Client, url: &str) -> Result<ProbeResult, String> {
    let head = client
        .head(url)
        .timeout(PROBE_TIMEOUT)
        .send()
        .await;

    let mut size = None;
    let mut range_supported = false;
    let mut content_disposition = None;
    let mut content_type = None;

    if let Ok(head) = &head {
        size = head
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());
        range_supported = head
            .headers()
            .get(ACCEPT_RANGES)
            .and_then(|v| v.to_str().ok())
            .map(|v| v.eq_ignore_ascii_case("bytes"))
            .unwrap_or(false);
        content_disposition = head
            .headers()
            .get(CONTENT_DISPOSITION)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        content_type = head
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
    }

    if size.is_none() || !range_supported {
        let resp = client
            .get(url)
            .header(RANGE, "bytes=0-0")
            .timeout(PROBE_TIMEOUT)
            .send()
            .await
            .map_err(|e| describe_reqwest_error(url, &e))?;
        if resp.status() == StatusCode::PARTIAL_CONTENT {
            range_supported = true;
            if let Some(cr) = resp
                .headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
            {
                if let Some(total) = cr.rsplit('/').next().and_then(|s| s.parse::<u64>().ok()) {
                    size = Some(total);
                }
            }
        } else if resp.status().is_client_error() || resp.status().is_server_error() {
            if size.is_none() {
                let detail = describe_http_status(resp).await;
                return Err(format!("Probe failed{detail}"));
            }
        }
        if size.is_none() {
            size = resp.content_length();
        }
        if content_disposition.is_none() {
            content_disposition = resp
                .headers()
                .get(CONTENT_DISPOSITION)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
        }
        if content_type.is_none() {
            content_type = resp
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
        }
    }

    let (name, extension) = derive_filename(url, content_disposition.as_deref());

    Ok(ProbeResult {
        url: url.to_string(),
        name,
        extension,
        size_bytes: size.unwrap_or(0),
        range_supported: range_supported && size.is_some(),
        content_type: content_type
            .unwrap_or_else(|| "application/octet-stream".to_string()),
    })
}

fn split_segments(total: u64, range_supported: bool, n: usize) -> Vec<SegmentState> {
    if !range_supported || total == 0 || n <= 1 {
        return vec![SegmentState {
            index: 0,
            start: 0,
            end: total,
            current: 0,
            state: "idle",
        }];
    }
    let chunk = total / n as u64;
    let mut segs = Vec::new();
    for i in 0..n {
        let start = i as u64 * chunk;
        let end = if i == n - 1 { total } else { start + chunk };
        segs.push(SegmentState {
            index: i,
            start,
            end,
            current: start,
            state: "idle",
        });
    }
    segs
}

async fn set_segment_state(dl: &ActiveDownload, index: usize, state: &'static str) {
    let mut segs = dl.segments.lock().await;
    if let Some(s) = segs.iter_mut().find(|s| s.index == index) {
        s.state = state;
    }
}

async fn update_segment_current(dl: &ActiveDownload, index: usize, current: u64) {
    let mut segs = dl.segments.lock().await;
    if let Some(s) = segs.iter_mut().find(|s| s.index == index) {
        s.current = current;
    }
}

async fn aggregate(dl: &ActiveDownload) -> (u64, bool) {
    let segs = dl.segments.lock().await;
    let downloaded = segs
        .iter()
        .map(|s| s.current.saturating_sub(s.start))
        .sum();
    let done = segs.iter().all(|s| s.current >= s.end);
    (downloaded, done)
}

async fn emit_progress(app: &AppHandle, dl: &ActiveDownload, downloaded: u64) {
    let status = *dl.status.lock().await;
    let segments = dl.segments.lock().await.clone();
    let error = dl.last_error.lock().await.clone();
    let _ = app.emit(
        "download://progress",
        DownloadProgress {
            id: dl.id.clone(),
            status,
            downloaded_bytes: downloaded,
            total_bytes: dl.total_size,
            speed_bytes_per_sec: dl.speed.load(Ordering::Relaxed),
            error,
            segments,
        },
    );
}

fn state_path(manager: &DownloadManager, id: &str) -> PathBuf {
    manager.resume_dir.join(format!("{id}.json"))
}

async fn snapshot_state(dl: &ActiveDownload) -> persist::ResumeState {
    let segments = dl
        .segments
        .lock()
        .await
        .iter()
        .map(|s| persist::StateSegment {
            index: s.index,
            start: s.start,
            end: s.end,
            current: s.current,
        })
        .collect();
    persist::ResumeState {
        id: dl.id.clone(),
        url: dl.url.clone(),
        file_path: dl.file_path.to_string_lossy().into_owned(),
        total_size: dl.total_size,
        range_supported: dl.range_supported,
        segment_count: dl.segment_count,
        segments,
    }
}

async fn persist_state_quiet(resume_dir: &std::path::Path, dl: &ActiveDownload) {
    let path = persist::state_path(resume_dir, &dl.id);
    let state = snapshot_state(dl).await;
    let _ = persist::write_state(&path, &state).await;
}

async fn write_history(pool: Option<&history::HistoryPool>, dl: &ActiveDownload) {
    let Some(pool) = pool else { return };
    let status = *dl.status.lock().await;
    let downloaded = aggregate(&dl).await.0;
    let error = dl.last_error.lock().await.clone();
    let file = dl.file_path.clone();
    let name = file
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "download".to_string());
    let extension = file
        .extension()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "bin".to_string());
    let download_dir = file
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let row = history::DownloadRow {
        id: dl.id.clone(),
        name,
        extension,
        url: dl.url.clone(),
        size_bytes: dl.total_size,
        downloaded_bytes: downloaded,
        status: history::status_str(&status).to_string(),
        range_supported: dl.range_supported,
        segment_count: dl.segment_count,
        source: dl.url.clone(),
        download_dir,
        error_message: error,
        created_at: history::now_str(),
        updated_at: history::now_str(),
    };
    let _ = history::upsert_download(pool, &row).await;
}

/// Scan the resume dir and rebuild an in-memory representation for each state
/// file found (used to surface saved downloads back into the UI on launch).
pub async fn listed_states(manager: &DownloadManager) -> Vec<persist::ResumeState> {
    let mut out = Vec::new();
    for path in persist::list_state_paths(&manager.resume_dir).await {
        if let Some(state) = persist::read_state(&path).await {
            out.push(state);
        }
    }
    out
}

/// Attempt to restore a download's segments from its saved state file.
/// Returns true if a valid resumable state was loaded. Only resumable when the
/// server supports ranges — otherwise we must start from scratch.
async fn try_restore(dl: &ActiveDownload, resume_dir: &std::path::Path) -> bool {
    if !dl.range_supported {
        return false;
    }
    let path = persist::state_path(resume_dir, &dl.id);
    let state = match persist::read_state(&path).await {
        Some(s) => s,
        None => return false,
    };
    if state.segments.is_empty() {
        return false;
    }
    let mut segs: Vec<SegmentState> = state
        .segments
        .iter()
        .map(|s| SegmentState {
            index: s.index,
            start: s.start,
            end: s.end,
            current: s.current,
            state: if s.current >= s.end { "done" } else { "idle" },
        })
        .collect();
    let all_done = segs.iter().all(|s| s.state == "done");
    if all_done {
        return false;
    }
    // Truncate the file off any excess in case a previous run preallocated a
    // larger size than the final completed file.
    if let Ok(f) = OpenOptions::new().write(true).open(&dl.file_path).await {
        let _ = f.set_len(dl.total_size).await;
    }
    segs.sort_by_key(|s| s.index);
    *dl.segments.lock().await = segs;
    true
}

async fn run_segment(
    dl: Arc<ActiveDownload>,
    client: reqwest::Client,
    seg: SegmentState,
) -> (usize, Result<(), SegmentError>) {
    let index = seg.index;
    // Reserve a slot in the global connection pool before sending anything,
    // so total in-flight requests across all downloads never exceed the cap.
    let _permit = match dl.conn_pool.clone().acquire_owned().await {
        Ok(p) => p,
        Err(_) => {
            return (index, Err(SegmentError::transient("connection pool closed".to_string())));
        }
    };
    let result = run_segment_inner(dl, client, seg).await;
    (index, result)
}

async fn run_segment_inner(
    dl: Arc<ActiveDownload>,
    client: reqwest::Client,
    seg: SegmentState,
) -> Result<(), SegmentError> {
    let mut file = match OpenOptions::new().write(true).open(&dl.file_path).await {
        Ok(f) => f,
        Err(e) => return Err(SegmentError::permanent(format!("open file failed: {e}"))),
    };

    let end = seg.end;
    let mut current = seg.current;

    file.seek(SeekFrom::Start(current))
        .await
        .map_err(|e| SegmentError::permanent(format!("seek failed: {e}")))?;

    let range = if end >= dl.total_size {
        format!("bytes={}-", current)
    } else {
        format!("bytes={}-{}", current, end.saturating_sub(1))
    };

    let resp = client
        .get(&dl.url)
        .header(RANGE, range)
        .send()
        .await
        .map_err(|e| SegmentError::transient(format!("range request failed: {e}")))?;

    let status = resp.status();
    if status != StatusCode::PARTIAL_CONTENT {
        let retriable = status.is_server_error()
            || status == StatusCode::TOO_MANY_REQUESTS
            || status == StatusCode::REQUEST_TIMEOUT
            || status == StatusCode::SERVICE_UNAVAILABLE;
        let detail = describe_http_status(resp).await;
        return Err(SegmentError {
            message: format!("download rejected by server{detail}"),
            retriable,
        });
    }

    let mut stream = resp.bytes_stream();
    while current < end {
        if dl.pause_flag.load(Ordering::Relaxed) || dl.cancel_flag.load(Ordering::Relaxed) {
            break;
        }
        match stream.next().await {
            Some(Ok(chunk)) => {
                let room = (end - current) as usize;
                let n = chunk.len().min(room);
                if file.write_all(&chunk[..n]).await.is_err() {
                    break;
                }
                current += n as u64;
                update_segment_current(&dl, seg.index, current).await;
            }
            Some(Err(e)) => return Err(SegmentError::transient(format!("stream error: {e}"))),
            None => break,
        }
    }

    if current >= end {
        set_segment_state(&dl, seg.index, "done").await;
    } else {
        set_segment_state(&dl, seg.index, "idle").await;
    }
    Ok(())
}

async fn run_download(
    app: AppHandle,
    dl: Arc<ActiveDownload>,
    client: reqwest::Client,
    resume_dir: PathBuf,
    hist: Option<history::HistoryPool>,
) {
    run_download_inner(Some(&app), dl, client, &resume_dir, hist.as_ref()).await;
}

async fn run_download_inner(
    app: Option<&AppHandle>,
    dl: Arc<ActiveDownload>,
    client: reqwest::Client,
    resume_dir: &std::path::Path,
    hist: Option<&history::HistoryPool>,
) {
    {
        let segs = dl.segments.lock().await;
        let fresh = segs.is_empty();
        drop(segs);
        if fresh {
            if dl.total_size > 0 {
                if let Ok(f) = File::create(&dl.file_path).await {
                    let _ = f.set_len(dl.total_size).await;
                }
            }
            let segs = split_segments(
                dl.total_size,
                dl.range_supported,
                dl.segment_count.max(1),
            );
            *dl.segments.lock().await = segs;
        }
    }

    *dl.status.lock().await = DownloadStatus::Downloading;
    dl.pause_flag.store(false, Ordering::Relaxed);
    dl.speed.store(0, Ordering::Relaxed);
    write_history(hist, &dl).await;
    if let Some(app) = app {
        emit_progress(app, &dl, 0).await;
    }

    let mut join: JoinSet<(usize, Result<(), SegmentError>)> = JoinSet::new();
    let mut last_bytes = 0u64;
    let mut last_time = Instant::now();

    loop {
        if dl.cancel_flag.load(Ordering::Relaxed) {
            break;
        }

        let pending: Vec<SegmentState> = {
            let segs = dl.segments.lock().await;
            segs.iter()
                .filter(|s| s.state != "done" && s.state != "active")
                .cloned()
                .collect()
        };
        for seg in pending {
            set_segment_state(&dl, seg.index, "active").await;
            let dl = dl.clone();
            let client = client.clone();
            join.spawn(async move { run_segment(dl, client, seg).await });
        }

        tokio::select! {
            _ = tokio::time::sleep(PROGRESS_INTERVAL) => {
                if dl.cancel_flag.load(Ordering::Relaxed) {
                    break;
                }
                let (downloaded, done) = aggregate(&dl).await;
                let now = Instant::now();
                let dt = now.duration_since(last_time).as_secs_f64();
                let speed = if dt > 0.0 {
                    (downloaded.saturating_sub(last_bytes) as f64 / dt) as u64
                } else {
                    0
                };
                dl.speed.store(speed, Ordering::Relaxed);
                last_bytes = downloaded;
                last_time = now;
                if let Some(app) = app {
                    emit_progress(app, &dl, downloaded).await;
                }

                // Persist resume state + history on a ~5s cadence (throttled).
                let mut last_flush = dl.last_state_flush.lock().await;
                if last_flush.elapsed() >= STATE_FLUSH_INTERVAL {
                    persist_state_quiet(resume_dir, &dl).await;
                    write_history(hist, &dl).await;
                    *last_flush = Instant::now();
                }
                drop(last_flush);

                if *dl.status.lock().await == DownloadStatus::Error {
                    join.abort_all();
                    write_history(hist, &dl).await;
                    if let Some(app) = app {
                        emit_progress(app, &dl, downloaded).await;
                    }
                    return;
                }
                if dl.pause_flag.load(Ordering::Relaxed) {
                    join.abort_all();
                    *dl.status.lock().await = DownloadStatus::Paused;
                    for s in dl.segments.lock().await.iter_mut() {
                        if s.current < s.end {
                            s.state = "idle";
                        }
                    }
                    // Flush final offsets on pause even if under the interval.
                    persist_state_quiet(resume_dir, &dl).await;
                    write_history(hist, &dl).await;
                    if let Some(app) = app {
                        emit_progress(app, &dl, downloaded).await;
                    }
                    return;
                }
                if done && join.is_empty() {
                    *dl.status.lock().await = DownloadStatus::Completed;
                    persist::delete_state(&persist::state_path(resume_dir, &dl.id)).await;
                    write_history(hist, &dl).await;
                    if let Some(app) = app {
                        emit_progress(app, &dl, downloaded).await;
                    }
                    return;
                }
            }
            Some(result) = join.join_next() => {
                let (index, result) = match result {
                    Ok(r) => r,
                    Err(_) => {
                        if dl.cancel_flag.load(Ordering::Relaxed) {
                            break;
                        }
                        (0, Err(SegmentError::transient("segment task panicked".to_string())))
                    }
                };
                if let Err(err) = result {
                    if dl.cancel_flag.load(Ordering::Relaxed) || dl.pause_flag.load(Ordering::Relaxed) {
                        continue;
                    }
                    let attempts = {
                        let mut retries = dl.retries.lock().await;
                        let count = retries.get(&index).copied().unwrap_or(0);
                        retries.insert(index, count + 1);
                        count
                    };
                    let give_up = attempts >= MAX_SEGMENT_RETRIES || !err.retriable;
                    if give_up {
                        *dl.last_error.lock().await = Some(err.message);
                        *dl.status.lock().await = DownloadStatus::Error;
                        write_history(hist, &dl).await;
                    } else {
                        set_segment_state(&dl, index, "idle").await;
                        let backoff = RETRY_BACKOFF * (1u32 << attempts.min(4));
                        tokio::time::sleep(backoff).await;
                        if let Some(app) = app {
                            emit_progress(app, &dl, aggregate(&dl).await.0).await;
                        }
                    }
                }
            }
        }
    }

    join.abort_all();
    if dl.cancel_flag.load(Ordering::Relaxed) {
        return;
    }
    *dl.status.lock().await = DownloadStatus::Error;
    if let Some(app) = app {
        emit_progress(app, &dl, aggregate(&dl).await.0).await;
    }
}

#[tauri::command]
pub async fn probe_url(manager: State<'_, DownloadManager>, url: String) -> Result<ProbeResult, String> {
    probe_impl(&manager.client, &url).await
}

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    manager: State<'_, DownloadManager>,
    request: StartRequest,
) -> Result<(), String> {
    let download_dir = if request.download_dir.trim().is_empty() {
        app.path()
            .download_dir()
            .ok()
            .or_else(std::env::home_dir)
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
    } else {
        PathBuf::from(&request.download_dir)
    };
    let file_path = download_dir.join(format!("{}.{}", request.name, request.extension));
    let max_conn = manager.max_conn.load(Ordering::Relaxed).max(1);

    let dl = Arc::new(ActiveDownload {
        id: request.id.clone(),
        url: request.url.clone(),
        file_path,
        total_size: request.size_bytes,
        range_supported: request.range_supported,
        segment_count: request.segments.clamp(1, max_conn),
        status: Mutex::new(DownloadStatus::Queued),
        last_error: Mutex::new(None),
        pause_flag: AtomicBool::new(false),
        cancel_flag: AtomicBool::new(false),
        segments: Mutex::new(Vec::new()),
        retries: Mutex::new(HashMap::new()),
        speed: AtomicU64::new(0),
        last_state_flush: Mutex::new(Instant::now()),
        conn_pool: manager.conn_pool.clone(),
    });

    let restored = try_restore(&dl, &manager.resume_dir).await;
    if !restored {
        let _ = persist::delete_state(&state_path(&manager, &request.id)).await;
    }

    manager.downloads.lock().await.insert(request.id, dl.clone());
    let client = manager.client.clone();
    let resume_dir = manager.resume_dir.clone();
    let hist = manager.hist.clone();
    tauri::async_runtime::spawn(run_download(app, dl, client, resume_dir, hist));
    Ok(())
}

#[tauri::command]
pub async fn pause_download(
    manager: State<'_, DownloadManager>,
    id: String,
) -> Result<(), String> {
    let dl = manager
        .downloads
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or("download not found")?;
    dl.pause_flag.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn resume_download(
    app: AppHandle,
    manager: State<'_, DownloadManager>,
    id: String,
) -> Result<(), String> {
    let dl = manager
        .downloads
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or("download not found")?;
    dl.pause_flag.store(false, Ordering::Relaxed);
    dl.cancel_flag.store(false, Ordering::Relaxed);
    dl.retries.lock().await.clear();
    *dl.last_error.lock().await = None;
    let client = manager.client.clone();
    let resume_dir = manager.resume_dir.clone();
    let hist = manager.hist.clone();
    tauri::async_runtime::spawn(run_download(app, dl, client, resume_dir, hist));
    Ok(())
}

#[tauri::command]
pub async fn cancel_download(
    manager: State<'_, DownloadManager>,
    id: String,
) -> Result<(), String> {
    let dl = manager
        .downloads
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or("download not found")?;
    dl.cancel_flag.store(true, Ordering::Relaxed);
    let _ = tokio::fs::remove_file(&dl.file_path).await;
    persist::delete_state(&state_path(&manager, &id)).await;
    if let Some(pool) = &manager.hist {
        let _ = history::delete_history(pool, &id).await;
    }
    manager.downloads.lock().await.remove(&id);
    Ok(())
}

// Remove a download from the list entirely — whether it is currently active or
// a completed/history entry. Cancels and deletes the file if it exists, removes
// any resume state, and deletes the history row. For history-only (finished)
// downloads, `delete_file` moves the file on disk to the recycle bin.
#[tauri::command]
pub async fn remove_download(
    manager: State<'_, DownloadManager>,
    id: String,
    delete_file: bool,
) -> Result<(), String> {
    if let Some(dl) = manager.downloads.lock().await.remove(&id) {
        dl.cancel_flag.store(true, Ordering::Relaxed);
        let _ = tokio::fs::remove_file(&dl.file_path).await;
        persist::delete_state(&state_path(&manager, &id)).await;
    } else {
        // Might be a history entry only — still clear any orphaned file/state.
        if delete_file {
            if let Some(pool) = &manager.hist {
                if let Some(row) = history::fetch_one(pool, &id).await.unwrap_or(None) {
                    let _ = trash::delete(&history::file_path(&row));
                }
            }
        }
        persist::delete_state(&state_path(&manager, &id)).await;
    }
    if let Some(pool) = &manager.hist {
        let _ = history::delete_history(pool, &id).await;
    }
    Ok(())
}

// Resume a saved download from its state file. Called from the frontend on
// launch to hydrate in-progress downloads. Returns a summary of what was found.
#[tauri::command]
pub async fn list_downloads(
    app: AppHandle,
    manager: State<'_, DownloadManager>,
) -> Result<Vec<ResumeSummary>, String> {
    let states = listed_states(&manager).await;
    let mut summaries = Vec::new();
    let mut active = manager.downloads.lock().await;

    for state in states {
        if active.contains_key(&state.id) {
            continue;
        }
        let file_path = PathBuf::from(&state.file_path);
        let name = file_path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "download".to_string());
        let extension = file_path
            .extension()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "bin".to_string());
        let download_dir = file_path
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let downloaded: u64 = state.segments.iter().map(|s| s.current.saturating_sub(s.start)).sum();
        let progress_percent = if state.total_size > 0 {
            ((downloaded as f64 / state.total_size as f64) * 100.0) as u64
        } else {
            0
        };
        let max_conn = manager.max_conn.load(Ordering::Relaxed).max(1);
        let segment_count = state.segment_count.clamp(1, max_conn);

        summaries.push(ResumeSummary {
            id: state.id.clone(),
            url: state.url.clone(),
            name: name.clone(),
            extension,
            download_dir,
            size_bytes: state.total_size,
            downloaded_bytes: downloaded,
            range_supported: state.range_supported,
            segment_count,
            progress_percent,
        });

        // Only auto-resume downloads that can actually continue.
        if !state.range_supported {
            persist::delete_state(&manager.resume_dir.join(format!("{}.json", state.id))).await;
            continue;
        }

        let dl = Arc::new(ActiveDownload {
            id: state.id.clone(),
            url: state.url.clone(),
            file_path,
            total_size: state.total_size,
            range_supported: state.range_supported,
            segment_count,
            status: Mutex::new(DownloadStatus::Queued),
            last_error: Mutex::new(None),
            pause_flag: AtomicBool::new(false),
            cancel_flag: AtomicBool::new(false),
            segments: Mutex::new(Vec::new()),
            retries: Mutex::new(HashMap::new()),
            speed: AtomicU64::new(0),
            last_state_flush: Mutex::new(Instant::now()),
            conn_pool: manager.conn_pool.clone(),
        });
        if try_restore(&dl, &manager.resume_dir).await {
            let id = dl.id.clone();
            active.insert(id.clone(), dl.clone());
            let client = manager.client.clone();
            let resume_dir = manager.resume_dir.clone();
            let hist = manager.hist.clone();
            tauri::async_runtime::spawn(run_download(app.clone(), dl, client, resume_dir, hist));
        }
    }

    Ok(summaries)
}

#[tauri::command]
pub async fn get_history(
    app: AppHandle,
    manager: State<'_, DownloadManager>,
) -> Result<Vec<history::DownloadRow>, String> {
    let Some(pool) = &manager.hist else {
        return Ok(Vec::new());
    };
    let mut rows = history::fetch_history(pool, 500).await.map_err(|e| e.to_string())?;

    // Backfill rows saved before the download_dir column was populated. Those
    // downloads were written relative to the app's current working directory,
    // so probe that location for the finished file as a best-effort recovery.
    let cwd = std::env::current_dir().unwrap_or_default();
    for row in rows.iter_mut() {
        if !row.download_dir.trim().is_empty() {
            continue;
        }
        let file_name = if row.extension.is_empty() {
            row.name.clone()
        } else {
            format!("{}.{}", row.name, row.extension)
        };
        let candidate = cwd.join(&file_name);
        if candidate.exists() {
            row.download_dir = cwd.to_string_lossy().into_owned();
        } else {
            let fallback = app
                .path()
                .download_dir()
                .ok()
                .or_else(std::env::home_dir)
                .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
            row.download_dir = fallback.to_string_lossy().into_owned();
        }
    }

    Ok(rows)
}

/// Resize the global connection pool at runtime (e.g. when the user saves a
/// new "Max connections" value in Settings). Increasing adds permits;
/// decreasing removes them as in-flight requests finish.
#[tauri::command]
pub async fn set_max_connections(
    manager: State<'_, DownloadManager>,
    max: usize,
) -> Result<(), String> {
    let max = max.clamp(1, 128);
    let old = manager.max_conn.swap(max, Ordering::Relaxed);
    if max > old {
        manager.conn_pool.add_permits(max - old);
    } else if max < old {
        manager.conn_pool.forget_permits(old - max);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};

    const DATA: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

    async fn serve_one(mut stream: TcpStream, data: &[u8]) {
        let mut buf = vec![0u8; 4096];
        let mut req_str = String::new();
        loop {
            let n = stream.read(&mut buf).await.unwrap();
            if n == 0 {
                break;
            }
            req_str.push_str(&String::from_utf8_lossy(&buf[..n]));
            if req_str.contains("\r\n\r\n") {
                break;
            }
        }

        let mut lines = req_str.lines();
        let request_line = lines.next().unwrap_or("");
        let method = request_line.split_whitespace().next().unwrap_or("GET");
        let path = request_line.split_whitespace().nth(1).unwrap_or("/");
        let mut range: Option<(u64, u64)> = None;

        if method == "HEAD" && path.contains("/nohead") {
            return; // simulate a server that never responds to HEAD
        }

        for line in lines {
            if line.to_lowercase().starts_with("range:") {
                let v = line.split_whitespace().nth(1).unwrap_or("");
                if let Some(rest) = v.strip_prefix("bytes=") {
                    let parts: Vec<&str> = rest.split('-').collect();
                    if parts.len() == 2 {
                        let start: u64 = parts[0].parse().unwrap_or(0);
                        let end: u64 = parts[1].parse().unwrap_or(data.len() as u64 - 1);
                        range = Some((start, end.min(data.len() as u64 - 1)));
                    }
                }
            }
        }

        if path.contains("/norange") {
            range = None;
        }

        let status = if range.is_some() { "206 Partial Content" } else { "200 OK" };
        let length = range.map(|(s, e)| e - s + 1).unwrap_or(data.len() as u64);
        let accept_ranges = if path.contains("/norange") { "" } else { "Accept-Ranges: bytes\r\n" };
        let content_range = match range {
            Some((s, e)) => format!("Content-Range: bytes {}-{}/{}\r\n", s, e, data.len()),
            None => String::new(),
        };
        let headers = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {length}\r\n{accept_ranges}{content_range}Connection: close\r\n\r\n"
        );
        stream.write_all(headers.as_bytes()).await.unwrap();

        match range {
            Some((s, e)) => {
                stream.write_all(&data[s as usize..=e as usize]).await.unwrap();
            }
            None => {
                stream.write_all(data).await.unwrap();
            }
        }
    }

    async fn spawn_server() -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let data = DATA.to_vec();
        let handle = tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, _)) => {
                        let data = data.clone();
                        tokio::spawn(async move { serve_one(stream, &data).await });
                    }
                    Err(_) => break,
                }
            }
        });
        (format!("http://{addr}"), handle)
    }

    #[test]
    fn derive_filename_strips_path_from_content_disposition() {
        let url = "https://178-63-138-106.top/Oceanofgames.com/Sudden_Strike_5_Deluxe_Edition_v1_06_29427.zip?md5=abc&expires=123";
        let cd = Some("attachment; filename=\"/Oceanofgames.com/Sudden_Strike_5_Deluxe_Edition_v1_06_29427.zip\"");
        let (name, ext) = derive_filename(url, cd);
        assert_eq!(name, "Sudden_Strike_5_Deluxe_Edition_v1_06_29427");
        assert_eq!(ext, "zip");
    }

    #[test]
    fn derive_filename_falls_back_to_url_basename() {
        let url = "https://host.com/path/file.bin?token=x";
        let (name, ext) = derive_filename(url, None);
        assert_eq!(name, "file");
        assert_eq!(ext, "bin");
    }

    #[test]
    fn derive_filename_keeps_simple_content_disposition() {
        let url = "https://ash-speed.hetzner.com/100MB.bin";
        let cd = Some("attachment; filename=\"100MB.bin\"");
        let (name, ext) = derive_filename(url, cd);
        assert_eq!(name, "100MB");
        assert_eq!(ext, "bin");
    }

    #[test]
    fn derive_filename_handles_windows_path_in_content_disposition() {
        let url = "https://host.com/download";
        let cd = Some("attachment; filename=\"C:\\Users\\bob\\archive.zip\"");
        let (name, ext) = derive_filename(url, cd);
        assert_eq!(name, "archive");
        assert_eq!(ext, "zip");
    }

    #[tokio::test]
    async fn probe_detects_range_support_and_size() {
        let (base, _h) = spawn_server().await;
        let client = reqwest::Client::new();
        let res = probe_impl(&client, &format!("{base}/file.bin")).await.unwrap();
        assert_eq!(res.size_bytes, DATA.len() as u64);
        assert!(res.range_supported);
        assert_eq!(res.extension, "bin");
    }

    #[tokio::test]
    async fn probe_detects_no_range_support() {
        let (base, _h) = spawn_server().await;
        let client = reqwest::Client::new();
        let res = probe_impl(&client, &format!("{base}/norange.bin")).await.unwrap();
        assert!(!res.range_supported);
    }

    #[tokio::test]
    async fn probe_falls_back_when_head_is_rejected() {
        let (base, _h) = spawn_server().await;
        let client = reqwest::Client::new();
        let res = probe_impl(&client, &format!("{base}/nohead.bin")).await.unwrap();
        assert_eq!(res.size_bytes, DATA.len() as u64);
        assert!(res.range_supported);
        assert_eq!(res.extension, "bin");
    }

    #[tokio::test]
    async fn segmented_download_completes_with_correct_content() {
        let (base, h) = spawn_server().await;
        let dir = std::env::temp_dir().join(format!("velox-test-{}", std::process::id()));
        let file_path = dir.join("result.bin");
        tokio::fs::create_dir_all(&dir).await.unwrap();

        let dl = Arc::new(ActiveDownload {
            id: "t1".to_string(),
            url: format!("{base}/file.bin"),
            file_path: file_path.clone(),
            total_size: DATA.len() as u64,
            range_supported: true,
            segment_count: 4,
            status: Mutex::new(DownloadStatus::Queued),
            last_error: Mutex::new(None),
            pause_flag: AtomicBool::new(false),
            cancel_flag: AtomicBool::new(false),
            segments: Mutex::new(Vec::new()),
            retries: Mutex::new(HashMap::new()),
            speed: AtomicU64::new(0),
            last_state_flush: Mutex::new(Instant::now()),
            conn_pool: Arc::new(Semaphore::new(4)),
        });

        let client = reqwest::Client::new();
        run_download_inner(None, dl.clone(), client, &dir, None).await;

        assert_eq!(*dl.status.lock().await, DownloadStatus::Completed);
        let got = tokio::fs::read(&file_path).await.unwrap();
        assert_eq!(got, DATA);

        let _ = tokio::fs::remove_dir_all(&dir).await;
        h.abort();
    }

    /// The global connection pool must cap the number of segments that are
    /// in flight at once, even when the download asks for more connections.
    #[tokio::test]
    async fn connection_pool_limits_concurrency() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let data = DATA.to_vec();
        let concurrent = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let c_inner = concurrent.clone();
        let p_inner = peak.clone();
        let handle = tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else { break };
                let data = data.clone();
                let c = c_inner.clone();
                let p = p_inner.clone();
                tokio::spawn(async move {
                    let now = c.fetch_add(1, Ordering::Relaxed) + 1;
                    p.fetch_max(now, Ordering::Relaxed);
                    serve_one(stream, &data).await;
                    c.fetch_sub(1, Ordering::Relaxed);
                });
            }
        });

        let base = format!("http://{addr}");
        let dir = std::env::temp_dir().join(format!("velox-pool-test-{}", std::process::id()));
        let file_path = dir.join("result.bin");
        tokio::fs::create_dir_all(&dir).await.unwrap();

        // Pool capped at 2, but the download requests 8 segments.
        let dl = Arc::new(ActiveDownload {
            id: "pool".to_string(),
            url: format!("{base}/file.bin"),
            file_path: file_path.clone(),
            total_size: DATA.len() as u64,
            range_supported: true,
            segment_count: 8,
            status: Mutex::new(DownloadStatus::Queued),
            last_error: Mutex::new(None),
            pause_flag: AtomicBool::new(false),
            cancel_flag: AtomicBool::new(false),
            segments: Mutex::new(Vec::new()),
            retries: Mutex::new(HashMap::new()),
            speed: AtomicU64::new(0),
            last_state_flush: Mutex::new(Instant::now()),
            conn_pool: Arc::new(Semaphore::new(2)),
        });

        let client = reqwest::Client::new();
        run_download_inner(None, dl.clone(), client, &dir, None).await;

        assert_eq!(*dl.status.lock().await, DownloadStatus::Completed);
        assert!(peak.load(Ordering::Relaxed) <= 2, "peak concurrency was {}", peak.load(Ordering::Relaxed));
        let got = tokio::fs::read(&file_path).await.unwrap();
        assert_eq!(got, DATA);

        let _ = tokio::fs::remove_dir_all(&dir).await;
        handle.abort();
    }
}
