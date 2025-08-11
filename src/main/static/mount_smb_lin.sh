#!/bin/bash

# --- Input Validation ---
if [ -z "$1" ]; then echo '{"error": "No network path provided"}'; exit 1; fi
if [ -z "$2" ]; then echo '{"error": "No share provided"}'; exit 1; fi
if [ -z "$3" ]; then echo '{"error": "No username provided"}'; exit 1; fi
if [ -z "$4" ]; then echo '{"error": "No password provided"}'; exit 1; fi

# --- Assign Parameters ---
SMB_HOST="$1"
SMB_SHARE="$2"
USERNAME="$3"
PASSWORD="$4"
SMB_PATH="//$SMB_HOST/$SMB_SHARE"
MOUNT_POINT="/mnt/houston-mounts/$SMB_SHARE"
CREDENTIALS_FILE="/etc/smbcredentials/$SMB_HOST.cred"

# --- Debug Output (sanitized) ---
# echo "[INFO] Mounting $SMB_PATH to $MOUNT_POINT"

# --- Ensure Mount Point Exists ---
sudo mkdir -p "$MOUNT_POINT"

# --- Check if Already Mounted ---
if mountpoint -q "$MOUNT_POINT"; then
    CURRENT_SHARE=$(mount | grep "on $MOUNT_POINT type cifs" | awk '{print $1}')
    if [ "$CURRENT_SHARE" == "$SMB_PATH" ]; then
        echo "{\"MountPoint\": \"$MOUNT_POINT\", \"smb_server\": \"$SMB_HOST\", \"info\": \"Already mounted\"}"
        exit 0
    else
        echo "[WARN] Mount point busy with $CURRENT_SHARE, trying to unmount..." >&2
        sudo umount "$MOUNT_POINT" || sudo umount -l "$MOUNT_POINT"
        sleep 1
        if mountpoint -q "$MOUNT_POINT"; then
            echo '{"error": "Mount point is still busy after attempted unmount"}'
            exit 1
        fi
    fi
fi

# --- Write Credentials File ---
sudo mkdir -p /etc/smbcredentials
echo -e "username=$USERNAME\npassword=$PASSWORD" | sudo tee "$CREDENTIALS_FILE" > /dev/null
sudo chmod 600 "$CREDENTIALS_FILE"

# --- Mount SMB Share ---
sudo mount -t cifs "$SMB_PATH" "$MOUNT_POINT" -o "credentials=$CREDENTIALS_FILE,vers=3.0,sec=ntlmssp,uid=$(id -u),gid=$(id -g),dir_mode=0775,file_mode=0664"

# --- Success Check ---
if [ $? -eq 0 ]; then
    echo "{\"MountPoint\": \"$MOUNT_POINT\", \"smb_server\": \"$SMB_HOST\"}"
    exit 0
else
    echo '{"error": "Failed to mount SMB share"}'
    exit 1
fi
