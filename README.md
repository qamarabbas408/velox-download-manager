# Velox

A fast, lightweight segmented download manager for Mac & Windows.

Built with [Tauri 2](https://tauri.app/), React, and Rust.

## Features

- ⚡ Segmented downloads (multi-connection) for maximum speed
- 📋 Auto-captures URLs copied to your clipboard
- 📁 Reveal completed downloads in your file manager
- 🎛️ Global connection pool with a live usage indicator
- 💾 Dynamic storage meter
- 🌓 Light & dark themes

## Download

Download the desktop app from the [Releases](https://github.com/qamarabbas408/velox-download-manager/releases) page or [SourceForge](https://sourceforge.net/projects/velox-download-manager/), install the [Velox Browser Integration extension](https://chromewebstore.google.com/detail/velox-browser-integration/fghoiobfogfmjnhklgpbagdgknldfmll), or visit the [project page](https://thedigiorb.com/portfolio/db1b7b09-7158-42d8-a01a-5c291188ebad).

## Install on macOS

1. Download the latest `.dmg` and open it.
2. Drag **Velox** into **Applications**.
3. Open Velox from Applications.

Velox is not yet signed with an Apple Developer ID, so macOS may say the app is
from an unidentified developer, or that it is **"damaged and can't be opened"**.
The download is fine — this is Gatekeeper. Allow the first launch with one of:

- Right-click (or Control-click) **Velox** in Applications → **Open** → **Open** again.
- Open **System Settings → Privacy & Security** and click **Open Anyway**.
- Or run this once in Terminal, then open the app:

  ```sh
  sudo xattr -dr com.apple.quarantine /Applications/Velox.app
  ```

This extra step will be removed once Velox is signed and notarized by Apple.

## Credits

Copyright © Qamar Abbas — [TheDigiOrb](https://thedigiorb.com/#contact).
