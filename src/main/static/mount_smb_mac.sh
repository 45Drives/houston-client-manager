#!/bin/bash
set -euo pipefail

# ----------- Argument validation -----------
if [ -z "${1:-}" ]; then echo '{"error": "No host provided"}'; exit 1; fi
if [ -z "${2:-}" ]; then echo '{"error": "No share name provided"}'; exit 1; fi
if [ -z "${3:-}" ]; then echo '{"error": "No username provided"}'; exit 1; fi
if [ -z "${4:-}" ]; then echo '{"error": "No mode provided"}'; exit 1; fi

HOST="$1"
SHARE="$2"
USERNAME="$3"
MODE="$4"          # "popup" or "silent"
SERVER="smb://${HOST}/${SHARE}"
MOUNT_POINT="/Volumes/${SHARE}"
KEYCHAIN_SERVICE="houston-smb-${SHARE}"

has_gui_session() {
  # If someone is logged into the console (not "root"), GUI is probably available.
  local console_user
  console_user="$(/usr/bin/stat -f "%Su" /dev/console 2>/dev/null || true)"
  if [ -n "$console_user" ] && [ "$console_user" != "root" ]; then
    return 0
  fi
  return 1
}

maybe_open_mountpoint() {
  if [ "$MODE" = "popup" ] && has_gui_session; then
    /usr/bin/open "$MOUNT_POINT" >/dev/null 2>&1 || true
  fi
}

# ----------- Retrieve password from Keychain -----------
PASSWORD="$(/usr/bin/security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${USERNAME}" -w 2>/dev/null || true)"
if [ -z "$PASSWORD" ]; then
  echo "{\"error\": \"No password found in Keychain for service ${KEYCHAIN_SERVICE} and user ${USERNAME}\"}"
  exit 1
fi

# ----------- Check if already mounted -----------
if /sbin/mount | /usr/bin/grep -qiE "//[^[:space:]]*@?${HOST}/${SHARE}[[:space:]]+on[[:space:]]+${MOUNT_POINT}\b"; then
  maybe_open_mountpoint
  echo "{\"smb_server\": \"${SERVER}\", \"share\": \"${SHARE}\", \"status\": \"already mounted\", \"MountPoint\": \"${MOUNT_POINT}\"}"
  exit 0
fi

# Ensure mountpoint exists
sudo mkdir -p "$MOUNT_POINT"
sudo chown "$(id -u):$(id -g)" "$MOUNT_POINT"


# ----------- Mount (GUI if available, else headless-safe) -----------
MOUNT_OK=""

if has_gui_session; then
  # AppleScript path (works well in an interactive desktop session)
  MOUNT_RESULT="$(/usr/bin/osascript <<EOF
try
  mount volume "${SERVER}" as user name "${USERNAME}" with password "${PASSWORD}"
  return "SUCCESS"
on error errMsg
  return "ERROR: " & errMsg
end try
EOF
)"
  if [[ "$MOUNT_RESULT" == "SUCCESS" ]]; then
    MOUNT_OK="yes"
  elif [[ "$MOUNT_RESULT" == ERROR:* ]]; then
    ERROR_MSG="${MOUNT_RESULT#"ERROR: "}"
    echo "{\"smb_server\": \"${SERVER}\", \"share\": \"${SHARE}\", \"error\": \"${ERROR_MSG//\"/\\\"}\"}"
    exit 1
  fi
else
  # Headless-safe path: mount_smbfs
  # Note: creds in URL appear in process list briefly; for CI/headless integration tests this is usually acceptable.
  SMB_URL="//${USERNAME}:${PASSWORD}@${HOST}/${SHARE}"
  if /sbin/mount_smbfs "$SMB_URL" "$MOUNT_POINT" >/dev/null 2>&1; then
    MOUNT_OK="yes"
  fi
fi

if [ -z "$MOUNT_OK" ]; then
  echo "{\"smb_server\": \"${SERVER}\", \"share\": \"${SHARE}\", \"error\": \"Mount failed\"}"
  exit 1
fi

# ----------- Validate the mount -----------
/bin/sleep 1

if /sbin/mount | /usr/bin/grep -qi "${HOST}/${SHARE}"; then
  if [ -d "${MOUNT_POINT}" ]; then
    maybe_open_mountpoint
    echo "{\"smb_server\": \"${SERVER}\", \"share\": \"${SHARE}\", \"status\": \"mounted successfully\", \"MountPoint\": \"${MOUNT_POINT}\"}"
    exit 0
  else
    echo "{\"smb_server\": \"${SERVER}\", \"share\": \"${SHARE}\", \"error\": \"Share was mounted but ${MOUNT_POINT} directory not found\"}"
    exit 1
  fi
else
  echo "{\"smb_server\": \"${SERVER}\", \"share\": \"${SHARE}\", \"error\": \"Mount command succeeded but share not present in \`mount\` output\"}"
  exit 1
fi
