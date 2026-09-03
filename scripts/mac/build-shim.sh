#!/bin/bash
#
# build-shim.sh — compile the LaunchDaemon entry-point binary.
#
# Produces src/main/static/mac/houston-backupd, a universal Mach-O that ships alongside
# houston-backupd.sh and is what launchd actually executes. It is not committed: the
# binary must be built (and signed) on the machine that packages the release.
#
# Set MAC_SHIM_IDENTITY to a "Developer ID Application: ..." identity for release builds.
# Without it the binary is ad-hoc signed, which is fine for local testing but means the
# code directory hash changes on every rebuild, silently invalidating any Full Disk Access
# grant the user has already given.

set -euo pipefail

cd "$(dirname "$0")/../.."

SRC="src/main/static/mac/houston-backupd.c"
OUT="src/main/static/mac/houston-backupd"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "build-shim.sh: not macOS, skipping"
  exit 0
fi

clang -arch arm64 -arch x86_64 -mmacosx-version-min=11.0 -O2 -Wall -Wextra -o "$OUT" "$SRC"

if [ -n "${MAC_SHIM_IDENTITY:-}" ]; then
  codesign --force --options runtime --timestamp -s "$MAC_SHIM_IDENTITY" "$OUT"
  echo "build-shim.sh: signed with $MAC_SHIM_IDENTITY"
else
  codesign --force -s - "$OUT"
  echo "build-shim.sh: ad-hoc signed (set MAC_SHIM_IDENTITY for release builds)"
fi

codesign --verify --verbose=1 "$OUT"
