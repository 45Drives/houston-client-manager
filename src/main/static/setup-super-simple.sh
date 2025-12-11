#!/usr/bin/env bash
# setup-super-simple.sh
# --------------------------------------------------------------------
# Installs: 45Drives repo, Cockpit(+module), Samba, ZFS
# --------------------------------------------------------------------

set -eo pipefail

# ----- stdout/stderr go to both console and log, line-buffered -----
LOG=/var/log/setup-super-simple-$(date +%F_%H%M).log
exec > >(stdbuf -oL -eL tee -a "$LOG") 2>&1

echo "[BOOTSTRAP_STARTED] $(date)"

if [[ $EUID -ne 0 ]]; then
  echo "[ERROR] This script must be run as root (or with passwordless sudo)."
  echo "[ERROR] Please use the root account in the Setup Wizard, or configure sudoers accordingly."
  exit 1
fi

# Load OS metadata once
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
else
  echo "[ERROR] /etc/os-release not found; unsupported Linux distribution."
  exit 1
fi

OS_LIKE="${ID_LIKE:-$ID}"

case "$OS_LIKE" in
  *rhel*)
    install_pkg() {
      echo "[INFO] Installing: $*"
      dnf install -y "$@"
    }
    query_pkg() {
      local pkg=$1
      rpm -qa | grep "^$pkg" &>/dev/null
    }
    open_firewall_ports() {
      if command -v firewall-cmd >/dev/null 2>&1; then
        echo "[INFO] Opening ports for Cockpit (9090/TCP), Houston Broadcaster (9099/TCP) and mDNS (5353/UDP)…"

        # Cockpit (9090) and mDNS via services
        firewall-cmd --quiet --permanent --add-service=cockpit || true
        firewall-cmd --quiet --permanent --add-service=mdns || true

        # Houston broadcaster on 9099/tcp
        firewall-cmd --quiet --permanent --add-port=9099/tcp || true

        firewall-cmd --reload || true
      else
        echo "[WARN] firewalld not found; skipping Cockpit/mDNS/Houston firewall configuration."
      fi
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
    KERNEL_DEVEL_PKGS=(dkms kernel-devel-"$(uname -r)" kernel-headers-"$(uname -r)")
    REQUIRED_PACKAGES=(cockpit samba python3 python3-pip python3-pyudev)
    OUR_REQUIRED_PACKAGES=(cockpit-super-simple-setup zfs cockpit-zfs)
    REQUIRED_SERVICES=(cockpit.socket smb nmb zfs-import-cache zfs-import-scan zfs-mount zfs-zed)
    ;;

  *debian*|*ubuntu*)
    install_pkg() {
      echo "[INFO] Installing: $*"
      apt install -y "$@"
    }
    query_pkg() {
      local pkg=$1
      dpkg -s "$pkg" >/dev/null 2>&1
    }
    open_firewall_ports() {
      if command -v ufw >/dev/null 2>&1; then
        echo "[INFO] Opening ports for Cockpit (9090/TCP), Houston Broadcaster (9099/TCP) and mDNS (5353/UDP)…"

        ufw allow 9090/tcp || true          # Cockpit
        ufw allow 9099/tcp || true          # Houston broadcaster
        ufw allow mdns || ufw allow 5353/udp || true  # mDNS

        ufw reload || true
      else
        echo "[WARN] ufw not found; skipping Cockpit/mDNS/Houston firewall configuration."
      fi
    }
    setup_45d_repo() {
      apt update -y
      apt install -y ca-certificates gnupg
      wget -qO - https://repo.45drives.com/key/gpg.asc | gpg --pinentry-mode loopback --batch --yes --dearmor -o /usr/share/keyrings/45drives-archive-keyring.gpg
      curl -sSL "https://repo.45drives.com/repofiles/${ID}/45drives-community-${VERSION_CODENAME}.list" \
        -o "/etc/apt/sources.list.d/45drives-community-${VERSION_CODENAME}.list"
      apt update -y
    }
    KERNEL_DEVEL_PKGS=(dkms linux-headers linux-headers-"$(uname -r)")
    REQUIRED_PACKAGES=(cockpit samba python3 python3-pip python3-pyudev)
    OUR_REQUIRED_PACKAGES=(cockpit-super-simple-setup zfs-dkms zfsutils)
    REQUIRED_SERVICES=(cockpit.socket smbd nmbd zfs-import-cache zfs-import-scan zfs-mount zfs-zed)
    ;;

  *)
    echo "[ERROR] Unsupported OS: ID=${ID:-unknown} ID_LIKE=${ID_LIKE:-'(unset)'}"
    exit 1
    ;;
esac

set -u

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

open_firewall_ports

systemctl enable --now "${REQUIRED_SERVICES[@]}"

# restarting cockpit socket required to load newly installed modules
systemctl restart cockpit.socket

echo "[INFO] Setup complete! Access Cockpit at: https://$(hostname -I | awk '{print $1}'):9090"
echo "[BOOTSTRAP_DONE]"
