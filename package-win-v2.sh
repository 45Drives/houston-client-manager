#!/usr/bin/env bash
set -x
set -e

# Configuration: Set your remote Windows host
WIN_HOST="user@192.168.207.47"

# Remote and local paths
REMOTE_BUILD_DIR="build_houston_m_temp"
LOCAL_APP_DIR="$(dirname "$0")"
LOCAL_OUTPUT_DIR="$(dirname "$0")/builds/windows"

# Ensure local output directory exists
mkdir -p "$LOCAL_OUTPUT_DIR"

# 1) Ensure remote build dir exists and clear out old dist
ssh "$WIN_HOST" "cmd.exe /c \"\
  if not exist $REMOTE_BUILD_DIR mkdir $REMOTE_BUILD_DIR && \
  if exist $REMOTE_BUILD_DIR\\dist rmdir /s /q $REMOTE_BUILD_DIR\\dist\
\""

# 2) Rsync local → remote (only changed files)
rsync -avz --delete \
  --exclude='.git' \
  --exclude='dist' \
  --exclude='node_modules' \
  "$LOCAL_APP_DIR/" \
  "$WIN_HOST:$REMOTE_BUILD_DIR/"

# 3) Build on Windows
echo "🔧 Building on Windows…"
ssh "$WIN_HOST" "cd $REMOTE_BUILD_DIR && yarn install && yarn build:win"

# 4) Rsync back only the new artifacts
rsync -avz \
  "$WIN_HOST:$REMOTE_BUILD_DIR/dist/45drives-setup-wizard*" \
  "$LOCAL_OUTPUT_DIR/"

echo "✅ All builds completed. Output is in: $LOCAL_OUTPUT_DIR"
