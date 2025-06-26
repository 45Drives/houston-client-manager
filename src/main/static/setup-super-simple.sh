#!/usr/bin/env bash
# setup-super-simple.sh  (smart, resilient version)
# ────────────────────────────────────────────────────────────────────
# Installs: 45Drives repo • Node.js18 • Cockpit(+module) • Samba • ZFS
# Adds sanity-checks first, so repeated runs are safe (idempotent).
# ────────────────────────────────────────────────────────────────────
set -euo pipefail

# ───── stdout/stderr go to both console and log, line-buffered ─────
LOG=/var/log/setup-super-simple-$(date +%F_%H%M).log
exec > >(stdbuf -oL -eL tee -a "$LOG") 2>&1

# ───── tell the caller we are alive as soon as possible ────────────
echo "[BOOTSTRAP_STARTED] $(date)"

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
    dnf clean all -y && dnf makecache -y
    return
  fi
  echo "[WARN] $new returned 404 – falling back to legacy URL"
  dnf install -y "$old"
  dnf clean all -y && dnf makecache -y
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
  # Common helpers
  local today ts
  today=$(date +%Y-%m-%d)
  ts=$(date +%s)

  if [[ $OS_FAMILY == rhel ]]; then
    echo "[INFO] Checking 45Drives repo for RHEL/Rocky/CentOS…"
    if [[ ! -e /etc/yum.repos.d/45drives-enterprise.repo ]]; then
      echo "[INFO] No existing 45Drives repo file – installing new one."
    else
      echo "[INFO] Existing 45Drives repo found – archiving to /opt/45drives/archives/repos."
      mkdir -p /opt/45drives/archives/repos
      mv /etc/yum.repos.d/45drives*.repo /opt/45drives/archives/repos/45drives-"${today}"-"${ts}".repo
    fi

    curl -fsSL https://repo.45drives.com/repofiles/rocky/45drives-enterprise.repo \
         -o /etc/yum.repos.d/45drives-enterprise.repo

    echo "[INFO] Cleaning yum/dnf metadata…"
    (command -v dnf &>/dev/null && dnf clean all -y) || yum clean all -y
    echo "[INFO] 45Drives repo ready."
    return
  fi

  if [[ $OS_FAMILY == debian ]]; then
    local CODENAME
    CODENAME=$(grep -oP '^VERSION_CODENAME=\K.+' /etc/os-release || true)
    echo "[INFO] Checking 45Drives repo for Debian/Ubuntu (${CODENAME:-unknown})…"

    if [[ ! -f /etc/apt/sources.list.d/45drives-enterprise-${CODENAME}.list ]]; then
      echo "[INFO] No existing 45Drives repo file – installing new one."
    else
      echo "[INFO] Existing 45Drives repo found – archiving to /opt/45drives/archives/repos."
      mkdir -p /opt/45drives/archives/repos
      mv /etc/apt/sources.list.d/45drives*.list \
         /opt/45drives/archives/repos/45drives-"${today}"-"${ts}".list
    fi

    echo "[INFO] Ensuring CA certs and gnupg are present…"
    apt -y update
    apt -y install ca-certificates gnupg

    echo "[INFO] Installing 45Drives GPG key…"
    wget -qO - https://repo.45drives.com/key/gpg.asc \
      | gpg --batch --yes --dearmor \
      -o /usr/share/keyrings/45drives-archive-keyring.gpg

    echo "[INFO] Installing repo file…"
    curl -fsSL https://repo.45drives.com/repofiles/"${ID}"/45drives-enterprise-"${CODENAME}".list \
         -o /etc/apt/sources.list.d/45drives-enterprise-"${CODENAME}".list

    echo "[INFO] Updating APT metadata…"
    apt -y update
    echo "[INFO] 45Drives repo ready."
    return
  fi

  echo "[WARN] 45Drives repo: unsupported distribution – skipped."
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
    dnf clean all -y && dnf makecache -y
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
  if [[ $OS_FAMILY == rhel && -x $(command -v "$FIREWALL_CMD") ]]; then
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

  dkms autoinstall 2>&1 \
  | grep -vE 'Deprecated feature: (REMAKE_INITRD|MODULES_CONF_ALIAS_TYPE)' \
  || true 

  modprobe zfs 2>/dev/null || touch /run/reboot_required

  if ! zfs version &>/dev/null; then
    echo "[WARN] ZFS still not usable – rebooting"
    touch /run/reboot_required
  fi

  if [[ -f /run/reboot_required ]]; then
    echo "[REBOOT_NEEDED]"
    sleep 5
    reboot
  fi

  echo "[INFO] ZFS ready: $(zfs version | head -1)"
  systemctl enable --now zfs-import-cache zfs-import-scan zfs-mount zfs-zed || true
}
install_zfs

echo "[INFO] Setup complete! Access Cockpit at: https://$(hostname -I | awk '{print $1}'):9090"
echo "[BOOTSTRAP_DONE]"
