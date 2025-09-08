#!/usr/bin/env bash
# setup-super-simple.sh
# --------------------------------------------------------------------
# Installs: 45Drives repo, Cockpit(+module), Samba, ZFS
# --------------------------------------------------------------------

set -euo pipefail

# ----- stdout/stderr go to both console and log, line-buffered -----
LOG=/var/log/setup-super-simple-$(date +%F_%H%M).log
exec > >(stdbuf -oL -eL tee -a "$LOG") 2>&1

echo "[BOOTSTRAP_STARTED] $(date)"

# ------------------------- Self-elevate ----------------------------
[[ $EUID -ne 0 ]] && { echo "[INFO] Re-running with sudo..."; exec sudo "$0" "$@"; }

case "$(source /etc/os-release; echo "$ID_LIKE")" in

  *rhel*)
  install_pkg() {
    local pkg=$1
    echo "[INFO] Installing $pkg..."
    dnf install -y "$pkg"
  }
  query_pkg() {
    local pkg=$1
    rpm -qa | grep "^$pkg" &>/dev/null
  }
  open_cockpit_firewall_port() {
    echo "[INFO] Opening ports for Cockpit (9090/TCP)..."
    firewall-cmd --quiet --permanent --add-service=cockpit && firewall-cmd --reload
  }
  setup_45d_repo() {
    if [[ -f "/etc/yum.repos.d/45drives.repo" ]]; then
      echo "45Drives repo found. Archiving..."
      mkdir -p /opt/45drives/archives/repos
      mv /etc/yum.repos.d/45drives.repo "/opt/45drives/archives/repos/45drives-$(date +%Y-%m-%d).repo"
      echo "The obsolete repos have been archived to '/opt/45drives/archives/repos'. Setting up the new repo..."
    fi
    curl -sSL https://repo.45drives.com/repofiles/rocky/45drives-community.repo -o /etc/yum.repos.d/45drives-community.repo
    dnf clean all
  }
  # required for dkms builds, zfs:
  KERNEL_DEVEL_PKGS=(dkms kernel-devel kernel-headers kernel-devel-"$(uname -r)" kernel-headers-"$(uname -r)")
  # required from system repos:
  REQUIRED_PACKAGES=(cockpit samba python3 python3-pip python3-pyudev)
  # required from our own repos:
  OUR_REQUIRED_PACKAGES=(cockpit-super-simple-setup zfs cockpit-zfs)
  REQUIRED_SERVICES=(cockpit.socket smb nmb zfs-import-cache zfs-import-scan zfs-mount zfs-zed)
  ;;

  *debian*)
  install_pkg() {
    local pkg=$1
    echo "[INFO] Installing $pkg..."
    apt install -y "$pkg"
  }
  query_pkg() {
    local pkg=$1
    dpkg -s | grep "^$pkg" &>/dev/null
  }
  open_cockpit_firewall_port() {
    echo "[INFO] Opening ports for Cockpit (9090/TCP)..."
    ufw allow 9090/tcp && ufw reload
  }
  setup_45d_repo() {
    apt update -y
    apt install -y ca-certificates gnupg
    wget -qO - https://repo.45drives.com/key/gpg.asc | gpg --pinentry-mode loopback --batch --yes --dearmor -o /usr/share/keyrings/45drives-archive-keyring.gpg
    curl -sSL "https://repo.45drives.com/repofiles/$(source /etc/os-release; echo "$ID")/45drives-community-$(source /etc/os-release; echo "$VERSION_CODENAME").list" -o "/etc/apt/sources.list.d/45drives-community-$(source /etc/os-release; echo "$VERSION_CODENAME").list"
    apt update -y
  }
  # required for dkms builds, zfs:
  KERNEL_DEVEL_PKGS=(dkms linux-headers linux-headers-"$(uname -r)")
  # required from system repos:
  REQUIRED_PACKAGES=(cockpit samba python3 python3-pip python3-pyudev)
  # required from our own repos:
  OUR_REQUIRED_PACKAGES=(cockpit-super-simple-setup zfs-dkms zfsutils)
  REQUIRED_SERVICES=(cockpit.socket smbd nmbd zfs-import-cache zfs-import-scan zfs-mount zfs-zed)
  ;;

esac

if ! rpm -q epel-release &>/dev/null; then
  echo "[INFO] Installing epel-release (for DKMS)..."
  dnf install epel-release -y
  dnf makecache
fi

# install required packages
install_pkg "${KERNEL_DEVEL_PKGS[@]}"
install_pkg "${REQUIRED_PACKAGES[@]}"


# ---------------------- Ensure Node.js v18 ----------------------
echo "[INFO] Checking for Node.js installation..."
if command -v node >/dev/null 2>&1; then
  NODE_VERSION=$(node -v | sed 's/v//')
  echo "[INFO] Node.js version detected: $NODE_VERSION"
else
  echo "[INFO] Node.js not found."
  NODE_VERSION=""
fi

if [[ "$NODE_VERSION" =~ ^18\. ]]; then
  echo "[INFO]  Node.js v18 is already installed."
else
  echo "[INFO] Installing Node.js v18 via NVM..."

  export NVM_DIR="$HOME/.nvm"
  if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    echo "[INFO] Installing NVM..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  fi

  # Load NVM
  export NVM_DIR="$HOME/.nvm"
  source "$NVM_DIR/nvm.sh"

  # Install Node.js v18
  nvm install 18
  nvm alias default 18

  echo "[INFO]  Node.js v18 installed and set as default via NVM."
fi

# Symlink Node.js binary globally (optional, for systemd services)
for node_dir in "$HOME/.nvm/versions/node"/v18*/bin; do
  if [[ -x "$node_dir/node" ]]; then
    echo "[INFO] Found Node.js v18 in: $node_dir"
    ln -sf "$node_dir/node" /usr/local/bin/node
    ln -sf "$node_dir/npm" /usr/local/bin/npm
    echo "[INFO] Symlinked Node.js v18 binaries to /usr/local/bin"
    break
  fi
done

if node -v | grep -q '^v18'; then
  echo "[INFO]  Node.js v18 is now the active system version"
else
  echo "[WARN]  Node.js v18 symlink may not have taken effect globally"
fi

# set up 45Drives repo
if setup_45d_repo; then
  install_pkg "${OUR_REQUIRED_PACKAGES[@]}"
  install_pkg python3-pyudev || pip3 install pyudev
else
  echo "Failed to set up 45Drives repo!" >&2
  # ... TODO: build zfs and install cockpit-super-simple-setup manually ?
  exit 1
fi

# zfs setup
if [[ ! -f /etc/modules-load.d/zfs.conf ]]; then
  echo "zfs" > /etc/modules-load.d/zfs.conf
fi
modprobe zfs

open_cockpit_firewall_port

systemctl enable --now "${REQUIRED_SERVICES[@]}"

# restarting cockpit socket required to load newly installed modules
systemctl restart cockpit.socket

echo "[INFO] Setup complete! Access Cockpit at: https://$(hostname -I | awk '{print $1}'):9090"
echo "[BOOTSTRAP_DONE]"
