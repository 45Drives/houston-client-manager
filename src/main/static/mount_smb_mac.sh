#!/bin/bash

# ----------- Argument validation -----------

if [ -z "$1" ]; then
    echo '{"error": "No host provided"}'
    exit 1
fi
if [ -z "$2" ]; then
    echo '{"error": "No share name provided"}'
    exit 1
fi
if [ -z "$3" ]; then
    echo '{"error": "No username provided"}'
    exit 1
fi
if [ -z "$4" ]; then
    echo '{"error": "No password provided"}'
    exit 1
fi

# ----------- Assign variables -----------

HOST="$1"
SHARE="$2"
USERNAME="$3"
PASSWORD="$4"

SERVER="smb://${HOST}/${SHARE}"
MOUNT_POINT="/Volumes/${SHARE}"
JSON_OUTPUT="{\"server\": \"${SERVER}\", \"share\": \"${SHARE}\", "

# ----------- Check if already mounted -----------

if mount | grep -q "/Volumes/${SHARE}"; then
    JSON_OUTPUT+="\"status\": \"already mounted\", \"mount_point\": \"${MOUNT_POINT}\""
    echo "${JSON_OUTPUT}}"
    exit 0
fi

# ----------- Attempt to mount using AppleScript -----------

MOUNT_RESULT=$(osascript <<EOF
try
    mount volume "${SERVER}" as user name "${USERNAME}" with password "${PASSWORD}"
    return "SUCCESS"
on error errMsg
    return "ERROR: " & errMsg
end try
EOF
)

# ----------- Evaluate result -----------

if [[ "$MOUNT_RESULT" == ERROR:* ]]; then
    ERROR_MSG=${MOUNT_RESULT#"ERROR: "}
    JSON_OUTPUT+="\"error\": \"${ERROR_MSG//\"/\\\"}\""
    echo "${JSON_OUTPUT}}"
    exit 1
fi

# ----------- Wait a moment and re-check mount -----------

sleep 2

ACTUAL_MOUNT=$(mount | grep "$SERVER" | awk '{print $3}' | head -n 1)
if [ -n "$ACTUAL_MOUNT" ]; then
    open "$ACTUAL_MOUNT"
    JSON_OUTPUT+="\"status\": \"mounted successfully\", \"mount_point\": \"${ACTUAL_MOUNT}\""
else
    JSON_OUTPUT+="\"error\": \"Mount command succeeded but share was not found in \`mount\` output\""
    echo "${JSON_OUTPUT}}"
    exit 1
fi

# ----------- Output JSON -----------

echo "${JSON_OUTPUT}}"
exit 0
