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
MOUNT_ROOT="${HOME}/houston-mounts"
MOUNT_POINT="${MOUNT_ROOT}/${SHARE}"
KEYCHAIN_SERVICE="houston-smb-${HOST}-${SHARE}-${USERNAME}"
CRED_FILE="${HOME}/Library/Application Support/45Drives/Houston/credentials/${HOST}_${SHARE}_${USERNAME}.cred"

json_error() {
  local msg="$1"
  echo "{\"smb_server\":\"${SERVER}\",\"share\":\"${SHARE}\",\"error\":\"${msg//\"/\\\"}\"}"
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

# ----------- Mount with mount_smbfs -----------
# Headless, so it raises no "You are attempting to connect to the server" dialog and
# needs no GUI session. Mounts where the backup daemon mounts, so both sides agree.
urlenc() {
  local s="$1" out='' i c
  for (( i = 0; i < ${#s}; i++ )); do
    c="${s:i:1}"
    case "$c" in
      [a-zA-Z0-9.~_-]) out+="$c" ;;
      *) out+="$(printf '%%%02X' "'$c")" ;;
    esac
  done
  printf '%s' "$out"
}

MOUNT_POINT="${MOUNT_ROOT}/${SHARE}"
/bin/mkdir -p "$MOUNT_POINT" 2>/dev/null || true

if ! MOUNT_ERR="$(/sbin/mount_smbfs -N "//$(urlenc "$USERNAME"):$(urlenc "$PASSWORD")@${HOST}/${SHARE}" "$MOUNT_POINT" 2>&1)"; then
  json_error "mount_smbfs failed: ${MOUNT_ERR}"
  exit 1
fi

# ----------- Validate mount -----------
ACTUAL_MP="$(find_mountpoint)"

if [ -z "${ACTUAL_MP}" ]; then
  json_error "Mount command returned success but share not present in mount output"
  exit 1
fi

MOUNT_POINT="$ACTUAL_MP"

maybe_open_mountpoint
echo "{\"smb_server\":\"${SERVER}\",\"share\":\"${SHARE}\",\"status\":\"mounted successfully\",\"MountPoint\":\"${MOUNT_POINT}\"}"
exit 0
