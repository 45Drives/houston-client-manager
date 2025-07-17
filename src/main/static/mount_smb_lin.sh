#!/bin/bash

# Check if all arguments are provided
if [ -z "$1" ]; then echo '{"error": "No network path provided"}'; exit 1; fi
if [ -z "$2" ]; then echo '{"error": "No share provided"}'; exit 1; fi
if [ -z "$3" ]; then echo '{"error": "No username provided"}'; exit 1; fi
if [ -z "$4" ]; then echo '{"error": "No password provided"}'; exit 1; fi

# Assign parameters
SMB_HOST="$1"
SMB_SHARE="$2"
USERNAME="$3"
PASSWORD="$4"

SMB_PATH="//$SMB_HOST/$SMB_SHARE"
MOUNT_POINT="/mnt/houston-mounts/$SMB_SHARE"
SMB_SERVER=$(echo "$SMB_PATH" | awk -F'/' '{print $3}')

# Check if already mounted at the correct mount point
if mountpoint -q "$MOUNT_POINT"; then
    MOUNTED_SHARE=$(mount | grep "on $MOUNT_POINT type cifs" | awk '{print $1}')
    if [ "$MOUNTED_SHARE" == "$SMB_PATH" ]; then
        echo "{\"MountPoint\": \"$MOUNT_POINT\", \"smb_server\": \"$SMB_SERVER\", \"info\": \"Already mounted\"}"
        exit 0
    else
        echo "{\"error\": \"Mount point $MOUNT_POINT is busy with a different share: $MOUNTED_SHARE\"}"
        exit 1
    fi
fi

# Create mount point if it doesn't exist
sudo mkdir -p "$MOUNT_POINT"

# Store credentials securely
CREDENTIALS_FILE="/etc/smbcredentials/$SMB_SERVER.cred"
sudo mkdir -p /etc/smbcredentials
echo -e "username=$USERNAME\npassword=$PASSWORD" | sudo tee "$CREDENTIALS_FILE" > /dev/null
sudo chmod 600 "$CREDENTIALS_FILE"

# Mount the SMB share
sudo mount -t cifs "$SMB_PATH" "$MOUNT_POINT" -o "credentials=$CREDENTIALS_FILE,vers=3.0,sec=ntlmssp,uid=$(id -u),gid=$(id -g),dir_mode=0775,file_mode=0664"

# Check if mounting was successful
if [ $? -eq 0 ]; then
    echo "{\"MountPoint\": \"$MOUNT_POINT\", \"smb_server\": \"$SMB_SERVER\"}"
    exit 0
else
    echo '{"error": "Failed to mount SMB share"}'
    exit 1
fi
