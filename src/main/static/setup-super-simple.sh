#!/bin/bash
set -euo pipefail

# 🔐 Self-elevate if not root
if [ "$EUID" -ne 0 ]; then
  echo "[INFO] Re-running script with sudo…"
  exec sudo "$0" "$@"
fi

# ────────────────────────────────────────────────────────────────────
# 1) Detect OS
# ────────────────────────────────────────────────────────────────────
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_ID=$ID
else
  echo "[ERROR] Cannot detect OS (missing /etc/os-release)"
  exit 1
fi
echo "[INFO] Detected OS: $OS_ID"

# Classify package manager & service names
if [[ "$OS_ID" =~ ^(rocky|rhel|centos|almalinux|fedora)$ ]]; then
  PKG="dnf"
  COCKPIT_SVC="cockpit.socket"
  ZFS_PKGS="kernel-devel dkms zfs"
  REPO_RPM_URL="https://zfsonlinux.org/epel/zfs-release-$(rpm -E '%{rhel}').noarch.rpm"
  ZFS_SVCS=(zfs-import-cache zfs-import-scan zfs-mount zfs-zed)
  SMB_PKGS="samba"
  SMB_SVCS=(smb nmb)
  FIREWALL_CMD="firewall-cmd"
elif [[ "$OS_ID" =~ ^(debian|ubuntu)$ ]]; then
  PKG="apt"
  COCKPIT_SVC="cockpit.socket"
  ZFS_PKGS="zfsutils-linux zfs-dkms"
  ZFS_SVCS=(zfs-import-cache zfs-import-scan zfs-mount zfs-zed)
  SMB_PKGS="samba"
  SMB_SVCS=(smbd nmbd)
else
  echo "[ERROR] Unsupported OS: $OS_ID"
  exit 1
fi

# ────────────────────────────────────────────────────────────────────
# 2) 45Drives repo setup (idempotent)
# ────────────────────────────────────────────────────────────────────
add_45drives_repos() {
  if ! grep -q "repo.45drives.com" /etc/yum.repos.d/* 2>/dev/null && ! grep -q "repo.45drives.com" /etc/apt/sources.list* 2>/dev/null; then
    echo "[INFO] Adding 45Drives package repository…"
    if curl -sSL https://repo.45drives.com/setup | bash; then
      echo "[INFO] 45Drives repo configured."
    else
      echo "[WARN] Failed to add 45Drives repo, but continuing..."
    fi
  else
    echo "[INFO] 45Drives repo already present."
  fi
}

# ────────────────────────────────────────────────────────────────────
# 3) Install Node.js 18
# ────────────────────────────────────────────────────────────────────
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

# ────────────────────────────────────────────────────────────────────
# 4) Install & enable Cockpit + super-simple-setup
# ────────────────────────────────────────────────────────────────────
install_cockpit() {
  if ! rpm -q cockpit &>/dev/null && ! dpkg -l | grep -qw cockpit; then
    echo "[INFO] Installing Cockpit…"
    if [[ "$PKG" == "dnf" ]]; then
      dnf install -y cockpit
    else
      apt update -y
      apt install -y cockpit
    fi
  else
    echo "[INFO] Cockpit package already installed."
  fi

  if ! systemctl is-enabled --quiet "$COCKPIT_SVC"; then
    echo "[INFO] Enabling & starting $COCKPIT_SVC…"
    systemctl enable --now "$COCKPIT_SVC" || echo "[WARN] Could not enable/start $COCKPIT_SVC"
  else
    echo "[INFO] $COCKPIT_SVC already enabled."
  fi

  if [[ "$PKG" == "dnf" && -x "$(command -v $FIREWALL_CMD)" ]]; then
    if ! $FIREWALL_CMD --list-services --permanent | grep -qw cockpit; then
      echo "[INFO] Opening firewall for Cockpit…"
      $FIREWALL_CMD --add-service=cockpit --permanent || true
      $FIREWALL_CMD --reload || true
    else
      echo "[INFO] Cockpit firewall rule already present."
    fi
  fi
}

install_cockpit_module() {
  if ! rpm -q cockpit-super-simple-setup &>/dev/null && ! dpkg -l | grep -qw cockpit-super-simple-setup; then
    echo "[INFO] Installing cockpit-super-simple-setup…"
    if [[ "$PKG" == "dnf" ]]; then
      dnf install -y cockpit-super-simple-setup || echo "[WARN] Failed to install cockpit-super-simple-setup"
    else
      apt install -y cockpit-super-simple-setup || echo "[WARN] Failed to install cockpit-super-simple-setup"
    fi
  else
    echo "[INFO] cockpit-super-simple-setup already installed."
  fi
}

# ────────────────────────────────────────────────────────────────────
# 5) Install & enable ZFS
# ────────────────────────────────────────────────────────────────────
install_zfs() {
  if ! command -v zfs >/dev/null; then
    echo "[INFO] Installing ZFS…"
    if [[ "$PKG" == "dnf" ]]; then
      if ! dnf install -y "$REPO_RPM_URL"; then
        echo "[WARN] Could not fetch ZFS-release RPM, skipping repo setup"
      fi
      dnf install -y $ZFS_PKGS || { echo "[ERROR] Could not install ZFS packages"; return 1; }
    else
      apt update -y
      apt install -y $ZFS_PKGS || { echo "[ERROR] Could not install ZFS packages"; return 1; }
    fi

    echo "zfs" > /etc/modules-load.d/zfs.conf || true
    modprobe zfs || echo "[WARN] modprobe zfs failed"
  else
    echo "[INFO] ZFS already installed: $(zfs --version | head -1)"
  fi

  for svc in "${ZFS_SVCS[@]}"; do
    if ! systemctl is-enabled --quiet "$svc"; then
      echo "[INFO] Enabling & starting ZFS service: $svc"
      systemctl enable --now "$svc" || echo "[WARN] Could not enable/start $svc"
    else
      echo "[INFO] ZFS service $svc already enabled."
    fi
  done
}

# ────────────────────────────────────────────────────────────────────
# 6) Install & enable Samba
# ────────────────────────────────────────────────────────────────────
install_samba() {
  if ! rpm -q samba &>/dev/null && ! dpkg -l | grep -qw samba; then
    echo "[INFO] Installing Samba…"
    if [[ "$PKG" == "dnf" ]]; then
      dnf install -y $SMB_PKGS || echo "[WARN] Samba install failed"
    else
      apt update -y
      apt install -y $SMB_PKGS || echo "[WARN] Samba install failed"
    fi
  else
    echo "[INFO] Samba package already installed."
  fi

  for svc in "${SMB_SVCS[@]}"; do
    if ! systemctl is-enabled --quiet "$svc"; then
      echo "[INFO] Enabling & starting SMB service: $svc"
      systemctl enable --now "$svc" || echo "[WARN] Could not enable/start $svc"
    else
      echo "[INFO] SMB service $svc already enabled."
    fi
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

echo "[INFO] All done!  🎉"
echo "Access Cockpit at: https://$(hostname -I | awk '{print $1}'):9090"
