#!/usr/bin/env bash
# setup-super-simple.sh  (smart, resilient version)
# ────────────────────────────────────────────────────────────────────
# Installs: 45Drives repo • Node.js18 • Cockpit(+module) • Samba • ZFS
# Adds sanity-checks first, so repeated runs are safe (idempotent).
# ────────────────────────────────────────────────────────────────────
set -euo pipefail

# ───────────────────────── Self-elevate ────────────────────────────
[[ $EUID -ne 0 ]] && { echo "[INFO] Re-running with sudo…"; exec sudo "$0" "$@"; }

# ───────────────────────── Detect distro ───────────────────────────
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  case $ID in
    rocky|rhel|centos|almalinux|fedora)
      OS_FAMILY=rhel
      PKG_INSTALL="dnf install -y"
      PKG_QUERY="rpm -q"
      FIREWALL_CMD=firewall-cmd
      ;;
    debian|ubuntu)
      OS_FAMILY=debian
      PKG_INSTALL="apt -y update && apt -y install"
      PKG_QUERY="dpkg -s"
      ;;
    *) echo "[ERROR] Unsupported OS $ID"; exit 1 ;;
  esac
else
  echo "[ERROR] /etc/os-release missing"; exit 1
fi
echo "[INFO] Detected OS family: $OS_FAMILY"

# ─────────────────── Helper: install only if missing ───────────────
install_pkg() { $PKG_QUERY "$1" &>/dev/null && { echo "[INFO] $1 already present"; } || eval "$PKG_INSTALL $1"; }

ensure_kernel_headers() {
  local running=$(uname -r)
  [[ $OS_FAMILY == rhel ]] || { install_pkg "linux-headers-$(uname -r)"; return; }

  dnf install -y "kernel-devel-$running" "kernel-headers-$running" || true
  [[ -d /usr/src/kernels/$running ]] && return

  echo "[WARN] Exact headers for $running not in repos – installing latest kernel/headers"
  dnf install -y kernel kernel-devel kernel-headers
  touch /run/reboot_required
}

fetch_zfs_repo_rpm() {
  local new="https://zfsonlinux.org/epel/zfs-release-2-3$(rpm --eval '%{dist}').noarch.rpm"
  local old="https://zfsonlinux.org/epel/zfs-release-$(rpm -E '%{rhel}').noarch.rpm"
  echo "[INFO] Fetching ZFS repo RPM…"
  if ! dnf install -y "$new" 2>&1 | tee /tmp/zfsrepo.log | grep -Eq '^Error.*404'; then
    return
  fi
  echo "[WARN] $new returned 404 – falling back to legacy URL"
  dnf install -y "$old"
}

preflight() {
  echo "┌────────────── PRE-FLIGHT ──────────────"
  printf "Kernel          : %s\n" "$(uname -r)"
  $PKG_QUERY kernel-devel &>/dev/null \
    && printf "kernel-devel    : %s\n" "$(rpm -q kernel-devel | tail -1)" \
    || echo  "kernel-devel    : NOT installed"
  command -v zfs >/dev/null && echo "ZFS binary      : present" || echo "ZFS binary      : missing"
  echo "└─────────────────────────────────────────"
}
preflight

# ───────────────── 1) 45Drives repo ────────────────────────────────
add_45drives_repo() {
  grep -Rqs repo.45drives.com /etc/yum.repos.d /etc/apt || {
    echo "[INFO] Enabling 45Drives repo…"
    curl -fsSL https://repo.45drives.com/setup | bash
  }
}
add_45drives_repo

# ───────────────── 2) Node.js 18 LTS ───────────────────────────────
install_nodejs18() {
  local v=${1:-18}
  local current=0
  command -v node &>/dev/null && current=$(node -v | cut -d. -f1 | tr -d v)
  [[ $current -ge $v ]] && { echo "[INFO] Node.js >=$v already"; return; }

  echo "[INFO] Installing Node.js $v…"
  if [[ $OS_FAMILY == rhel ]]; then
    curl -fsSL https://rpm.nodesource.com/setup_${v}.x | bash -
    dnf install -y nodejs
  else
    curl -fsSL https://deb.nodesource.com/setup_${v}.x | bash -
    apt -y update && apt -y install nodejs
  fi
}
install_nodejs18 18

# ───────────────── 3) Cockpit & module ─────────────────────────────
install_cockpit() {
  install_pkg cockpit
  systemctl enable --now cockpit.socket || true
  if [[ $OS_FAMILY == rhel && -x $(command -v $FIREWALL_CMD) ]]; then
    systemctl is-active --quiet firewalld && \
      $FIREWALL_CMD --quiet --permanent --add-service=cockpit && $FIREWALL_CMD --reload || true
  fi
}
install_cockpit
install_pkg cockpit-super-simple-setup

# ───────────────── 4) Samba ────────────────────────────────────────
install_samba() {
  install_pkg samba
  local svcs=(smb nmb); [[ $OS_FAMILY == debian ]] && svcs=(smbd nmbd)
  systemctl enable --now "${svcs[@]}" || true
}
install_samba

# ───────────────── 5) ZFS (+reboot logic) ──────────────────────────
install_zfs() {
  ensure_kernel_headers
  [[ $OS_FAMILY == rhel ]] && fetch_zfs_repo_rpm
  install_pkg zfs         # userland + DKMS

  echo zfs > /etc/modules-load.d/zfs.conf
  dkms autoinstall || true
  modprobe zfs 2>/dev/null || touch /run/reboot_required

  if ! zfs version &>/dev/null; then
    echo "[WARN] ZFS still not usable – rebooting"
    touch /run/reboot_required
  fi

  if [[ -f /run/reboot_required ]]; then
    echo "[INFO] Reboot required for kernel/ZFS; rebooting in 5 s"
    sleep 5
    echo "[REBOOT REQUIRED]"
    reboot
  fi

  echo "[INFO] ZFS ready: $(zfs version | head -1)"
  systemctl enable --now zfs-import-cache zfs-import-scan zfs-mount zfs-zed || true
}
install_zfs

echo "[INFO] Setup complete! Access Cockpit at: https://$(hostname -I | awk '{print $1}'):9090"
