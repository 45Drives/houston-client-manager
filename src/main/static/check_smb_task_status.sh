#!/bin/bash

SMB_HOST="$1"
SMB_SHARE="$2"
TARGET_PATH="$3"
USERNAME="$4"
PASSWORD="$5"

json() {
  echo "{\"status\": \"$1\"}"
  exit "${2:-0}"
}

# Ensure smbclient exists
if ! command -v smbclient >/dev/null 2>&1; then
  json "offline_connection_error" 2
fi

# Check host reachability
if ! ping -c 1 -W 1 "$SMB_HOST" > /dev/null 2>&1; then
  json "offline_unreachable" 1
fi

# Check if credentials are valid
LIST_OUTPUT=$(smbclient -L "//$SMB_HOST" -U "$USERNAME%$PASSWORD" -g 2>&1)
if echo "$LIST_OUTPUT" | grep -qE "NT_STATUS_LOGON_FAILURE|NT_STATUS_ACCESS_DENIED"; then
  json "offline_invalid_credentials" 1
fi

# Now try checking the target folder
FOLDER_CHECK=$(smbclient "//$SMB_HOST/$SMB_SHARE" -U "$USERNAME%$PASSWORD" -c "ls \"$TARGET_PATH\"" 2>&1)

if echo "$FOLDER_CHECK" | grep -q "NT_STATUS_LOGON_FAILURE"; then
  json "offline_invalid_credentials" 1
elif echo "$FOLDER_CHECK" | grep -q "NT_STATUS_ACCESS_DENIED"; then
  json "offline_insufficient_permissions" 1
elif echo "$FOLDER_CHECK" | grep -qE "NT_STATUS_OBJECT_NAME_NOT_FOUND|NT_STATUS_OBJECT_PATH_NOT_FOUND"; then
  json "missing_folder" 1
elif echo "$FOLDER_CHECK" | grep -q "NT_STATUS"; then
  # Generic SMB failure
  json "offline_connection_error" 2
else
  json "online" 0
fi
