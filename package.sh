#!/bin/bash
set -x
set -e

# Configuration: Set your remote hosts https://frank:8006
WIN_HOST="user@192.168.209.83"
# MAC_HOST="45drives@192.168.210.11"
# MAC_HOST="protocase@192.168.9.9"
LINUX_HOST="root@192.168.13.13"
# LINUX_HOST="root@192.168.207.44"

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

# Build on Linux
echo "🐧 Building on Linux..."
/usr/bin/scp "/tmp/app.tar.gz" "$LINUX_HOST:app.tar.gz"
ssh "$LINUX_HOST" "
       set -e
   export NVM_DIR=\$HOME/.nvm
   [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\"
   nvm use 23
   node -v
   npm -v
   echo 'Removing old build directory...'
   rm -rf \"${REMOTE_BUILD_DIR}\" && mkdir -p \"${REMOTE_BUILD_DIR}\"
   
   echo 'Extracting app.tar.gz...'
   tar -xzf ~/app.tar.gz -C \"${REMOTE_BUILD_DIR}\"

   echo 'Installing dependencies and building...'
   cd \"${REMOTE_BUILD_DIR}\"

   echo 'Final npm install and build...'
   yarn install && yarn build:linux
"
rm -rf $LOCAL_OUTPUT_DIR/linux/
mkdir $LOCAL_OUTPUT_DIR/linux/
/usr/bin/scp -r "$LINUX_HOST:$REMOTE_BUILD_DIR/dist/45drives-setup-wizard*" "$LOCAL_OUTPUT_DIR/linux/"

# Build on macOS
# echo "🍏 Building on macOS..."
# /usr/bin/scp "/tmp/app.tar.gz" "$MAC_HOST:app.tar.gz"
# ssh "$MAC_HOST" "
#         set -e
#     export PATH="/opt/homebrew/bin:/usr/local/bin:\$PATH"
#     brew install node
#     node -v
#     npm -v
#     echo 'Removing old build directory...'
#     rm -rf \"${REMOTE_BUILD_DIR}\" && mkdir -p \"${REMOTE_BUILD_DIR}\"
    
#     echo 'Extracting app.tar.gz...'
#     tar -xzf ~/app.tar.gz -C \"${REMOTE_BUILD_DIR}\"

#     echo 'Installing dependencies and building...'
#     cd \"${REMOTE_BUILD_DIR}\"
    
#     echo 'Final npm install and build...'
#     yarn install && yarn build:mac
# "
# /usr/bin/scp -r "$MAC_HOST:$REMOTE_BUILD_DIR/dist/45drives-setup-wizard*" "$LOCAL_OUTPUT_DIR/mac/"

echo "✅ All builds completed. Output is in: $LOCAL_OUTPUT_DIR"
