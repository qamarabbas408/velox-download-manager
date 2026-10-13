#!/usr/bin/env bash
# Remove Velox native-messaging host registration (macOS / Linux).
# Windows uninstall removes its registry keys via src-tauri/nsis/hooks.nsh.
set -euo pipefail

HOST_NAME="com.velox.native_host"

dirs=(
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
  "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  "$HOME/.config/google-chrome/NativeMessagingHosts"
  "$HOME/.config/microsoft-edge/NativeMessagingHosts"
  "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
)

for dir in "${dirs[@]}"; do
  if [[ -f "$dir/$HOST_NAME.json" ]]; then
    rm -f "$dir/$HOST_NAME.json"
    echo "removed: $dir/$HOST_NAME.json"
  fi
done

echo "done"
