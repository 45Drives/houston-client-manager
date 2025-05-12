#!/bin/bash

SMB_HOST="$1"
SMB_SHARE="$2"
TARGET="$3"
USERNAME="$4"
PASSWORD="$5"

# Ping to check host availability
ping -c 1 "$SMB_HOST" > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo '{"status": "offline", "reason": "unreachable"}'
  exit 0
fi

# Check credentials by listing shares
LIST_OUTPUT=$(smbclient -L "//$SMB_HOST" -U "$USERNAME%$PASSWORD" -g 2>&1)
if echo "$LIST_OUTPUT" | grep -q "NT_STATUS_LOGON_FAILURE\|NT_STATUS_ACCESS_DENIED"; then
  echo '{"status": "offline", "reason": "invalid_credentials"}'
  exit 0
fi

# Now check if target directory exists inside the share
FOLDER_CHECK=$(smbclient "//$SMB_HOST/$SMB_SHARE" -U "$USERNAME%$PASSWORD" -c "ls \"$TARGET\"" 2>&1)

if echo "$FOLDER_CHECK" | grep -q "NT_STATUS_OBJECT_NAME_NOT_FOUND"; then
  echo '{"status": "missing_folder"}'
elif echo "$FOLDER_CHECK" | grep -q "NT_STATUS"; then
  echo '{"status": "offline", "reason": "connection_error"}'
else
  echo '{"status": "online"}'
fi
