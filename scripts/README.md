# Project scripts

Run these commands from the repository root unless a command says otherwise. On macOS and Linux, shell scripts can be run directly. On Windows, use PowerShell for the Windows registration script.

## SourceForge release publishing

`publish-sourceforge.sh` uploads release notes from the matching `CHANGELOG.md` section and the current macOS DMG, a Windows installer, or both to the Velox SourceForge Files area. The notes are published as `README.md`, which SourceForge displays in the release folder. It uses the app version from `package.json` to find the DMG and choose the remote version folder. For example, version `0.6.0` is published under `v6`.

### Prepare the installers

1. Build the macOS app on your Mac with `npm install` (first time only), then `npm run tauri build`.
2. Confirm the matching DMG exists under `src-tauri/target/release/bundle/dmg/`.
3. To publish Windows too, copy the Windows `.exe` or `.msi` installer to the Mac.

The script requires SSH key authentication for the SourceForge account `qmarabbas`. It disables password prompts and does not read or store credentials. Set up and verify your SourceForge SSH key before publishing.

### Choose what to publish

Publish the Mac DMG only:

```sh
scripts/publish-sourceforge.sh
```

Publish the Mac DMG and Windows installer together:

```sh
scripts/publish-sourceforge.sh --windows "/path/to/Velox_0.6.0_x64-setup.exe"
```

Publish only the Windows installer, for example when adding it after the Mac release:

```sh
scripts/publish-sourceforge.sh --windows-only "/path/to/Velox_0.6.0_x64-setup.exe"
```

Publish or add only the release notes, for example after the installers were already uploaded:

```sh
scripts/publish-sourceforge.sh --readme-only
```

The script creates the version folder if needed, refuses to replace installers, keeps an existing `README.md`, and verifies each upload by downloading a temporary copy and comparing its contents with the local file. If a selected Mac DMG is missing or ambiguous, build the current app version first. If an installer is already in that remote folder, the script stops rather than overwriting it.

## Publish release notes (README)

`publish-readme.sh` uploads the current version's `CHANGELOG.md` section as `README.md` to the matching SourceForge release folder. Use it when you upload the installers yourself.

```sh
scripts/publish-readme.sh                     # current package.json version
scripts/publish-readme.sh --version 0.6.1     # a specific version
scripts/publish-readme.sh --force             # replace an existing README.md
```

It creates the version folder if needed, refuses to replace an existing `README.md` unless `--force` is passed, and verifies the upload by downloading a temporary copy and comparing the bytes.

## Build and package the browser extension

`package-extension.sh` builds the browser extension and creates a store upload ZIP at the repository root. The ZIP filename includes the extension version.

```sh
scripts/package-extension.sh
```

Requires Node.js/npm and the extension dependencies. Run `npm ci` in `extension/` first if dependencies are not installed.

## Build the native messaging sidecar

`build-native-host.mjs` builds the Rust native messaging host and stages it in `src-tauri/binaries/` for Tauri bundling. The Tauri build configuration invokes it automatically before development and production builds. To run it directly:

```sh
node scripts/build-native-host.mjs
```

Requires Rust/Cargo; universal macOS builds also require the Apple targets and `lipo`.

## Register the browser integration

These scripts register the native messaging host so the Velox browser extension can communicate with the desktop app. Build the native host first if its binary is missing.

macOS (Chrome, Edge, and Brave):

```sh
cargo build --manifest-path crates/velox-native-host/Cargo.toml
scripts/register-native-host.sh [extension-id] [debug|release]
```

Windows (Chrome and Edge, PowerShell):

```powershell
cargo build --manifest-path crates/velox-native-host/Cargo.toml
powershell -ExecutionPolicy Bypass -File scripts\register-native-host.ps1 -ExtensionId <extension-id> -Profile debug
```

Both registration scripts default to the extension ID used by this project and the debug profile. Reload the extension in the browser after registration. On macOS/Linux, remove registrations with:

```sh
scripts/unregister-native-host.sh
```

On Windows, the app's NSIS installer hooks handle registration removal during uninstall.
