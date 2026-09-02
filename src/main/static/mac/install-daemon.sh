#!/bin/bash
#
# install-daemon.sh — install/upgrade the Houston backup LaunchDaemon.
#
# One install path shared by three callers so they cannot drift apart:
#   * the .pkg postinstall script, which is already root
#   * yarn dev:mac:daemon, run under sudo
#   * the app's runtime fallback via osascript, for zip auto-updates and dev
#
# Idempotent. Safe to run repeatedly and safe to run when nothing has changed.
#
# Usage: install-daemon.sh --source <dir containing houston-backupd and the plist>

set -euo pipefail

SOURCE_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --source)
      SOURCE_DIR="${2:-}"
      shift 2
      ;;
    *)
      echo "install-daemon.sh: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [ -z "$SOURCE_DIR" ]; then
  SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
fi

LABEL="com.45drives.houston.backupd"
ROOT="/Library/Application Support/45Drives/Houston"
BIN="${ROOT}/bin/houston-backupd"
MARKER="${ROOT}/.daemon-version"
PLIST="/Library/LaunchDaemons/${LABEL}.plist"

RUNNER_SRC="${SOURCE_DIR}/houston-backupd"
PLIST_SRC="${SOURCE_DIR}/${LABEL}.plist"

if [ "$(id -u)" -ne 0 ]; then
  echo "install-daemon.sh: must run as root" >&2
  exit 1
fi

for f in "$RUNNER_SRC" "$PLIST_SRC"; do
  if [ ! -f "$f" ]; then
    echo "install-daemon.sh: missing $f" >&2
    exit 1
  fi
done

# Read the version out of the runner itself, so the shipped script is the single source of
# truth and an installed copy can never claim a version it does not contain.
VERSION="$(sed -n 's/^# DAEMON_VERSION = \([0-9][0-9]*\).*$/\1/p' "$RUNNER_SRC" | head -1)"
if [ -z "$VERSION" ]; then
  echo "install-daemon.sh: could not read DAEMON_VERSION from $RUNNER_SRC" >&2
  exit 1
fi

mkdir -p "${ROOT}/bin" /Library/Logs/45Drives
chown root:wheel "$ROOT" "${ROOT}/bin"
chmod 755 "$ROOT" "${ROOT}/bin"

install -m 755 -o root -g wheel "$RUNNER_SRC" "$BIN"
install -m 644 -o root -g wheel "$PLIST_SRC" "$PLIST"

# bootout first so an upgraded runner is picked up instead of the running copy.
launchctl bootout "system/${LABEL}" 2>/dev/null || true
launchctl bootstrap system "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"
launchctl enable "system/${LABEL}" 2>/dev/null || true

printf '%s' "$VERSION" > "$MARKER"
chmod 644 "$MARKER"

# Retire the pre-daemon layout while we already hold root.
rm -f /private/etc/sudoers.d/houston-* 2>/dev/null || true
rm -rf "/Library/Application Support/Houston/scripts"
rmdir "/Library/Application Support/Houston" 2>/dev/null || true

echo "houston-backupd v${VERSION} installed and loaded"
