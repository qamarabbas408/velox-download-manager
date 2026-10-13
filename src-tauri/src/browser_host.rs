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

use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use tauri::{AppHandle, Manager};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{mpsc, Mutex};

use crate::download::{
    assist_begin, assist_chunk, assist_complete, assist_failed, assist_pending_begin, begin_download,
    cancel_active, probe_impl, DownloadManager, StartRequest,
};
use velox_protocol::{
    kind, AssistCompletedPayload, AssistFailedPayload, AssistRequestPayload, AssistStartedPayload,
    CancelDownloadPayload, ChunkPayload, DownloadRequestPayload, Envelope, HelloPayload,
    PROTOCOL_VERSION,
};

/// Default number of segments for browser-submitted downloads.
const DEFAULT_SEGMENTS: usize = 8;
/// Outbound queue depth per connection.
const OUTBOUND_QUEUE: usize = 64;

type Tx = mpsc::Sender<Envelope>;

/// A registered extension client.
pub struct ClientEntry {
    pub tx: Tx,
    pub browser: String,
}

/// Registry of connected extension clients, keyed by the client id the
/// extension reports in its `hello`. Used to push messages (e.g. assist
/// requests) to the correct browser profile.
#[derive(Default)]
pub struct BrowserClients(pub Mutex<HashMap<String, ClientEntry>>);

impl BrowserClients {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }

    /// Register a client connection. A newer connection with the same id
    /// replaces the previous registration.
    pub async fn register(&self, client_id: String, tx: Tx, browser: String) {
        self.0
            .lock()
            .await
            .insert(client_id, ClientEntry { tx, browser });
    }

    /// Remove a client registration, but only if it still belongs to this
    /// connection. This prevents a closing connection from evicting a newer
    /// registration that reused the same client id.
    pub async fn unregister(&self, client_id: &str, tx: &Tx) {
        let mut reg = self.0.lock().await;
        if let Some(existing) = reg.get(client_id) {
            if existing.tx.same_channel(tx) {
                reg.remove(client_id);
            }
        }
    }

    /// Send a message to a specific connected client. Returns a clear error if
    /// the client is unknown or its connection has closed.
    pub async fn send_to(&self, client_id: &str, env: Envelope) -> Result<(), String> {
        let tx = self.0.lock().await.get(client_id).map(|e| e.tx.clone());
        match tx {
            Some(tx) => tx
                .send(env)
                .await
                .map_err(|_| format!("client {client_id} disconnected")),
            None => Err(format!("client {client_id} is not connected")),
        }
    }

    /// The browser label reported by a client (if connected).
    pub async fn browser_of(&self, client_id: &str) -> Option<String> {
        self.0.lock().await.get(client_id).map(|e| e.browser.clone())
    }
}

/// Start the IPC host on a background runtime task.
pub fn spawn(app: AppHandle, clients: Arc<BrowserClients>) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = serve(app, clients).await {
            eprintln!("velox browser host: {e}");
        }
    });
}

fn new_id(prefix: &str) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{prefix}-{nanos:x}")
}

fn new_download_id() -> String {
    new_id("br")
}

async fn reply(
    tx: &Tx,
    id: &str,
    kind: &str,
    payload: serde_json::Value,
) -> Result<(), ()> {
    let env = Envelope::new(id, kind, payload);
    tx.send(env).await.map_err(|_| ())
}

async fn reply_error(tx: &Tx, id: &str, code: &str, message: &str) -> Result<(), ()> {
    reply(
        tx,
        id,
        kind::ERROR,
        serde_json::json!({ "code": code, "message": message }),
    )
    .await
}

async fn handle_conn<S>(app: AppHandle, clients: Arc<BrowserClients>, stream: S)
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (mut reader, writer) = tokio::io::split(stream);
    let (tx, mut rx) = mpsc::channel::<Envelope>(OUTBOUND_QUEUE);

    // Single writer task serializes all outbound messages for this connection.
    let writer_task = tauri::async_runtime::spawn(async move {
        let mut writer = writer;
        while let Some(env) = rx.recv().await {
            if velox_protocol::write_envelope(&mut writer, &env).await.is_err() {
                break;
            }
        }
    });

    let mut seen: HashSet<String> = HashSet::new();
    let mut client_id: Option<String> = None;

    loop {
        match velox_protocol::read_envelope(&mut reader).await {
            Ok(Some(env)) => {
                if !seen.insert(env.id.clone()) {
                    let _ = reply_error(
                        &tx,
                        &env.id,
                        "DUPLICATE_REQUEST",
                        "A request with this id was already processed",
                    )
                    .await;
                    continue;
                }
                if env.version != PROTOCOL_VERSION {
                    let _ = reply_error(
                        &tx,
                        &env.id,
                        "UNSUPPORTED_VERSION",
                        &format!(
                            "Unsupported protocol version {} (expected {})",
                            env.version, PROTOCOL_VERSION
                        ),
                    )
                    .await;
                    continue;
                }
                handle_message(&app, &clients, &tx, env, &mut client_id).await;
            }
            Ok(None) => break,
            Err(_) => break,
        }
    }

    // Cleanup: drop the registry entry; the writer task ends when tx drops.
    if let Some(id) = client_id {
        clients.unregister(&id, &tx).await;
    }
    drop(tx);
    let _ = writer_task.await;
}

async fn handle_message(
    app: &AppHandle,
    clients: &Arc<BrowserClients>,
    tx: &Tx,
    env: Envelope,
    client_id: &mut Option<String>,
) {
    match env.kind.as_str() {
        kind::HELLO => {
            let hello: HelloPayload = match velox_protocol::decode(&env) {
                Ok(h) => h,
                Err(_) => {
                    let _ = reply_error(tx, &env.id, "INVALID_REQUEST", "Malformed hello").await;
                    return;
                }
            };
            *client_id = Some(hello.client_id.clone());
            clients
                .register(hello.client_id.clone(), tx.clone(), hello.browser.clone())
                .await;

            let _ = reply(
                tx,
                &env.id,
                kind::READY,
                serde_json::json!({
                    "appVersion": app.package_info().version.to_string(),
                    "capabilities": ["download", "assist", "ping"],
                }),
            )
            .await;

            // M1 connectivity probe: push a ping; the extension replies pong.
            let _ = reply(tx, &new_id("ping"), kind::PING, serde_json::json!({})).await;
        }
        kind::PING => {
            let _ = reply(tx, &env.id, kind::PONG, serde_json::json!({})).await;
        }
        kind::PONG => {
            eprintln!("velox browser host: pong from client {:?}", client_id);
        }
        kind::CANCEL_DOWNLOAD => {
            let payload: CancelDownloadPayload = match velox_protocol::decode(&env) {
                Ok(p) => p,
                Err(_) => {
                    let _ =
                        reply_error(tx, &env.id, "INVALID_REQUEST", "Malformed cancel request").await;
                    return;
                }
            };
            let manager = app.state::<DownloadManager>();
            cancel_active(manager.inner(), &payload.download_id).await;
            let _ = reply(
                tx,
                &env.id,
                kind::CANCEL_DOWNLOAD,
                serde_json::json!({ "downloadId": payload.download_id, "cancelled": true }),
            )
            .await;
        }
        kind::DOWNLOAD_REQUEST => {
            // Heavy: probe + start. Handle off the reader loop so the
            // connection stays responsive (needed for streaming later).
            let app = app.clone();
            let tx = tx.clone();
            let origin = client_id.clone();
            let browser = match &origin {
                Some(id) => clients.browser_of(id).await,
                None => None,
            };
            tauri::async_runtime::spawn(async move {
                handle_download_request(app, tx, env, origin, browser).await;
            });
        }
        kind::ASSIST_PENDING => {
            if let Ok(p) = velox_protocol::decode::<AssistStartedPayload>(&env) {
                let manager = app.state::<DownloadManager>();
                let _ =
                    assist_pending_begin(app, manager.inner(), &p.download_id, &p.transfer_id).await;
            }
        }
        kind::ASSIST_STARTED => {
            if let Ok(p) = velox_protocol::decode::<AssistStartedPayload>(&env) {
                let manager = app.state::<DownloadManager>();
                let _ = assist_begin(
                    app,
                    manager.inner(),
                    &p.download_id,
                    &p.transfer_id,
                    p.total_bytes,
                )
                .await;
                eprintln!("velox browser host: assist started for {}", p.download_id);
            }
        }
        kind::CHUNK => {
            let payload: ChunkPayload = match velox_protocol::decode(&env) {
                Ok(p) => p,
                Err(_) => {
                    let _ = reply_error(tx, &env.id, "INVALID_CHUNK", "Malformed chunk").await;
                    return;
                }
            };
            let bytes = match STANDARD.decode(payload.data.as_bytes()) {
                Ok(b) => b,
                Err(_) => {
                    let _ = reply_error(tx, &env.id, "INVALID_CHUNK", "Chunk not valid base64").await;
                    return;
                }
            };
            let manager = app.state::<DownloadManager>();
            let accepted = assist_chunk(
                app,
                manager.inner(),
                &payload.download_id,
                &payload.transfer_id,
                payload.offset,
                &bytes,
            )
            .await
            .is_ok();
            // A `cancelled: true` ack tells the extension to stop streaming
            // (download removed, or a superseded transfer).
            let _ = reply(
                tx,
                &new_id("ack"),
                kind::CHUNK_ACK,
                serde_json::json!({
                    "downloadId": payload.download_id,
                    "transferId": payload.transfer_id,
                    "seq": payload.seq,
                    "cancelled": !accepted,
                }),
            )
            .await;
        }
        kind::ASSIST_COMPLETED => {
            if let Ok(p) = velox_protocol::decode::<AssistCompletedPayload>(&env) {
                let manager = app.state::<DownloadManager>();
                assist_complete(app, manager.inner(), &p.download_id, &p.transfer_id).await;
            }
        }
        kind::ASSIST_FAILED => {
            if let Ok(p) = velox_protocol::decode::<AssistFailedPayload>(&env) {
                let manager = app.state::<DownloadManager>();
                assist_failed(app, manager.inner(), &p.download_id, &p.transfer_id, p.message).await;
            }
        }
        _ => {
            let _ = reply_error(tx, &env.id, "UNSUPPORTED", "Unknown message type").await;
        }
    }
}

async fn handle_download_request(
    app: AppHandle,
    tx: Tx,
    env: Envelope,
    origin: Option<String>,
    browser: Option<String>,
) {
    let payload: DownloadRequestPayload = match velox_protocol::decode(&env) {
        Ok(p) => p,
        Err(_) => {
            let _ = reply_error(&tx, &env.id, "INVALID_REQUEST", "Malformed download request").await;
            return;
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
            match begin_download(&app, manager.inner(), request, false).await {
                Ok(()) => {
                    manager.set_origin_client(&id, origin).await;
                    manager.set_origin_browser(&id, browser).await;
                    let _ = reply(
                        &tx,
                        &env.id,
                        kind::DOWNLOAD_ACCEPTED,
                        serde_json::json!({ "downloadId": id }),
                    )
                    .await;
                }
                Err(e) => {
                    let _ = reply_error(&tx, &env.id, e.code(), &e.message()).await;
                }
            }
        }
        Err(e) => {
            let _ = reply_error(&tx, &env.id, "PROBE_FAILED", &e).await;
        }
    }
}

/// Request browser assistance for an eligible failed download. Routes to the
/// browser client that originally submitted it.
#[tauri::command]
pub async fn assist_download(
    clients: tauri::State<'_, Arc<BrowserClients>>,
    manager: tauri::State<'_, DownloadManager>,
    id: String,
) -> Result<(), String> {
    let (url, origin, eligible) = manager
        .assist_info(&id)
        .await
        .ok_or_else(|| "Download not found".to_string())?;

    if !eligible {
        return Err("This download isn't eligible for browser assistance.".to_string());
    }

    let client_id = origin.ok_or_else(|| {
        "This download wasn't started from the browser. Open your browser with the Velox extension connected, then retry.".to_string()
    })?;

    let clients = clients.inner().clone();
    let payload = AssistRequestPayload {
        download_id: id,
        url,
        method: "GET".to_string(),
        reason: "native_failed".to_string(),
    };
    let env = Envelope::new(
        new_id("assist"),
        kind::ASSIST_REQUEST,
        serde_json::to_value(payload).map_err(|e| e.to_string())?,
    );
    clients.send_to(&client_id, env).await
}

/// Push a ping to one or all connected extension clients (M1 test helper).
#[tauri::command]
pub async fn ping_browser(
    clients: tauri::State<'_, Arc<BrowserClients>>,
    client_id: Option<String>,
) -> Result<u32, String> {
    let clients = clients.inner().clone();

    if let Some(id) = client_id {
        let env = Envelope::new(new_id("ping"), kind::PING, serde_json::json!({}));
        clients.send_to(&id, env).await?;
        return Ok(1);
    }

    // Snapshot senders so we don't hold the registry lock across awaits.
    let targets: Vec<(String, Tx)> = {
        let reg = clients.0.lock().await;
        reg.iter().map(|(k, v)| (k.clone(), v.tx.clone())).collect()
    };
    let mut sent = 0u32;
    for (id, tx) in targets {
        let env = Envelope::new(new_id("ping"), kind::PING, serde_json::json!({}));
        if tx.send(env).await.is_ok() {
            sent += 1;
        } else {
            clients.unregister(&id, &tx).await;
        }
    }
    Ok(sent)
}

#[cfg(unix)]
async fn serve(app: AppHandle, clients: Arc<BrowserClients>) -> std::io::Result<()> {
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
        let clients = clients.clone();
        tauri::async_runtime::spawn(async move { handle_conn(app, clients, stream).await });
    }
}

#[cfg(windows)]
async fn serve(app: AppHandle, clients: Arc<BrowserClients>) -> std::io::Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;

    let endpoint = velox_protocol::endpoint();
    loop {
        let server = ServerOptions::new().create(&endpoint)?;
        server.connect().await?;
        // Handle sequentially: a single extension port is expected for v1.
        handle_conn(app.clone(), clients.clone(), server).await;
    }
}
