# AGENTS.md

Guidelines for AI agents working in this repository.

## App versioning

The app version must be kept in sync across **all four** files:

- `package.json` → `"version"`
- `src-tauri/tauri.conf.json` → `"version"`
- `src-tauri/Cargo.toml` → `version`
- `src-tauri/Cargo.lock` → the `[[package]] name = "tauri-app"` entry's `version`

When bumping the version, update all four to the same value and commit the
change in one commit (e.g. `Bump app version to X.Y.Z`).

## Git tags

- Tags follow semantic versioning with a leading `v` (e.g. `v0.5.0`).
- Tags are annotated, not lightweight: `git tag -a vX.Y.Z -m "Release vX.Y.Z — <summary>"`.
- When a release is requested, bump the version everywhere (see above), commit,
  push `main`, then create and push the tag: `git push origin vX.Y.Z`.
- Pushing a `v*` tag triggers the GitHub Actions workflow
  (`.github/workflows/build.yml`), which builds macOS/Windows installers and
  opens a **draft release** with the artifacts attached.
- CI also runs on pushes to `main`; draft releases are created per tag.
- macOS code signing is optional — the signing secrets are unset, so unsigned
  builds are the norm. "Signature not found … Skipping upload" in CI logs is
  cosmetic.

## Recent tags

- `v0.1.0`, `v0.2.0`, `v0.3.0` — initial feature sets
- `v0.4.0` — IDM-style UI revamp (downloads table, selection/bulk actions,
  disk-space gauge, themed checkboxes and empty state)
- `v0.5.0` — version sync bump
