#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

npm run check

version="$(node -p "require('./manifest.json').version")"
archive="dist/casimir-${version}.zip"

mkdir -p dist
rm -f "$archive"
zip -qr "$archive" manifest.json src assets

echo "Created $archive"
