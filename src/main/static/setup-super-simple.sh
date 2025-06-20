#!/usr/bin/env bash
set -euo pipefail

# Self-elevate
if [ "$EUID" -ne 0 ]; then
  echo "[INFO] Re-running script with sudo…"
  exec sudo "$0" "$@"
fi

# 1) Detect OS + set package-tool vars
if   [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  case "$ID" in
    rocky|rhel|centos|almalinux|fedora)
      OS_FAMILY=rhel
      PKG_INSTALL="dnf install -y"
      PKG_QUERY="rpm -q"
      FIREWALL_CMD=firewall-cmd
      ZFS_REPO_RPM="https://zfsonlinux.org/epel/zfs-release-$(rpm -E '%{rhel}').noarch.rpm"
      ;;
    debian|ubuntu)
      OS_FAMILY=debian
      PKG_INSTALL="apt update -y && apt install -y"
      PKG_QUERY="dpkg -s"
      ;;
    *)
      echo "[ERROR] Unsupported OS: $ID"
      exit 1
      ;;
  esac
else
  echo "[ERROR] Cannot detect OS (missing /etc/os-release)"
  exit 1
fi

echo "[INFO] Detected OS family: $OS_FAMILY"

# 2) Helper to install if missing
install_pkg() {
  local pkg="$1"
  # PKG_QUERY retcode 0 means “installed”
  if ! $PKG_QUERY "$pkg" &>/dev/null; then
    echo "[INFO] Installing $pkg…"
    $PKG_INSTALL "$pkg"
  else
    echo "[INFO] $pkg already installed."
  fi
}

# 3) 45Drives repo (same as you had)
add_45drives_repos() {
  if ! grep -q "repo.45drives.com" /etc/*-release* /etc/yum.repos.d/* /etc/apt/* 2>/dev/null; then
    echo "[INFO] Adding 45Drives package repository…"
    curl -fsSL https://repo.45drives.com/setup | bash || echo "[WARN] Could not add 45Drives repo"
  else
    echo "[INFO] 45Drives repo already present."
  fi
}

# 4) Node.js 18 (unchanged)
install_nodejs_18() {
  local maj
  if command -v node >/dev/null; then
    maj=$(node -v | cut -d. -f1 | tr -d v)
  else
    maj=0
  fi

  if [ "$maj" -lt 18 ]; then
    echo "[INFO] Installing Node.js 18…"
    if [[ "$PKG" == "dnf" ]]; then
      dnf remove -y nodejs npm nodejs-full-i18n || true
      curl -fsSL https://rpm.nodesource.com/setup_18.x | bash - || true
      dnf install -y nodejs
    else
      apt remove -y nodejs npm || true
      curl -fsSL https://deb.nodesource.com/setup_18.x | bash - || true
      apt update -y
      apt install -y nodejs
    fi
  else
    echo "[INFO] Node.js >=18 already installed: $(node -v)"
  fi
}


# 5) Cockpit
install_cockpit() {
  install_pkg cockpit
  systemctl enable --now cockpit.socket \
    || echo "[WARN] Could not enable/start cockpit.socket"

  # open firewall on RHEL-family
  if [[ $OS_FAMILY == rhel && -x "$(command -v "$FIREWALL_CMD")" ]]; then
    if ! $FIREWALL_CMD --list-services --permanent | grep -qw cockpit; then
      echo "[INFO] Opening firewall for Cockpit…"
      $FIREWALL_CMD --add-service=cockpit --permanent \
        && $FIREWALL_CMD --reload
    else
      echo "[INFO] Cockpit firewall rule already present."
    fi
  fi
}

install_cockpit_module() {
  install_pkg cockpit-super-simple-setup
}

# 6) ZFS
install_zfs() {
  if ! command -v zfs &>/dev/null; then
    echo "[INFO] Installing ZFS…"
    if [[ $OS_FAMILY == rhel ]]; then
      dnf install -y "$ZFS_REPO_RPM" \
        || echo "[WARN] Could not install ZFS-release RPM"
      dnf install -y kernel-devel dkms zfs \
        || { echo "[ERROR] Could not install ZFS packages"; return 1; }
    else
      apt update -y
      apt install -y zfsutils-linux zfs-dkms \
        || { echo "[ERROR] Could not install ZFS packages"; return 1; }
    fi
    echo zfs > /etc/modules-load.d/zfs.conf
    modprobe zfs || echo "[WARN] modprobe zfs failed"
  else
    echo "[INFO] ZFS already installed: $(zfs --version | head -1)"
  fi

  for svc in zfs-import-cache zfs-import-scan zfs-mount zfs-zed; do
    systemctl enable --now "$svc" \
      || echo "[WARN] Could not enable/start $svc"
  done
}

# 7) Samba
install_samba() {
  install_pkg samba
  local svcs=( smb nmb )
  if [[ $OS_FAMILY == debian ]]; then svcs=( smbd nmbd ); fi

  for svc in "${svcs[@]}"; do
    systemctl enable --now "$svc" \
      || echo "[WARN] Could not enable/start $svc"
  done
}

# ────────────────────────────────────────────────────────────────────
# Run everything
# ────────────────────────────────────────────────────────────────────
add_45drives_repos
install_nodejs_18
install_cockpit
install_cockpit_module
install_zfs
install_samba

echo "[INFO] All done! 🎉"
echo "Access Cockpit at: https://$(hostname -I | awk '{print $1}'):9090"
