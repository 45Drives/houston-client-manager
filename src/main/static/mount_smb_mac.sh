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

SMB_PATH="$SMB_HOST/$SMB_SHARE"

# Define the mount point
MOUNT_POINT="~/SMB_Share"

# Extract SMB server IP
SMB_SERVER=$(echo "$SMB_PATH" | awk -F'/' '{print $3}')

# Check if the share is already mounted
if mount | grep -q "$MOUNT_POINT"; then
    echo '{"message": "SMB share is already mounted"}'
    
    # Open the already mounted folder in Finder
    open "$MOUNT_POINT"

    exit 0
fi

# Create the mount point if it doesn't exist
mkdir -p "$MOUNT_POINT"

# Mount the SMB share
mount_smbfs "//$USERNAME:$PASSWORD@$SMB_PATH" "$MOUNT_POINT"

# Check if mounting was successful
if [ $? -eq 0 ]; then
    echo "{\"MountPoint\": \"$MOUNT_POINT\", \"smb_server\": \"$SMB_SERVER\"}"
    
    # Open the mounted folder in Finder
    open "$MOUNT_POINT"

    exit 0
else

    echo '{"error": "Failed to mount SMB share", "args": "'$@'"}'
    exit 1
fi
