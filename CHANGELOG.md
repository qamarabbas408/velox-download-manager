# Changelog

All notable changes to Velox are documented in this file.

## [0.5.2] — 2026-08-13

### Added
- Per-download detail drawer with a live speed graph — click any download row to open a drawer showing stats (size, downloaded, speed, ETA, average speed, active connections), a 90-second speed chart, per-segment progress, and source URL / save location
- Option to delete completed downloads from disk — removing a finished download can also send the file to the Recycle Bin instead of just clearing the list entry

### Fixed
- Speed graph now scrolls correctly while a download is active (the graph window was stalling during live updates)
- Keyboard users can activate the Pause / Resume / Remove row actions again instead of opening the details drawer
- Focus returns to the triggering row when the details drawer closes
- Windows save paths no longer mix separator styles (e.g. `C:\…\Downloads\file.zip`)

### Changed
- Removed static mock download data — all UI data now comes from the download engine

## [0.5.1] — 2026-08-11

### Added
- System tray icon with a live tooltip showing active download count and current speed
- Close-to-tray: closing the main window hides it to the tray instead of quitting, so downloads keep running in the background
- Tray context menu with **Show Velox**, **Pause All**, and **Quit**
- Taskbar/dock progress bar reflecting aggregate download progress
- OS notifications when a download completes or fails
- Platform-appropriate default download folder on all operating systems

### Fixed
- App could not be closed via the window close button or the tray **Quit** item (missing core window permissions); the process now exits cleanly from the tray

### Changed
- Probe error URLs are shortened and error messages are contained within the "Add download" modal

[0.5.1]: https://github.com/qamarabbas408/velox-download-manager/releases/tag/v0.5.1
