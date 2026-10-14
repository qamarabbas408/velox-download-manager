//! Velox Native Messaging host shim.
//!
//! Chrome spawns this process for each extension connection and speaks the
//! Native Messaging framing over stdio. The shim is intentionally stateless: it
//! opens a local IPC connection to the running Velox app and transparently
//! pumps bytes between stdio and that connection. It performs no parsing,
//! downloads nothing, and owns no state.

use std::io;

#[tokio::main]
async fn main() {
    let endpoint = velox_protocol::endpoint();
    if let Err(e) = run(&endpoint).await {
        eprintln!("velox-native-host: {e}");
        std::process::exit(1);
    }
}

#[cfg(unix)]
async fn connect(endpoint: &str) -> io::Result<tokio::net::UnixStream> {
    tokio::net::UnixStream::connect(endpoint).await
}

#[cfg(windows)]
async fn connect(
    endpoint: &str,
) -> io::Result<tokio::net::windows::named_pipe::NamedPipeClient> {
    tokio::net::windows::named_pipe::ClientOptions::new().open(endpoint)
}

async fn run(endpoint: &str) -> io::Result<()> {
    let stream = connect(endpoint).await?;
    let (mut sock_r, mut sock_w) = tokio::io::split(stream);
    let mut stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();

    // Pump both directions until either side closes.
    tokio::select! {
        r = tokio::io::copy(&mut stdin, &mut sock_w) => { r?; }
        r = tokio::io::copy(&mut sock_r, &mut stdout) => { r?; }
    }

    Ok(())
}
