//! Shared types and framing for Velox browser integration.
//!
//! The native host shim is a transparent byte pump, so the bytes forwarded
//! over the local IPC endpoint use the exact same framing as Chrome's Native
//! Messaging transport: a 4-byte little-endian length prefix followed by a
//! UTF-8 JSON payload.

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// Wire protocol version. Bump on breaking message changes.
pub const PROTOCOL_VERSION: u32 = 1;

/// Reverse-DNS application identifier. Used to derive the IPC endpoint.
pub const APP_ID: &str = "com.qabbas715.velox";

/// Largest single message accepted from the browser (matches Chrome's
/// extension -> native host limit).
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024 * 1024;

pub mod kind {
    pub const HELLO: &str = "hello";
    pub const READY: &str = "ready";
    pub const DOWNLOAD_REQUEST: &str = "download_request";
    pub const DOWNLOAD_ACCEPTED: &str = "download_accepted";
    pub const DOWNLOAD_REJECTED: &str = "download_rejected";
    pub const ASSIST_REQUEST: &str = "assist_request";
    pub const ASSIST_STARTED: &str = "assist_started";
    pub const CHUNK: &str = "chunk";
    pub const CHUNK_ACK: &str = "chunk_ack";
    pub const ASSIST_COMPLETED: &str = "assist_completed";
    pub const CANCEL_DOWNLOAD: &str = "cancel_download";
    pub const ERROR: &str = "error";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope<T = serde_json::Value> {
    pub version: u32,
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub payload: T,
}

impl<T> Envelope<T> {
    pub fn new(id: impl Into<String>, kind: impl Into<String>, payload: T) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            id: id.into(),
            kind: kind.into(),
            payload,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelloPayload {
    pub ext_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadyPayload {
    pub app_version: String,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequestPayload {
    pub url: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub referrer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_agent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggested_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelDownloadPayload {
    pub download_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
}

impl ErrorPayload {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

/// Read one length-prefixed message. Returns `Ok(None)` on a clean EOF.
pub async fn read_message<R>(reader: &mut R) -> std::io::Result<Option<Vec<u8>>>
where
    R: AsyncRead + Unpin,
{
    let mut len = [0u8; 4];
    match reader.read_exact(&mut len).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }

    let size = u32::from_le_bytes(len) as usize;
    if size > MAX_MESSAGE_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("message of {size} bytes exceeds limit"),
        ));
    }

    let mut buf = vec![0u8; size];
    reader.read_exact(&mut buf).await?;
    Ok(Some(buf))
}

/// Read and decode one message into an [`Envelope`].
pub async fn read_envelope<R>(reader: &mut R) -> std::io::Result<Option<Envelope>>
where
    R: AsyncRead + Unpin,
{
    match read_message(reader).await? {
        None => Ok(None),
        Some(bytes) => {
            let env = serde_json::from_slice(&bytes)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
            Ok(Some(env))
        }
    }
}

/// Decode an envelope's payload into a concrete type.
pub fn decode<T: DeserializeOwned>(env: &Envelope) -> std::io::Result<T> {
    serde_json::from_value(env.payload.clone())
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

/// Write one length-prefixed message.
pub async fn write_message<W>(writer: &mut W, data: &[u8]) -> std::io::Result<()>
where
    W: AsyncWrite + Unpin,
{
    let len = (data.len() as u32).to_le_bytes();
    writer.write_all(&len).await?;
    writer.write_all(data).await?;
    writer.flush().await
}

/// Encode and write one [`Envelope`].
pub async fn write_envelope<W, T>(writer: &mut W, env: &Envelope<T>) -> std::io::Result<()>
where
    W: AsyncWrite + Unpin,
    T: Serialize,
{
    let bytes = serde_json::to_vec(env)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    write_message(writer, &bytes).await
}

/// The local IPC endpoint the shim connects to and the app listens on.
///
/// - macOS: `~/Library/Application Support/<APP_ID>/browser.sock`
/// - Linux: `$XDG_DATA_HOME/<APP_ID>/browser.sock` (falls back to `~/.local/share`)
/// - Windows: `\\.\pipe\<APP_ID>.browser`
pub fn endpoint() -> String {
    #[cfg(windows)]
    {
        format!(r"\\.\pipe\{APP_ID}.browser")
    }

    #[cfg(not(windows))]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());

        #[cfg(target_os = "macos")]
        let dir = format!("{home}/Library/Application Support/{APP_ID}");

        #[cfg(all(unix, not(target_os = "macos")))]
        let dir = {
            let base = std::env::var("XDG_DATA_HOME")
                .unwrap_or_else(|_| format!("{home}/.local/share"));
            format!("{base}/{APP_ID}")
        };

        format!("{dir}/browser.sock")
    }
}
