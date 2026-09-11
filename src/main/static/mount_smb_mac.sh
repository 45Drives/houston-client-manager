#!/bin/bash
set -euo pipefail

# ----------- Argument validation -----------
if [ -z "${1:-}" ]; then echo '{"error":"No host provided"}'; exit 1; fi
if [ -z "${2:-}" ]; then echo '{"error":"No share name provided"}'; exit 1; fi
if [ -z "${3:-}" ]; then echo '{"error":"No username provided"}'; exit 1; fi
if [ -z "${4:-}" ]; then echo '{"error":"No mode provided"}'; exit 1; fi

HOST="$1"
SHARE="$2"
USERNAME="$3"
MODE="$4" # "popup" or "silent"

SERVER="smb://${HOST}/${SHARE}"
MOUNT_POINT="/Volumes/${SHARE}"
KEYCHAIN_SERVICE="houston-smb-${HOST}-${SHARE}-${USERNAME}"
CRED_FILE="${HOME}/Library/Application Support/45Drives/Houston/credentials/${HOST}_${SHARE}_${USERNAME}.cred"

json_error() {
  local msg="$1"
  echo "{\"smb_server\":\"${SERVER}\",\"share\":\"${SHARE}\",\"error\":\"${msg//\"/\\\"}\"}"
}

has_gui_session() {
  # Console owner is the currently logged-in GUI user. If it's root, likely no GUI session.
  local console_user
  console_user="$(/usr/bin/stat -f "%Su" /dev/console 2>/dev/null || true)"
  [ -n "$console_user" ] && [ "$console_user" != "root" ]
}

maybe_open_mountpoint() {
  if [ "$MODE" = "popup" ]; then
    /usr/bin/open "$MOUNT_POINT" >/dev/null 2>&1 || true
  fi
}

# Read the real mountpoint out of `mount` output. The backup daemon mounts with
# mount_smbfs under ~/houston-mounts/<share>, so it is not always /Volumes/<share>.
find_mountpoint() {
  /sbin/mount | /usr/bin/awk -v h="${HOST}" -v s="${SHARE}" '
    BEGIN { pat = "//.*@?" tolower(h) "/" tolower(s) " on " }
    tolower($0) ~ pat {
      line = $0
      sub(/^.* on /, "", line)
      sub(/ \([^(]*\)$/, "", line)
      print line
      exit
    }
  '
}

# ----------- If already mounted, return success -----------
# Checked before anything else: an existing mount needs neither a GUI session nor a
# password, and the backup daemon mounts this share on its own schedule.
EXISTING_MP="$(find_mountpoint)"
if [ -n "${EXISTING_MP}" ]; then
  MOUNT_POINT="$EXISTING_MP"
  maybe_open_mountpoint
  echo "{\"smb_server\":\"${SERVER}\",\"share\":\"${SHARE}\",\"status\":\"already mounted\",\"MountPoint\":\"${MOUNT_POINT}\"}"
  exit 0
fi

# ----------- Require GUI session -----------
if ! has_gui_session; then
  json_error "No active GUI session; cannot mount via AppleScript in headless/SSH context."
  exit 1
fi

# ----------- Retrieve password -----------
# Login keychain first, then the daemon credential file the backup tasks use.
PASSWORD="$(/usr/bin/security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${USERNAME}" -w 2>/dev/null || true)"
if [ -z "$PASSWORD" ] && [ -r "$CRED_FILE" ]; then
  PASSWORD="$(/usr/bin/sed -n 's/^password=//p' "$CRED_FILE" | /usr/bin/head -n 1)"
fi
if [ -z "$PASSWORD" ]; then
  json_error "No saved password for ${USERNAME} on ${SERVER}"
  exit 1
fi

# ----------- Mount using AppleScript -----------
MOUNT_RESULT="$(/usr/bin/osascript <<EOF
try
  mount volume "${SERVER}" as user name "${USERNAME}" with password "${PASSWORD}"
  return "SUCCESS"
on error errMsg
  return "ERROR: " & errMsg
end try
EOF
)"

if [[ "$MOUNT_RESULT" == ERROR:* ]]; then
  json_error "${MOUNT_RESULT#"ERROR: "}"
  exit 1
fi

# ----------- Validate mount -----------x
/bin/sleep 1

# Find the actual mountpoint from mount output (could be /Volumes/<share> or /Volumes/<share>-1, etc.)
ACTUAL_MP="$(find_mountpoint)"

if [ -z "${ACTUAL_MP}" ]; then
  json_error "Mount command returned success but share not present in mount output"
  exit 1
fi

# If mac chose a different mountpoint name, use it
MOUNT_POINT="$ACTUAL_MP"

maybe_open_mountpoint
echo "{\"smb_server\":\"${SERVER}\",\"share\":\"${SHARE}\",\"status\":\"mounted successfully\",\"MountPoint\":\"${MOUNT_POINT}\"}"
exit 0
