#!/bin/bash
#
# One-shot check that the backup daemon is installed, loaded, and whether TCC has granted
# it Full Disk Access. Read-only; no admin rights needed.

LABEL="com.45drives.houston.backupd"
ROOT="/Library/Application Support/45Drives/Houston"

echo "== files =="
ls -l "${ROOT}/bin/houston-backupd" 2>/dev/null || echo "  runner NOT installed"
ls -l "/Library/LaunchDaemons/${LABEL}.plist" 2>/dev/null || echo "  plist NOT installed"
printf '  version marker: %s\n' "$(cat "${ROOT}/.daemon-version" 2>/dev/null || echo none)"

echo
echo "== launchd =="
if launchctl print "system/${LABEL}" >/dev/null 2>&1; then
  launchctl print "system/${LABEL}" | grep -E '^\s+(state|pid|last exit code) ' || true
else
  echo "  not loaded"
fi

echo
echo "== full disk access =="
FDA="$(cat "${ROOT}/fda-status" 2>/dev/null)"
case "$FDA" in
  granted) echo "  granted" ;;
  denied)  echo "  DENIED — sources in Desktop/Documents/Downloads/iCloud will fail" ;;
  *)       echo "  unknown — daemon has not completed a wake yet (it runs every 60s)" ;;
esac

echo
echo "== tasks =="
ls -l "${HOME}/Library/Application Support/45Drives/Houston/backup-tasks" 2>/dev/null || echo "  none"

echo
echo "== recent daemon log =="
tail -n 25 /Library/Logs/45Drives/houston-backupd.log 2>/dev/null || echo "  no log yet"
