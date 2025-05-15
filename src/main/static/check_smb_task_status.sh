#!/bin/bash

SMB_HOST="$1"
SMB_SHARE="$2"
TARGET_PATH="$3"
USERNAME="$4"
PASSWORD="$5"

# Check if host is reachable
ping -c 1 "$SMB_HOST" > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo '{"status": "offline_unreachable"}'
  exit 0
fi

# Validate credentials
LIST_OUTPUT=$(smbclient -L "//$SMB_HOST" -U "$USERNAME%$PASSWORD" -g 2>&1)
if echo "$LIST_OUTPUT" | grep -q "NT_STATUS_LOGON_FAILURE\|NT_STATUS_ACCESS_DENIED"; then
  echo '{"status": "offline_invalid_credentials"}'
  exit 0
fi

# Check folder
FOLDER_CHECK=$(smbclient "//$SMB_HOST/$SMB_SHARE" -U "$USERNAME%$PASSWORD" -c "ls \"$TARGET_PATH\"" 2>&1)
if echo "$FOLDER_CHECK" | grep -q "NT_STATUS_LOGON_FAILURE\|NT_STATUS_ACCESS_DENIED"; then
  echo '{"status": "offline_invalid_credentials"}'
elif echo "$FOLDER_CHECK" | grep -q "NT_STATUS_OBJECT_NAME_NOT_FOUND\|NT_STATUS_OBJECT_PATH_NOT_FOUND"; then
  echo '{"status": "missing_folder"}'
elif echo "$FOLDER_CHECK" | grep -q "NT_STATUS"; then
  echo '{"status": "offline_connection_error"}'
else
  echo '{"status": "online"}'
fi