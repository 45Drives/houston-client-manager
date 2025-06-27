#!/bin/bash
# sudo apt install cifs-utils -y  # For Debian/Ubuntu
# sudo dnf install cifs-utils -y  # For Fedora/Rocky Linux

# Check if all arguments are provided
if [ -z "$1" ]; then
    echo '{"error": "No network path provided"}'
    exit 1
fi
if [ -z "$2" ]; then
    echo '{"error": "No share provided"}'
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

# Assign parameters
SMB_HOST="$1"      # Example: //192.168.209.228/share
SMB_SHARE="$2"      
USERNAME="$3"
PASSWORD="$4"

SMB_PATH="//$SMB_HOST/$SMB_SHARE"

# Define the mount point
MOUNT_POINT="/mnt/$SMB_SHARE"
# MOUNT_POINT="/mnt/backup"

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

# Store credentials securely
CREDENTIALS_FILE="/etc/smbcredentials/$SMB_SERVER.cred"
sudo mkdir -p /etc/smbcredentials
echo -e "username=$USERNAME\npassword=$PASSWORD" | sudo tee "$CREDENTIALS_FILE" > /dev/null
sudo chmod 600 "$CREDENTIALS_FILE"

# Add entry to /etc/fstab if not present
# FSTAB_ENTRY="$SMB_PATH $MOUNT_POINT cifs credentials=$CREDENTIALS_FILE,vers=3.0,uid=$(id -u),gid=$(id -g),dir_mode=0700,file_mode=0600,forceuid,forcegid 0 0"

# if ! grep -q "$SMB_PATH" /etc/fstab; then
#     echo "$FSTAB_ENTRY" | sudo tee -a /etc/fstab
# fi

# Mount the SMB share
# sudo mount -a
sudo mount -t cifs "$SMB_PATH" "$MOUNT_POINT" -o credentials=$CREDENTIALS_FILE,vers=3.0,sec=ntlmssp,uid=$(id -u),gid=$(id -g),dir_mode=0775,file_mode=0664

# Check if mounting was successful
if [ $? -eq 0 ]; then
    echo "{\"MountPoint\": \"$MOUNT_POINT\", \"smb_server\": \"$SMB_SERVER\"}"
    
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