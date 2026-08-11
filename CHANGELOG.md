# Changelog

All notable changes to Velox are documented in this file.

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
