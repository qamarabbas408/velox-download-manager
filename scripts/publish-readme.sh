#!/usr/bin/env bash
# Publish a version's CHANGELOG section as README.md to the matching
# SourceForge release folder (used as the release notes). Installers are
# uploaded separately.
#
# Usage:
#   scripts/publish-readme.sh [--version X.Y.Z] [--force]
#
# Defaults to the app version in package.json. Version 0.6.1 maps to v6.1.
# Requires SSH key authentication for the SourceForge account; passwords are
# disabled.
set -euo pipefail

readonly SF_USER="qmarabbas"
readonly SF_HOST="frs.sourceforge.net"
readonly SF_PROJECT="velox-download-manager"
readonly SF_ROOT="/home/frs/project/${SF_PROJECT}"
readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  echo "Usage: $0 [--version X.Y.Z] [--force]" >&2
  exit 2
}

FORCE=false
TARGET_VERSION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      FORCE=true
      shift
      ;;
    --version)
      [[ $# -ge 2 ]] || usage
      TARGET_VERSION="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--version X.Y.Z] [--force]"
      exit 0
      ;;
    *) usage ;;
  esac
done

VERSION="${TARGET_VERSION:-$(node -p "require('${ROOT_DIR}/package.json').version")}"
VERSION_DIR="$(node -e '
const [major = "0", minor = "0", patch = "0"] = process.argv[1].split(".");
if (![major, minor, patch].every((part) => /^\d+$/.test(part))) process.exit(2);
process.stdout.write(`v${major === "0" ? minor : major}${patch === "0" ? "" : `.${patch}`}`);
' "${VERSION}")"
REMOTE_DIR="${SF_ROOT}/${VERSION_DIR}"
SF_URL="https://sourceforge.net/projects/${SF_PROJECT}/files/${VERSION_DIR}/"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

README="${WORK_DIR}/README.md"
awk -v version="${VERSION}" '
  $0 ~ "^## \\[" version "\\]" { found = 1; print "# Velox " version " release notes"; print ""; next }
  found && /^## / { exit }
  found { print }
  END { if (!found) exit 1 }
' "${ROOT_DIR}/CHANGELOG.md" > "${README}" || {
  echo "No CHANGELOG.md release section found for version ${VERSION}." >&2
  exit 1
}

# Temporary until the macOS build is signed + notarized: downloaders will hit a
# Gatekeeper warning, so include the workaround. Remove once signing is in place.
cat >> "${README}" <<'NOTE'

## Installing on macOS

Velox isn't signed with an Apple Developer ID yet, so macOS may say the app is
from an unidentified developer or is "damaged and can't be opened". The download
is fine — this is Gatekeeper. To open it the first time:

1. Drag **Velox** from the DMG into **Applications**.
2. Run this once in Terminal:

   ```sh
   sudo xattr -dr com.apple.quarantine /Applications/Velox.app
   ```

3. Open Velox normally. (Right-click → Open may also work.)

This step will be removed once Velox is signed and notarized by Apple.
NOTE

# Create the release folder if needed and see whether a README already exists.
PREFLIGHT="$(printf -- '-mkdir %s\nls -1 %s\n' "${REMOTE_DIR}" "${REMOTE_DIR}" |
  sftp -oBatchMode=yes -b - "${SF_USER}@${SF_HOST}")"

if grep -Fxq -- "README.md" <<<"${PREFLIGHT}" && [[ "${FORCE}" != true ]]; then
  echo "README.md already exists in ${REMOTE_DIR}; pass --force to replace it." >&2
  exit 1
fi

echo "Publishing release notes for Velox ${VERSION}"
echo "  SourceForge: ${SF_USER}@${SF_HOST}:${REMOTE_DIR}"

# Upload, then download a temporary copy and compare the bytes.
printf 'put "%s" %s/README.md\nget %s/README.md "%s/verify-README.md"\n' \
  "${README}" "${REMOTE_DIR}" "${REMOTE_DIR}" "${WORK_DIR}" |
  sftp -oBatchMode=yes -b - "${SF_USER}@${SF_HOST}"

if ! cmp -s "${README}" "${WORK_DIR}/verify-README.md"; then
  echo "Upload verification failed: downloaded README.md differs." >&2
  exit 1
fi

echo "Upload verified: ${SF_URL}"
