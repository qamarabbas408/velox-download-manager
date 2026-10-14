#!/usr/bin/env bash
# Build the extension and package it as a Chrome Web Store / Edge Add-ons
# upload zip (manifest.json at the archive root).
#
# The store rejects the `key` field, so it is stripped from the packaged copy
# only — the dev build in dist/ keeps its key (stable unpacked id).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/extension"

cd "$EXT"
npm run build

VERSION="$(node -p "require('./package.json').version")"
OUT="$ROOT/extension-webstore-$VERSION.zip"
rm -f "$OUT"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -R dist/. "$TMP/"

node -e "const fs=require('fs');const p=process.argv[1];const m=JSON.parse(fs.readFileSync(p,'utf8'));delete m.key;fs.writeFileSync(p,JSON.stringify(m,null,2));" "$TMP/manifest.json"

( cd "$TMP" && zip -r "$OUT" . -x '.*' >/dev/null )

echo "packaged: $OUT"
