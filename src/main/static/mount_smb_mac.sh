#!/bin/bash

# ----------- Argument validation -----------
if [ -z "$1" ]; then echo '{"error": "No host provided"}'; exit 1; fi
if [ -z "$2" ]; then echo '{"error": "No share name provided"}'; exit 1; fi
if [ -z "$3" ]; then echo '{"error": "No username provided"}'; exit 1; fi
if [ -z "$4" ]; then echo '{"error": "Popup"}'; exit 1; fi

HOST="$1"
SHARE="$2"
USERNAME="$3"
popup="$4"
SERVER="smb://${HOST}/${SHARE}"
MOUNT_POINT="/Volumes/${SHARE}"
KEYCHAIN_SERVICE="houston-smb-${SHARE}"

# ----------- Retrieve password from Keychain -----------
PASSWORD=$(security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${USERNAME}" -w 2>/dev/null)
if [ -z "$PASSWORD" ]; then
    echo "{\"error\": \"No password found in Keychain for service ${KEYCHAIN_SERVICE} and user ${USERNAME}\"}"
    exit 1
fi

# ----------- Check if already mounted -----------
if mount | grep -q "${MOUNT_POINT}"; then
    if [ "$popup" = "popup" ]; then
        open "${MOUNT_POINT}"
    fi
    echo "{\"smb_server\": \"${SERVER}\", \"share\": \"${SHARE}\", \"status\": \"already mounted\", \"MountPoint\": \"${MOUNT_POINT}\"}"
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

if [[ "$MOUNT_RESULT" == ERROR:* ]]; then
    ERROR_MSG=${MOUNT_RESULT#"ERROR: "}
    echo "{\"smb_server\": \"${SERVER}\", \"share\": \"${SHARE}\", \"error\": \"${ERROR_MSG//\"/\\\"}\"}"
    exit 1
fi

# ----------- Validate the mount -----------

sleep 2

if mount | grep -q "${HOST}/${SHARE}"; then
    if [ -d "${MOUNT_POINT}" ]; then
        open "${MOUNT_POINT}"
        if [ "$popup" = "popup" ]; then
            open "${MOUNT_POINT}"
        fi
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
