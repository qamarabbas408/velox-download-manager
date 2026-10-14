# Register the Velox native-messaging host for Chrome/Edge on Windows.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\register-native-host.ps1 -ExtensionId <id> [-Profile debug|release]
#
# Build the shim first:
#   cargo build --manifest-path crates/velox-native-host/Cargo.toml

param(
  [string]$ExtensionId = "ljgacipalnmcfpnaadgbhmampghkachi",
  [string]$Profile = "debug"
)

$ErrorActionPreference = "Stop"

$HostName = "com.velox.native_host"
$Root = Split-Path -Parent $PSScriptRoot
$Bin = Join-Path $Root "crates\velox-native-host\target\$Profile\velox-native-host.exe"

if (-not (Test-Path $Bin)) {
  Write-Error "shim binary not found at $Bin. Build it with: cargo build --manifest-path crates/velox-native-host/Cargo.toml"
  exit 1
}

$ManifestDir = Join-Path $env:LOCALAPPDATA "Velox"
New-Item -ItemType Directory -Force -Path $ManifestDir | Out-Null
$ManifestPath = Join-Path $ManifestDir "native-host.json"

$manifest = @{
  name            = $HostName
  description     = "Velox browser integration"
  path            = $Bin
  type            = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
$manifest | ConvertTo-Json -Depth 3 | Set-Content -Encoding UTF8 $ManifestPath
Write-Host "manifest: $ManifestPath"

$browsers = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
)

foreach ($key in $browsers) {
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name "(Default)" -Value $ManifestPath
  Write-Host "registered: $key"
}

Write-Host "done. reload the extension at chrome://extensions"
