//! Native-messaging host registration.
//!
//! Writes the browser host manifests that let Chrome/Edge/Brave launch the
//! bundled `velox-native-host` shim. Called on app startup; idempotent, so it
//! re-asserts registration after upgrades. In development the shim is not next
//! to the app binary, so this is a no-op (use `scripts/register-native-host.*`).

use std::path::PathBuf;

pub const HOST_NAME: &str = "com.velox.native_host";
/// Pinned extension id (derived from the public key in the extension manifest).
pub const EXTENSION_ID: &str = "okdolpgpihdjefkinecghpnjhedjicee";

fn shim_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let name = if cfg!(windows) {
        "velox-native-host.exe"
    } else {
        "velox-native-host"
    };
    let candidate = dir.join(name);
    candidate.exists().then_some(candidate)
}

fn manifest_text(shim: &PathBuf) -> String {
    let value = serde_json::json!({
        "name": HOST_NAME,
        "description": "Velox browser integration",
        "path": shim.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{EXTENSION_ID}/")],
    });
    serde_json::to_string_pretty(&value).unwrap_or_default()
}

/// Register the native host for all supported browsers. Best-effort: returns an
/// error only for unexpected failures.
pub fn register() -> Result<(), String> {
    let Some(shim) = shim_path() else {
        // Development build (shim not beside the app) — nothing to do.
        return Ok(());
    };
    let manifest = manifest_text(&shim);

    #[cfg(target_os = "macos")]
    {
        for base in [
            "Library/Application Support/Google/Chrome/NativeMessagingHosts",
            "Library/Application Support/Microsoft Edge/NativeMessagingHosts",
            "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts",
        ] {
            write_manifest(&home_dir().join(base), &manifest)?;
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for base in [
            ".config/google-chrome/NativeMessagingHosts",
            ".config/microsoft-edge/NativeMessagingHosts",
            ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts",
        ] {
            write_manifest(&home_dir().join(base), &manifest)?;
        }
    }

    #[cfg(windows)]
    {
        write_windows(&manifest)?;
    }

    Ok(())
}

#[cfg(unix)]
fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
}

#[cfg(any(target_os = "macos", all(unix, not(target_os = "macos"))))]
fn write_manifest(dir: &PathBuf, manifest: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{HOST_NAME}.json")), manifest).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn write_windows(manifest: &str) -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let base = std::env::var("LOCALAPPDATA").map_err(|_| "LOCALAPPDATA not set".to_string())?;
    let dir = PathBuf::from(base).join("Velox");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let manifest_path = dir.join("native-host.json");
    std::fs::write(&manifest_path, manifest).map_err(|e| e.to_string())?;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for browser in ["Google\\Chrome", "Microsoft\\Edge", "BraveSoftware\\Brave-Browser"] {
        let key = format!("Software\\{browser}\\NativeMessagingHosts\\{HOST_NAME}");
        let (sub, _) = hkcu.create_subkey(&key).map_err(|e| e.to_string())?;
        sub.set_value("", &manifest_path.to_string_lossy().to_string())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
