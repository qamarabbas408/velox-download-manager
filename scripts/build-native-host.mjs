// Build the native-messaging shim and stage it as a Tauri sidecar so it is
// bundled next to the app binary (and found by native_host::register()).
// Cross-platform (macOS / Linux / Windows) — run via `node`.
//
// The staged file must match the Tauri TARGET triple: `<name>-<target-triple>`.
// For universal macOS builds we lipo the two arches into one binary.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = path.join(root, "crates", "velox-native-host", "Cargo.toml");
const destDir = path.join(root, "src-tauri", "binaries");
mkdirSync(destDir, { recursive: true });

const host = execFileSync("rustc", ["-vV"], { encoding: "utf8" })
  .split("\n")
  .find((line) => line.startsWith("host: "))
  .replace("host: ", "")
  .trim();

// Tauri sets this for beforeDev/beforeBuildCommand; fall back to the host.
const target = process.env.TAURI_ENV_TARGET_TRIPLE || host;

function shimBin(triple) {
  const ext = triple.includes("windows") ? ".exe" : "";
  return path.join(
    root,
    "crates",
    "velox-native-host",
    "target",
    triple,
    "release",
    `velox-native-host${ext}`
  );
}

function build(triple) {
  execFileSync(
    "cargo",
    ["build", "--release", "--target", triple, "--manifest-path", manifest],
    { stdio: "inherit" }
  );
  return shimBin(triple);
}

if (target === "universal-apple-darwin") {
  const arm = build("aarch64-apple-darwin");
  const intel = build("x86_64-apple-darwin");
  const dest = path.join(destDir, `velox-native-host-${target}`);
  execFileSync("lipo", ["-create", arm, intel, "-output", dest], { stdio: "inherit" });
  console.log(`sidecar staged: ${dest}`);
} else {
  const src = build(target);
  const ext = target.includes("windows") ? ".exe" : "";
  const dest = path.join(destDir, `velox-native-host-${target}${ext}`);
  copyFileSync(src, dest);
  console.log(`sidecar staged: ${dest}`);
}
