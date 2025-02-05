#!/bin/bash
# sudo apt install cifs-utils -y  # For Debian/Ubuntu
# sudo dnf install cifs-utils -y  # For Fedora/Rocky Linux

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
SMB_PATH="$1"      # Example: //192.168.209.228/share
USERNAME="$2"
PASSWORD="$3"

# Define the mount point
MOUNT_POINT="/mnt/smb_share"

# Extract SMB server IP
SMB_SERVER=$(echo "$SMB_PATH" | awk -F'/' '{print $3}')

# Check if the share is already mounted
if mount | grep -q "$MOUNT_POINT"; then
    echo '{"message": "SMB share is already mounted"}'
    
    # Open the already mounted folder
    if command -v gio >/dev/null 2>&1; then
        gio open "$MOUNT_POINT"
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$MOUNT_POINT"
    fi

    exit 0
fi

# Create mount point if it doesn't exist
sudo mkdir -p "$MOUNT_POINT"

# Mount the SMB share
sudo mount -t cifs "$SMB_PATH" "$MOUNT_POINT" -o username="$USERNAME",password="$PASSWORD",vers=3.0

# Check if mounting was successful
if [ $? -eq 0 ]; then
    echo "{\"MountPoint\": \"$MOUNT_POINT\", \"smb_server\": \"$SMB_SERVER\", \"smb_user\": \"$USERNAME\"}"
    
    # Open the mounted folder
    if command -v gio >/dev/null 2>&1; then
        gio open "$MOUNT_POINT"
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$MOUNT_POINT"
    fi
    
    exit 0
else
    echo '{"error": "Failed to mount SMB share"}'
    exit 1
fi
