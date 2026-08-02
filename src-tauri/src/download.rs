use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::header::{ACCEPT_RANGES, CONTENT_DISPOSITION, CONTENT_TYPE, RANGE};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::fs::{File, OpenOptions};
use tokio::io::{AsyncSeekExt, AsyncWriteExt, SeekFrom};
use tokio::sync::Mutex;
use tokio::task::JoinSet;

const PROGRESS_INTERVAL: Duration = Duration::from_millis(400);
const MAX_SEGMENT_RETRIES: u32 = 12;
const RETRY_BACKOFF: Duration = Duration::from_millis(800);

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
}

pub struct DownloadManager {
    pub client: reqwest::Client,
    downloads: Mutex<HashMap<String, Arc<ActiveDownload>>>,
}

impl Default for DownloadManager {
    fn default() -> Self {
        Self {
            client: reqwest::Client::new(),
            downloads: Mutex::new(HashMap::new()),
        }
    }
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
                let dot = trimmed.rfind('.');
                if let Some(d) = dot {
                    return (trimmed[..d].to_string(), trimmed[d + 1..].to_string());
                }
                return (trimmed.to_string(), "bin".to_string());
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
    let head = client.head(url).send().await;

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
            .send()
            .await
            .map_err(|e| format!("Probe request failed: {e}"))?;
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

async fn run_segment(
    dl: Arc<ActiveDownload>,
    client: reqwest::Client,
    seg: SegmentState,
) -> (usize, Result<(), SegmentError>) {
    let index = seg.index;
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
        return Err(SegmentError {
            message: format!(
                "server did not honor Range request (status {})",
                status
            ),
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

async fn run_download(app: AppHandle, dl: Arc<ActiveDownload>, client: reqwest::Client) {
    run_download_inner(Some(&app), dl, client).await;
}

async fn run_download_inner(
    app: Option<&AppHandle>,
    dl: Arc<ActiveDownload>,
    client: reqwest::Client,
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

                if *dl.status.lock().await == DownloadStatus::Error {
                    join.abort_all();
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
                    if let Some(app) = app {
                        emit_progress(app, &dl, downloaded).await;
                    }
                    return;
                }
                if done && join.is_empty() {
                    *dl.status.lock().await = DownloadStatus::Completed;
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
    let file_path = PathBuf::from(&request.download_dir)
        .join(format!("{}.{}", request.name, request.extension));

    let dl = Arc::new(ActiveDownload {
        id: request.id.clone(),
        url: request.url.clone(),
        file_path,
        total_size: request.size_bytes,
        range_supported: request.range_supported,
        segment_count: request.segments,
        status: Mutex::new(DownloadStatus::Queued),
        last_error: Mutex::new(None),
        pause_flag: AtomicBool::new(false),
        cancel_flag: AtomicBool::new(false),
        segments: Mutex::new(Vec::new()),
        retries: Mutex::new(HashMap::new()),
        speed: AtomicU64::new(0),
    });

    manager.downloads.lock().await.insert(request.id, dl.clone());
    let client = manager.client.clone();
    tauri::async_runtime::spawn(run_download(app, dl, client));
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
    tauri::async_runtime::spawn(run_download(app, dl, client));
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
    manager.downloads.lock().await.remove(&id);
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
        });

        let client = reqwest::Client::new();
        run_download_inner(None, dl.clone(), client).await;

        assert_eq!(*dl.status.lock().await, DownloadStatus::Completed);
        let got = tokio::fs::read(&file_path).await.unwrap();
        assert_eq!(got, DATA);

        let _ = tokio::fs::remove_dir_all(&dir).await;
        h.abort();
    }
}
