#!/usr/bin/env bash

set -euo pipefail

LOG=/var/log/factory-reset-$(date +%F_%H%M).log
exec > >(stdbuf -oL -eL tee -a "$LOG") 2>&1

[[ $EUID -ne 0 ]] && { echo "Re-running as root..."; exec sudo "$0" "$@"; }

echo "[FACTORY_RESET_STARTED] $(date)"

# Whitelisted users to keep
KEEP_USERS=("root" "45drives")

echo "[INFO] Destroying all non-root ZFS pools..."

# Identify the root filesystem and type
ROOT_FS=$(df / | awk 'NR==2 {print $1}')
ROOT_FS_TYPE=$(df -T / | awk 'NR==2 {print $2}')
echo "[DEBUG] ROOT_FS: $ROOT_FS, ROOT_FS_TYPE: $ROOT_FS_TYPE"

# If the root filesystem is ZFS, extract the root pool
if [[ "$ROOT_FS_TYPE" == "zfs" ]]; then
  ROOT_POOL=$ROOT_FS
else
  ROOT_POOL=""
fi
echo "[DEBUG] ROOT_POOL: $ROOT_POOL"

# Check if there are any pools before proceeding
pools=$(zpool list -H -o name || true)  # Avoid error if no pools exist
if [ -z "$pools" ]; then
  echo "[INFO] No ZFS pools found. Skipping pool destruction."
else
  echo "[INFO] Found ZFS pools: $pools"
  for pool in $pools; do
    if [[ "$pool" != "$ROOT_POOL" ]]; then
      echo "[INFO] Destroying pool: $pool"
      zpool destroy -f "$pool" || echo "[ERROR] Failed to destroy $pool, continuing..."
    else
      echo "[INFO] Skipping root pool: $pool"
    fi
  done
fi

echo "[INFO] Removing Samba configuration and shares..."
systemctl stop smb nmb || true
rm -f /etc/samba/smb.conf || true
rm -rf /etc/samba/houston-credentials/ || true
rm -rf /var/lib/samba || true
rm -rf /var/cache/samba || true
rm -rf /var/log/samba || true

echo "[INFO] Deleting all non-whitelisted user accounts..."
getent passwd | while IFS=: read -r user _ uid _ _ home shell; do
  if (( uid >= 1000 )) && [[ ! " ${KEEP_USERS[*]} " =~ " $user " ]]; then
    echo "Deleting user: $user"
    userdel -rf "$user" || echo "Failed to delete user $user"
  fi
done

echo "[INFO] Enabling SSH root login..."
SSH_CONF=/etc/ssh/sshd_config
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' "$SSH_CONF" || echo "[ERROR] Failed to enable root login"
systemctl reload sshd || echo "[ERROR] Failed to reload SSH service"

echo "[INFO] Removing all Houston Scheduler services and timers..."

SCHEDULER_DIR="/etc/systemd/system"
SCHEDULER_PREFIX="houston_scheduler_"

# Find and disable all matching services and timers
find "$SCHEDULER_DIR" -maxdepth 1 -type f -name "${SCHEDULER_PREFIX}*.timer" -o -name "${SCHEDULER_PREFIX}*.service" | while read -r unit; do
  echo "Disabling and stopping: $(basename "$unit")"
  systemctl disable --now "$(basename "$unit")" || echo "[ERROR] Failed to disable $unit, continuing..."
done

# Delete all Houston Scheduler files
find "$SCHEDULER_DIR" -maxdepth 1 -type f -name "${SCHEDULER_PREFIX}*" -exec rm -f {} \; || echo "[ERROR] Failed to remove Houston Scheduler files, continuing..."

# Reload systemd to forget removed units
systemctl daemon-reload || echo "[ERROR] Failed to reload systemd"
echo "[INFO] Houston Scheduler tasks removed."

echo "[INFO] Optionally disabling Cockpit and uninstalling all related packages and services..."
read -rp "Do you want to disable Cockpit and uninstall all related packages and services? [y/N]: " disable_all
if [[ "$disable_all" =~ ^[Yy]$ ]]; then
  echo "[INFO] Disabling systemd services..."
  systemctl disable --now \
    cockpit.socket \
    smbd nmbd \
    zfs-import-cache zfs-import-scan zfs-mount zfs-zed \
    houston-broadcaster.service || true

  echo "[INFO] Removing houston-broadcaster systemd unit..."
  rm -f /etc/systemd/system/houston-broadcaster.service || true
  systemctl daemon-reload || echo "[ERROR] Failed to reload systemd"

  echo "[INFO] Removing 45Drives and dependency packages..."
  case "$(source /etc/os-release; echo "$ID_LIKE")" in
    *rhel*)
      dnf remove -y \
        cockpit-super-simple-setup \
        cockpit-zfs \
        cockpit-scheduler \
        cockpit \
        samba \
        zfs || echo "[ERROR] Failed to remove some packages, continuing..."
      ;;
    *debian*)
      apt purge -y \
        cockpit-super-simple-setup \
        cockpit-zfs \
        cockpit-scheduler \
        cockpit \
        samba \
        zfs-dkms zfsutils || echo "[ERROR] Failed to remove some packages, continuing..."
      apt autoremove -y || echo "[ERROR] Failed to autoremove packages"
      ;;
  esac

  echo "[INFO] Removing 45Drives repo files..."
  rm -f /etc/yum.repos.d/45drives*.repo /etc/apt/sources.list.d/45drives*.list || echo "[ERROR] Failed to remove repo files"
fi

# Reset firewall ports
case "$(source /etc/os-release; echo "$ID_LIKE")" in
  *rhel*)
    echo "[INFO] Resetting firewalld rules..."
    systemctl stop firewalld || echo "[ERROR] Failed to stop firewalld"
    rm -rf /etc/firewalld || echo "[ERROR] Failed to remove firewalld config"
    systemctl start firewalld || echo "[ERROR] Failed to start firewalld"
    ;;
  *debian*)
    echo "[INFO] Resetting UFW firewall rules..."
    ufw --force reset || echo "[ERROR] Failed to reset UFW rules"
    ufw disable || echo "[ERROR] Failed to disable UFW"
    ;;
esac

echo "[INFO] Factory reset complete."

# Reboot prompt
read -rp "Would you like to reboot now? [y/N]: " do_reboot
if [[ "$do_reboot" =~ ^[Yy]$ ]]; then
  echo "[INFO] Rebooting..."
  reboot || echo "[ERROR] Failed to reboot"
else
  echo "[INFO] Reboot skipped. You may reboot manually later."
fi
