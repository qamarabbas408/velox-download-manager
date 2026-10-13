#!/usr/bin/env bash
# Build the native-messaging shim and stage it as a Tauri sidecar so it is
# bundled next to the app binary (and found by native_host::register()).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TRIPLE="$(rustc -vV | awk '/^host:/ {print $2}')"
EXT=""
case "$TRIPLE" in *windows*) EXT=".exe" ;; esac

cargo build --release --manifest-path "$ROOT/crates/velox-native-host/Cargo.toml"

DEST_DIR="$ROOT/src-tauri/binaries"
mkdir -p "$DEST_DIR"
cp "$ROOT/crates/velox-native-host/target/release/velox-native-host$EXT" \
   "$DEST_DIR/velox-native-host-$TRIPLE$EXT"
echo "sidecar staged: $DEST_DIR/velox-native-host-$TRIPLE$EXT"
