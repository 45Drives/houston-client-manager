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

# Assign parameters
SMB_HOST="$1"      # Example: //192.168.209.228/share
SMB_SHARE="$2"      
USERNAME="$3"
PASSWORD="$4"

SERVER="smb://$SMB_HOST/$SMB_SHARE"

# Use AppleScript to mount the share
osascript <<EOF
try
    mount volume "$SERVER" as user name "$USERNAME" with password "$PASSWORD"
on error
    do shell script "echo 'Failed to mount SMB share'"    
    return
end try
EOF

# Get the mounted volume name
MOUNTED_VOLUME="/Volumes/$(basename "$SERVER")"

# Check if the share was mounted successfully
if mount | grep -q "$MOUNTED_VOLUME"; then
    echo "Mounted successfully at $MOUNTED_VOLUME"

    # Define the cron job (Runs at reboot)
    CRON_JOB="@reboot osascript -e 'mount volume \"$SERVER\" as user name \"$USERNAME\" with password \"$PASSWORD\"'"

    CRON_JOB_ADDED="false"
    # Check if the cron job already exists
    (crontab -l 2>/dev/null | grep -qF "$CRON_JOB") || (
        # Add the cron job if it doesn't exist
        (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
        CRON_JOB_ADDED="true"
    )

    # Open the mounted folder in Finder
    open $MOUNTED_VOLUME

    echo '{"mountPoint":"'${MOUNTED_VOLUME}'", "cronJobAdded":"'${CRON_JOB_ADDED}'"}'
else
    EXIT=$?
    echo '{"error": "Failed to mount SMB share", "args": "'"$*"'"}'
    exit $EXIT
fi
