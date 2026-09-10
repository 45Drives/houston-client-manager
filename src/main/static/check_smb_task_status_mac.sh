#!/bin/bash
#
# macOS SMB status probe.
#
# Built on smbutil, which ships with macOS. The Linux script uses smbclient, which does
# not — so on a stock Mac that path reported offline_connection_error for every task
# forever, which showed as a permanent "Offline" badge and, because an unreachable task
# has its live progress discarded, made a running backup flicker between a percentage and
# an indeterminate bar.

SMB_HOST="$1"
SMB_SHARE="$2"
TARGET_PATH="$3"
CRED_FILE="$4"

json() {
  echo "{\"status\": \"$1\"}"
  exit "${2:-0}"
}

# SMB is TCP/445 and ICMP is often filtered, so probe the port rather than pinging.
if ! /usr/bin/nc -z -G 2 -w 2 "$SMB_HOST" 445 >/dev/null 2>&1; then
  json "offline_unreachable" 1
fi

if [[ ! -f "$CRED_FILE" ]]; then
  json "offline_missing_credentials" 1
fi

# Supports both 'username=' and 'user=' formats.
USERNAME=$(grep -E '^(username|user)=' "$CRED_FILE" | head -1 | cut -d'=' -f2-)
PASSWORD=$(grep '^password=' "$CRED_FILE" | head -1 | cut -d'=' -f2-)

if [[ -z "$USERNAME" || -z "$PASSWORD" ]]; then
  json "offline_invalid_credential_file" 1
fi

# The credentials go into a URL, so anything outside the unreserved set has to be escaped
# or a password containing '@' or '/' would silently reshape the URL.
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

VIEW_OUTPUT=$(/usr/bin/smbutil view -N "//$(urlenc "$USERNAME"):$(urlenc "$PASSWORD")@${SMB_HOST}" 2>&1)
VIEW_RC=$?

if [[ $VIEW_RC -ne 0 ]]; then
  case "$VIEW_OUTPUT" in
    *[Aa]uthentication*|*"Permission denied"*|*"not permitted"*|*"Password"*)
      json "offline_invalid_credentials" 1 ;;
    *)
      json "offline_connection_error" 2 ;;
  esac
fi

# smbutil prints a two-line header, then one share per line with the name in column one.
if ! printf '%s\n' "$VIEW_OUTPUT" | awk 'NR > 2 { print $1 }' | grep -qxF "$SMB_SHARE"; then
  json "offline_connection_error" 2
fi

# smbutil cannot list a directory, so the destination folder can only be checked while the
# share happens to be mounted — which it is during and just after a run. When it is not,
# a reachable share with working credentials is as much as can be established.
MOUNT_DIR="${HOME}/houston-mounts/${SMB_SHARE}"
if /sbin/mount | grep -q " on ${MOUNT_DIR} "; then
  # TARGET_PATH is "host:share/uuid/...", and only the part below the share is on disk.
  REL="${TARGET_PATH#*:}"
  REL="${REL#"${SMB_SHARE}"}"
  REL="${REL#/}"
  if [[ -n "$REL" && ! -d "${MOUNT_DIR}/${REL}" ]]; then
    json "missing_folder" 1
  fi
fi

json "online" 0
