#!/bin/bash
set -euo pipefail

REMOTE_BUILD_DIR="build_houston_m_temp"
LOCAL_APP_DIR="$(cd "$(dirname "$0")"; pwd)"
LOCAL_OUTPUT_DIR="$LOCAL_APP_DIR/builds"

# Create output dir
mkdir -p "$LOCAL_OUTPUT_DIR"

# SSH hosts
LINUX_HOST="root@192.168.123.5"

# Common SSH option
SSH_OPTS="-o StrictHostKeyChecking=no"

# Exclude dirs during copy
EXCLUDES=(
  --exclude=".git"
  --exclude="dist"
  --exclude="build"
  --exclude="builds"
  --exclude="node_modules"
)

# ========== Linux Build ==========
build_linux() {
  echo "🐧 Starting Linux build…"
  ssh $SSH_OPTS "$LINUX_HOST" "rm -rf $REMOTE_BUILD_DIR"
  rsync -avz --progress "${EXCLUDES[@]}" -e "ssh $SSH_OPTS" \
    "$LOCAL_APP_DIR/" "$LINUX_HOST:$REMOTE_BUILD_DIR/"

  ssh $SSH_OPTS "$LINUX_HOST" bash -c "'
    set -e
    cd $REMOTE_BUILD_DIR
    export NVM_DIR=\$HOME/.nvm
    [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\"
    nvm use 23
    corepack enable
    corepack prepare yarn@stable --activate
    yarn --version
    yarn install
    yarn build:linux
  '"

  mkdir -p "$LOCAL_OUTPUT_DIR/linux"
  scp -r $SSH_OPTS \
    "$LINUX_HOST:$REMOTE_BUILD_DIR/dist/45drives-setup-wizard*" \
    "$LOCAL_OUTPUT_DIR/linux/"

  echo "✅ Linux build complete."
}

if build_linux; then
  echo "✓ Linux build succeeded"
else
  echo "❌ Linux build failed"
  exit 1
fi

echo "🎉 All builds succeeded! Output in: $LOCAL_OUTPUT_DIR"