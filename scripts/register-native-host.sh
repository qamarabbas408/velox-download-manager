#!/usr/bin/env bash
# Register the Velox native-messaging host for Chrome/Edge/Brave on macOS.
#
# Usage:
#   scripts/register-native-host.sh <extension-id> [debug|release]
#
# Build the shim first, e.g.:
#   cargo build --manifest-path crates/velox-native-host/Cargo.toml

set -euo pipefail

EXT_ID="${1:-ljgacipalnmcfpnaadgbhmampghkachi}"
STORE_ID="fghoiobfogfmjnhklgpbagdgknldfmll"
PROFILE="${2:-debug}"
HOST_NAME="com.velox.native_host"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/crates/velox-native-host/target/$PROFILE/velox-native-host"

if [[ ! -x "$BIN" ]]; then
  echo "error: shim binary not found at $BIN" >&2
  echo "build it with: cargo build --manifest-path crates/velox-native-host/Cargo.toml" >&2
  exit 1
fi

if [[ "$EXT_ID" == "$STORE_ID" ]]; then
  ORIGINS="\"chrome-extension://$EXT_ID/\""
else
  ORIGINS="\"chrome-extension://$EXT_ID/\",
    \"chrome-extension://$STORE_ID/\""
fi

MANIFEST=$(cat <<JSON
{
  "name": "$HOST_NAME",
  "description": "Velox browser integration",
  "path": "$BIN",
  "type": "stdio",
  "allowed_origins": [
    $ORIGINS
  ]
}
JSON
)

targets=(
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
  "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
)

for dir in "${targets[@]}"; do
  mkdir -p "$dir"
  printf '%s\n' "$MANIFEST" > "$dir/$HOST_NAME.json"
  echo "registered: $dir/$HOST_NAME.json"
done

echo "done. reload the extension at chrome://extensions"
