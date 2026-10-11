//! Browser-integration IPC host.
//!
//! Listens on a local endpoint (unix socket on macOS/Linux, named pipe on
//! Windows) that the stateless native-messaging shim connects to. The shim
//! forwards Chrome's Native Messaging frames verbatim, so this module speaks
//! the same length-prefixed JSON protocol (see the `velox-protocol` crate).
//!
//! Cancellation semantics:
//! - `cancel_download` (extension -> app) stops the transfer, deletes the
//!   partial file, resume state, and history row.
//! - Disconnecting the extension does NOT cancel an in-flight download; the
//!   app owns the transfer and it continues to completion.
//! - Pausing is distinct from cancelling: pause keeps the partial file and
//!   resume state so the transfer can continue later.

use std::collections::HashSet;

use tauri::{AppHandle, Manager};
use tokio::io::{AsyncRead, AsyncWrite};

use crate::download::{begin_download, cancel_active, probe_impl, DownloadManager, StartRequest};
use velox_protocol::{
    kind, CancelDownloadPayload, DownloadRequestPayload, ErrorPayload, Envelope, ReadyPayload,
    PROTOCOL_VERSION,
};

/// Default number of segments for browser-submitted downloads.
const DEFAULT_SEGMENTS: usize = 8;

/// Start the IPC host on a background runtime task.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = serve(app).await {
            eprintln!("velox browser host: {e}");
        }
    });
}

fn new_download_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("br-{nanos:x}")
}

async fn handle_conn<S>(app: AppHandle, stream: S)
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (mut reader, mut writer) = tokio::io::split(stream);
    let mut seen: HashSet<String> = HashSet::new();
    loop {
        match velox_protocol::read_envelope(&mut reader).await {
            Ok(Some(env)) => {
                // Reject duplicate request ids on a connection instead of
                // processing the same request twice.
                if !seen.insert(env.id.clone()) {
                    let _ = reply_error(
                        &mut writer,
                        &env.id,
                        "DUPLICATE_REQUEST",
                        "A request with this id was already processed",
                    )
                    .await;
                    continue;
                }
                if dispatch(&app, &mut writer, env).await.is_err() {
                    break;
                }
            }
            Ok(None) => break,
            Err(_) => break,
        }
    }
}

async fn reply<W, T>(writer: &mut W, id: &str, kind: &str, payload: T) -> std::io::Result<()>
where
    W: AsyncWrite + Unpin,
    T: serde::Serialize,
{
    let env = Envelope::new(id, kind, payload);
    velox_protocol::write_envelope(writer, &env).await
}

async fn reply_error<W>(
    writer: &mut W,
    id: &str,
    code: &str,
    message: &str,
) -> std::io::Result<()>
where
    W: AsyncWrite + Unpin,
{
    reply(writer, id, kind::ERROR, ErrorPayload::new(code, message)).await
}

async fn dispatch<W>(app: &AppHandle, writer: &mut W, env: Envelope) -> std::io::Result<()>
where
    W: AsyncWrite + Unpin,
{
    if env.version != PROTOCOL_VERSION {
        return reply_error(
            writer,
            &env.id,
            "UNSUPPORTED_VERSION",
            &format!(
                "Unsupported protocol version {} (expected {})",
                env.version, PROTOCOL_VERSION
            ),
        )
        .await;
    }

    match env.kind.as_str() {
        kind::HELLO => {
            let ready = ReadyPayload {
                app_version: app.package_info().version.to_string(),
                capabilities: vec!["download".to_string()],
            };
            reply(writer, &env.id, kind::READY, ready).await
        }
        kind::DOWNLOAD_REQUEST => {
            let payload: DownloadRequestPayload = match velox_protocol::decode(&env) {
                Ok(p) => p,
                Err(_) => {
                    return reply_error(writer, &env.id, "INVALID_REQUEST", "Malformed download request")
                        .await
                }
            };

            let manager = app.state::<DownloadManager>();
            match probe_impl(&manager.client, &payload.url).await {
                Ok(probe) => {
                    let id = new_download_id();
                    let request = StartRequest {
                        id: id.clone(),
                        url: probe.url,
                        name: probe.name,
                        extension: probe.extension,
                        size_bytes: probe.size_bytes,
                        download_dir: String::new(),
                        range_supported: probe.range_supported,
                        segments: DEFAULT_SEGMENTS,
                    };
                    match begin_download(app, manager.inner(), request).await {
                        Ok(()) => {
                            reply(
                                writer,
                                &env.id,
                                kind::DOWNLOAD_ACCEPTED,
                                serde_json::json!({ "downloadId": id }),
                            )
                            .await
                        }
                        Err(e) => reply_error(writer, &env.id, "START_FAILED", &e).await,
                    }
                }
                Err(e) => reply_error(writer, &env.id, "PROBE_FAILED", &e).await,
            }
        }
        kind::CANCEL_DOWNLOAD => {
            let payload: CancelDownloadPayload = match velox_protocol::decode(&env) {
                Ok(p) => p,
                Err(_) => {
                    return reply_error(writer, &env.id, "INVALID_REQUEST", "Malformed cancel request")
                        .await
                }
            };
            let manager = app.state::<DownloadManager>();
            cancel_active(manager.inner(), &payload.download_id).await;
            reply(
                writer,
                &env.id,
                kind::CANCEL_DOWNLOAD,
                serde_json::json!({ "downloadId": payload.download_id, "cancelled": true }),
            )
            .await
        }
        _ => reply_error(writer, &env.id, "UNSUPPORTED", "Unknown message type").await,
    }
}

#[cfg(unix)]
async fn serve(app: AppHandle) -> std::io::Result<()> {
    use std::path::Path;

    let endpoint = velox_protocol::endpoint();
    if let Some(parent) = Path::new(&endpoint).parent() {
        std::fs::create_dir_all(parent)?;
    }
    let _ = std::fs::remove_file(&endpoint);

    let listener = tokio::net::UnixListener::bind(&endpoint)?;
    loop {
        let (stream, _) = listener.accept().await?;
        let app = app.clone();
        tauri::async_runtime::spawn(async move { handle_conn(app, stream).await });
    }
}

#[cfg(windows)]
async fn serve(app: AppHandle) -> std::io::Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;

    let endpoint = velox_protocol::endpoint();
    loop {
        let server = ServerOptions::new().create(&endpoint)?;
        server.connect().await?;
        // Handle sequentially: a single extension port is expected for v1.
        handle_conn(app.clone(), server).await;
    }
}
