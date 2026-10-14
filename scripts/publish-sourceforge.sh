#!/usr/bin/env bash
set -euo pipefail

# Publish release notes and the current macOS DMG, optionally with Windows.
# Usage: scripts/publish-sourceforge.sh [--windows FILE | --windows-only FILE | --readme-only]

readonly SF_USER="qmarabbas"
readonly SF_HOST="frs.sourceforge.net"
readonly SF_PROJECT="velox-download-manager"
readonly SF_ROOT="/home/frs/project/${SF_PROJECT}"
readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly VERSION="$(node -p "require('${ROOT_DIR}/package.json').version")"
readonly VERSION_DIR="$(node -e '
const [major = "0", minor = "0", patch = "0"] = process.argv[1].split(".");
if (![major, minor, patch].every((part) => /^\d+$/.test(part))) process.exit(2);
process.stdout.write(`v${major === "0" ? minor : major}${patch === "0" ? "" : `.${patch}`}`);
' "${VERSION}")"
readonly MAC_GLOB="${ROOT_DIR}/src-tauri/target/release/bundle/dmg/Velox_${VERSION}_*.dmg"

usage() {
  echo "Usage: $0 [--windows /path/to/installer.exe-or.msi | --windows-only /path/to/installer.exe-or.msi | --readme-only]" >&2
  exit 2
}

UPLOAD_MAC=true
WINDOWS_FILE=""
if [[ $# -gt 0 ]]; then
  case "$1" in
    --windows)
      [[ $# -eq 2 ]] || usage
      WINDOWS_FILE="$2"
      ;;
    --windows-only)
      [[ $# -eq 2 ]] || usage
      UPLOAD_MAC=false
      WINDOWS_FILE="$2"
      ;;
    --readme-only)
      [[ $# -eq 1 ]] || usage
      UPLOAD_MAC=false
      ;;
    *) usage ;;
  esac
fi

if [[ -n "${WINDOWS_FILE}" ]]; then
  [[ -f "${WINDOWS_FILE}" ]] || { echo "Windows installer not found: ${WINDOWS_FILE}" >&2; exit 1; }
  case "${WINDOWS_FILE##*.}" in
    exe|EXE|msi|MSI) ;;
    *) echo "Windows installer must end in .exe or .msi" >&2; exit 1 ;;
  esac
fi

shopt -s nullglob
MAC_FILES=( ${MAC_GLOB} )
shopt -u nullglob
if [[ "${UPLOAD_MAC}" == true && ${#MAC_FILES[@]} -ne 1 ]]; then
  echo "Expected exactly one macOS DMG for version ${VERSION} at ${MAC_GLOB}; found ${#MAC_FILES[@]}. Build the current version first." >&2
  exit 1
fi
MAC_FILE=""
if [[ "${UPLOAD_MAC}" == true ]]; then
  MAC_FILE="${MAC_FILES[0]}"
fi

validate_installer_name() {
  local file="$1"
  if [[ "$(basename "${file}")" == *' '* || "$(basename "${file}")" == *'/'* ]]; then
    echo "Installer filename contains an unsupported character: $(basename "${file}")" >&2
    exit 1
  fi
}
[[ -z "${MAC_FILE}" ]] || validate_installer_name "${MAC_FILE}"
[[ -z "${WINDOWS_FILE}" ]] || validate_installer_name "${WINDOWS_FILE}"

REMOTE_DIR="${SF_ROOT}/${VERSION_DIR}"
WORK_DIR="$(mktemp -d)"
VERIFY_DIR="${WORK_DIR}/verify"
mkdir -p "${VERIFY_DIR}"
trap 'rm -rf "${WORK_DIR}"' EXIT
RELEASE_README="${WORK_DIR}/README.md"
awk -v version="${VERSION}" '
  $0 ~ "^## \\[" version "\\]" { found = 1; print "# Velox " version " release notes"; print ""; next }
  found && /^## / { exit }
  found { print }
  END { if (!found) exit 1 }
' "${ROOT_DIR}/CHANGELOG.md" > "${RELEASE_README}" || {
  echo "No CHANGELOG.md release section found for version ${VERSION}." >&2
  exit 1
}
declare -a LOCAL_FILES=() REMOTE_NAMES=()
if [[ -n "${MAC_FILE}" ]]; then
  LOCAL_FILES+=("${MAC_FILE}")
  REMOTE_NAMES+=("$(basename "${MAC_FILE}")")
fi
if [[ -n "${WINDOWS_FILE}" ]]; then
  LOCAL_FILES+=("${WINDOWS_FILE}")
  REMOTE_NAMES+=("$(basename "${WINDOWS_FILE}")")
fi

cat <<INFO
Publishing Velox ${VERSION}
INFO
if [[ -n "${MAC_FILE}" ]]; then echo "  macOS:   ${MAC_FILE}"; fi
if [[ -n "${WINDOWS_FILE}" ]]; then echo "  Windows: ${WINDOWS_FILE}"; fi
cat <<INFO
  SourceForge: ${SF_USER}@${SF_HOST}:${REMOTE_DIR}

SSH key authentication is required; passwords are disabled for this command.
INFO

# Create the release directory if needed. Never replace an installer or README.
PREFLIGHT="$(sftp -oBatchMode=yes -b - "${SF_USER}@${SF_HOST}" <<SFTP
-mkdir ${REMOTE_DIR}
ls -1 ${REMOTE_DIR}
SFTP
 )"
if [[ -n "${MAC_FILE}" ]]; then
  name="$(basename "${MAC_FILE}")"
  if grep -Fxq -- "${name}" <<<"${PREFLIGHT}"; then
    echo "Refusing to overwrite existing SourceForge file: ${REMOTE_DIR}/${name}" >&2
    exit 1
  fi
fi
if [[ -n "${WINDOWS_FILE}" ]]; then
  name="$(basename "${WINDOWS_FILE}")"
  if grep -Fxq -- "${name}" <<<"${PREFLIGHT}"; then
    echo "Refusing to overwrite existing SourceForge file: ${REMOTE_DIR}/${name}" >&2
    exit 1
  fi
fi

# Add the version-specific release notes unless a README is already present.
if grep -Fxq -- "README.md" <<<"${PREFLIGHT}"; then
  if [[ -z "${MAC_FILE}" && -z "${WINDOWS_FILE}" ]]; then
    echo "README.md already exists in ${REMOTE_DIR}; nothing to upload."
    exit 0
  fi
  echo "Keeping existing ${REMOTE_DIR}/README.md."
else
  LOCAL_FILES+=("${RELEASE_README}")
  REMOTE_NAMES+=("README.md")
fi

# Upload each selected file, download it to a temporary directory, and compare
# the bytes. This verifies the actual uploaded content without relying on the
# server's human-readable `ls -l` formatting.
sftp -oBatchMode=yes -b - "${SF_USER}@${SF_HOST}" <<SFTP
$(for i in "${!LOCAL_FILES[@]}"; do
  printf 'put "%s" %s/%s\n' "${LOCAL_FILES[$i]}" "${REMOTE_DIR}" "${REMOTE_NAMES[$i]}"
  printf 'get %s/%s "%s/%s"\n' "${REMOTE_DIR}" "${REMOTE_NAMES[$i]}" "${VERIFY_DIR}" "${REMOTE_NAMES[$i]}"
done)
SFTP
for i in "${!REMOTE_NAMES[@]}"; do
  name="${REMOTE_NAMES[$i]}"
  if ! cmp -s "${LOCAL_FILES[$i]}" "${VERIFY_DIR}/${name}"; then
    echo "Upload verification failed: downloaded copy differs for ${name}." >&2
    exit 1
  fi
done

echo "Upload verified: https://sourceforge.net/projects/${SF_PROJECT}/files/${VERSION_DIR}/"
