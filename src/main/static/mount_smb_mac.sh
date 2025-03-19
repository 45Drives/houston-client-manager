#!/bin/bash

# Check if all arguments are provided
if [ -z "$1" ]; then
    echo '{"error": "No network path provided"}'
    exit 1
fi
if [ -z "$2" ]; then
    echo '{"error": "No username provided"}'
    exit 1
fi
if [ -z "$3" ]; then
    echo '{"error": "No password provided"}'
    exit 1
fi

# Start JSON output
JSON_OUTPUT="{"

# Assign parameters
HOST="$1"      # Example: //192.168.209.228/share
SHARE_NAME="$2"      
USERNAME="$3"
PASSWORD="$4"

SERVER="smb://$HOST/$SHARE_NAME"

# Extract the share name from the path
SHARE_NAME=$(basename "$SERVER")
MOUNTED_VOLUME="/Volumes/$SHARE_NAME"

JSON_OUTPUT+="\"server\": \"$SERVER\", \"share\": \"$SHARE_NAME\", "

# Check if already mounted
if mount | grep -q "$MOUNTED_VOLUME"; then
    JSON_OUTPUT+="\"status\": \"already mounted\", \"mount_point\": \"$MOUNTED_VOLUME\""
else

    # Use AppleScript to mount the share
    osascript <<EOF
    try
        set currentUser to do shell script "whoami"

        mount volume "$SERVER" as user name "$USERNAME" with password "$PASSWORD"
    on error errMsg
        do shell script "echo 'Failed to mount SMB share: ' & errMsg >> $LOG_FILE"
        return
    end try
EOF

    # Wait a bit to allow the mount to complete
    sleep 3

    # Check if the share was mounted successfully
    if mount | grep -q "$MOUNTED_VOLUME"; then
        JSON_OUTPUT+="\"status\": \"mounted successfully\", \"mount_point\": \"$MOUNTED_VOLUME\""
    else
        JSON_OUTPUT+="\"error\": \"Failed to mount the SMB share\""
        echo "$JSON_OUTPUT}"
        exit 1
    fi
fi

open $MOUNTED_VOLUME

# Close JSON output and print once
JSON_OUTPUT+="}"
echo "$JSON_OUTPUT"