//! Destination-volume free-space checks used by the download preflight.
//!
//! This deliberately does not reuse the sidebar's capacity fallback: if the
//! volume for a path cannot be determined we return an error so callers can
//! fail safely instead of assuming free space.

use std::io;
use std::path::{Path, PathBuf};

use sysinfo::Disks;

/// Space kept free on the destination volume: the file itself must fit, plus
/// this reserve, so a download never consumes the last usable bytes.
pub const SAFETY_RESERVE_BYTES: u64 = 256 * 1024 * 1024;

/// Free bytes on the volume that contains `path`.
///
/// Resolves the nearest existing ancestor (the destination directory may not
/// exist yet) and matches it to the longest mounted volume. Returns an error
/// when no volume matches so the caller can reject the download.
pub fn available_space(path: &Path) -> io::Result<u64> {
    let probe = nearest_existing(path)?;
    #[cfg(windows)]
    let probe = normalize_windows_path(&probe);
    let disks = Disks::new_with_refreshed_list();

    let mut best: Option<(usize, u64)> = None;
    for disk in disks.list() {
        let mount = disk.mount_point();
        if !starts_with_path(&probe, mount) {
            continue;
        }
        let len = mount.as_os_str().len();
        if best.map_or(true, |(best_len, _)| len > best_len) {
            best = Some((len, disk.available_space()));
        }
    }

    best.map(|(_, bytes)| bytes).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            format!("could not determine the volume for {}", path.display()),
        )
    })
}

/// Bytes that must be free to start or resume a download.
pub fn required_bytes(expected: u64, active_expected: u64) -> u64 {
    expected
        .saturating_add(SAFETY_RESERVE_BYTES)
        .saturating_add(active_expected)
}

pub fn fits(available: u64, required: u64) -> bool {
    available >= required
}

pub fn shortfall(available: u64, required: u64) -> u64 {
    required.saturating_sub(available)
}

fn nearest_existing(path: &Path) -> io::Result<PathBuf> {
    let mut probe = path.to_path_buf();
    loop {
        if let Ok(canonical) = probe.canonicalize() {
            return Ok(canonical);
        }
        match probe.parent() {
            Some(parent) if parent != probe => probe = parent.to_path_buf(),
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    format!("could not resolve {}", path.display()),
                ))
            }
        }
    }
}

#[cfg(not(windows))]
fn starts_with_path(path: &Path, base: &Path) -> bool {
    path.starts_with(base)
}

#[cfg(windows)]
fn normalize_windows_path(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path.to_path_buf()
    }
}

#[cfg(windows)]
fn starts_with_path(path: &Path, base: &Path) -> bool {
    let p: Vec<String> = path
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_ascii_lowercase())
        .collect();
    let b: Vec<String> = base
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_ascii_lowercase())
        .collect();
    p.len() >= b.len() && p[..b.len()] == b[..]
}

/// True when an I/O error means the destination is out of space.
pub fn is_disk_full(err: &io::Error) -> bool {
    #[cfg(unix)]
    const CODES: &[i32] = &[28, 122]; // ENOSPC, EDQUOT
    #[cfg(windows)]
    const CODES: &[i32] = &[112, 39]; // ERROR_DISK_FULL, ERROR_HANDLE_DISK_FULL
    #[cfg(not(any(unix, windows)))]
    const CODES: &[i32] = &[];

    err.raw_os_error()
        .map(|code| CODES.contains(&code))
        .unwrap_or(false)
}

/// Human-readable byte size for user-facing messages.
pub fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    let mut value = bytes as f64;
    let mut unit = 0usize;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    format!("{value:.1} {}", UNITS[unit])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn required_includes_file_reserve_and_active() {
        assert_eq!(required_bytes(100, 50), 100 + SAFETY_RESERVE_BYTES + 50);
    }

    #[test]
    fn fits_honors_exact_boundary_and_shortfall() {
        let required = 100 + SAFETY_RESERVE_BYTES;
        assert!(fits(required, required));
        assert!(!fits(required - 1, required));
        assert_eq!(shortfall(required - 1, required), 1);
        assert_eq!(shortfall(required, required), 0);
    }

    #[test]
    fn required_saturates_on_huge_values() {
        assert_eq!(required_bytes(u64::MAX, u64::MAX), u64::MAX);
    }

    #[test]
    fn active_downloads_reduce_the_allowance() {
        let free = 1_000_000_000u64;
        let file = 100 * 1024 * 1024;
        assert!(fits(free, required_bytes(file, 0)));

        // Another active download leaves just one byte too little.
        let active = free - SAFETY_RESERVE_BYTES - file + 1;
        assert!(!fits(free, required_bytes(file, active)));
    }

    #[test]
    fn available_space_uses_the_real_volume() {
        let dir = std::env::temp_dir();
        let available = available_space(&dir).expect("temp dir volume");
        assert!(available > 0);
        // The old sidebar fallback invented 4 TiB; preflight must never do that.
        assert_ne!(available, 4 * 1024 * 1024 * 1024 * 1024);
    }

    #[test]
    fn human_bytes_formats_units() {
        assert_eq!(human_bytes(512), "512 B");
        assert_eq!(human_bytes(1536), "1.5 KB");
        assert_eq!(human_bytes(256 * 1024 * 1024), "256.0 MB");
    }

    #[test]
    fn disk_full_error_codes() {
        #[cfg(unix)]
        for code in [28, 122] {
            assert!(is_disk_full(&io::Error::from_raw_os_error(code)));
        }
        #[cfg(windows)]
        for code in [112, 39] {
            assert!(is_disk_full(&io::Error::from_raw_os_error(code)));
        }
        assert!(!is_disk_full(&io::Error::from_raw_os_error(2)));
    }
}
