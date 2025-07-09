#!/bin/bash
set -x
set -e

# Configuration: Set your remote hosts https://frank:8006
WIN_HOST="user@192.168.207.47"

REMOTE_BUILD_DIR="build_houston_m_temp"
LOCAL_APP_DIR="$(dirname "$0")"
LOCAL_OUTPUT_DIR="$(dirname "$0")/builds"

# Create the local output directory if it doesn't exist
mkdir -p "$LOCAL_OUTPUT_DIR"

# Exclude directories from copying over (dist, build, builds, node_modules) using tar
EXCLUDE_PATTERN="--exclude=.git --exclude=dist --exclude=*/dist --exclude=build --exclude=**/*/build --exclude=builds --exclude=**/*/builds --exclude=node_modules --exclude=**/*/node_modules"

tar $EXCLUDE_PATTERN -czf /tmp/app.tar.gz -C "$LOCAL_APP_DIR" .

# Build on Windows
echo "🔧 Building on Windows..."
/usr/bin/scp "/tmp/app.tar.gz" "$WIN_HOST:app.tar.gz"
ssh "$WIN_HOST" "cmd.exe /c \"if exist $REMOTE_BUILD_DIR rmdir /s /q $REMOTE_BUILD_DIR\" && mkdir $REMOTE_BUILD_DIR && tar -xzf app.tar.gz -C $REMOTE_BUILD_DIR && cd $REMOTE_BUILD_DIR && yarn install && yarn build:win"
/usr/bin/scp -r "$WIN_HOST:$REMOTE_BUILD_DIR/dist/45drives-setup-wizard*" "$LOCAL_OUTPUT_DIR/windows"

echo "✅ All builds completed. Output is in: $LOCAL_OUTPUT_DIR"

