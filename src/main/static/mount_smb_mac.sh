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

# Create the LaunchDaemon plist
echo "Creating LaunchDaemon for auto-mounting on boot..."
LAUNCHD_SCRIPT="/usr/local/bin/mount_smb_$HOST_$SHARE_NAME.sh"

# Create the script that launchd will run
tee "$LAUNCHD_SCRIPT" >/dev/null <<EOF
#!/bin/bash
exec > >(tee -a /tmp/mount_smb_boot.log) 2>&1
echo "===============================" >> /tmp/mount_smb_boot.log
echo "\$(date) - Starting SMB mount on boot" >> /tmp/mount_smb_boot.log
sleep 30
echo "\$(date) - Checking if Samba server is up..." >> /tmp/mount_smb_boot.log
while ! ping -c 1 "$HOST" &>/dev/null; do
    echo "\$(date) - Samba server is not reachable, retrying in 10 seconds..." >> /tmp/mount_smb_boot.log
    sleep 10
done
echo "\$(date) - Samba server is online, attempting to mount..." >> /tmp/mount_smb_boot.log
osascript -e 'try' \
    -e 'mount volume "$SERVER" as user name "$USERNAME" with password "$PASSWORD"' \
    -e 'on error errMsg' \
    -e 'do shell script "echo \"\$(date) - Failed to mount SMB share: \" & errMsg >> /tmp/mount_smb_boot.log"' \
    -e 'return' \
    -e 'end try'
if mount | grep -q "$MOUNTED_VOLUME"; then
    echo "\$(date) - SMB share mounted successfully" >> /tmp/mount_smb_boot.log
else
    echo "\$(date) - ERROR: Failed to mount SMB share" >> /tmp/mount_smb_boot.log
fi
EOF

# Make the script executable
chmod +x "$LAUNCHD_SCRIPT"

# Create the launchd plist file
tee "$PLIST_FILE" >/dev/null <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.smb.mount</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$LAUNCHD_SCRIPT</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/tmp/mount_smb_launchd.log</string>

    <key>StandardErrorPath</key>
    <string>/tmp/mount_smb_launchd_error.log</string>
</dict>
</plist>
EOF

# Set permissions and load the LaunchDaemon
echo "Setting permissions and loading LaunchDaemon..."
chmod 644 "$PLIST_FILE"
chown root:wheel "$PLIST_FILE"
launchctl load -w "$PLIST_FILE"

open $MOUNTED_VOLUME

# Close JSON output and print once
JSON_OUTPUT+="}"
echo "$JSON_OUTPUT"