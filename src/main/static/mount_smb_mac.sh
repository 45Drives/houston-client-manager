#!/bin/bash


echo "==============================="
echo "$(date) - Running SMB Mount Script"
echo "==============================="

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
SMB_HOST="$1"      # Example: //192.168.209.228/share
SHARE_NAME="$2"      
USERNAME="$3"
PASSWORD="$4"

SERVER="smb://$SMB_HOST/$SHARE_NAME"

# Extract the share name from the path
SHARE_NAME=$(basename "$SERVER")
MOUNTED_VOLUME="/Volumes/$SHARE_NAME"

JSON_OUTPUT+="\"server\": \"$SERVER\", \"share\": \"$SHARE_NAME\", "

echo "Attempting to mount: $SERVER"
echo "Target mount point: $MOUNTED_VOLUME"

# Check if already mounted
if mount | grep -q "$MOUNTED_VOLUME"; then
    JSON_OUTPUT+="\"status\": \"already mounted\", \"mount_point\": \"$MOUNTED_VOLUME\""
else
    echo "Mounting SMB share..."

    # Use AppleScript to mount the share
    osascript <<EOF
    try
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

# Define the cron job to mount on reboot
CRON_JOB="@reboot osascript -e 'mount volume \"$SERVER\" as user name \"$USERNAME\" with password \"$PASSWORD\"'"

echo "Checking if cron job already exists..."

# Check if the cron job already exists
EXISTING_CRON=$(crontab -l 2>/dev/null | grep -F "$SERVER")
if [ -z "$EXISTING_CRON" ]; then
    echo "Adding cron job to mount on reboot..."
    (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
    JSON_OUTPUT+=", \"cron_status\": \"added\""
else
    JSON_OUTPUT+=", \"cron_status\": \"exists\""
fi

# Close JSON output and print once
JSON_OUTPUT+="}"
echo "$JSON_OUTPUT"