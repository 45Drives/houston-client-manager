#!/usr/bin/env bash
# Generates platform icon sets from a single square PNG (1024x1024 recommended).
#   usage: bash scripts/gen-icons.sh [source.png]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${1:-$ROOT/assets/icons/placeholder.png}"
OUT="$ROOT/assets/icons"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

[[ -f "$SRC" ]] || { echo "source icon not found: $SRC" >&2; exit 1; }

npx --yes electron-icon-builder --input="$SRC" --output="$TMP" --flatten

mkdir -p "$OUT/linux" "$OUT/mac" "$OUT/win"
rm -f "$OUT/linux"/*.png "$OUT/mac"/*.icns "$OUT/win"/*.ico

# Linux: electron-builder reads a directory of NxN.png files
for size in 16 24 32 48 64 128 256 512 1024; do
  cp "$TMP/icons/${size}x${size}.png" "$OUT/linux/${size}x${size}.png"
done

cp "$TMP/icons/icon.icns" "$OUT/mac/icon.icns"
cp "$TMP/icons/icon.ico" "$OUT/win/icon.ico"

echo "icons written to $OUT"
