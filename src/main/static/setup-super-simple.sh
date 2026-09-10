#!/usr/bin/env bash
# setup-super-simple.sh
# --------------------------------------------------------------------
# Configures the 45Drives repo and installs the top-level 45Drives packages.
# Everything else (cockpit, samba, zfs, houston-broadcaster, cockpit-scheduler,
# node, avahi, ...) is pulled in by those packages' own dependencies.
# --------------------------------------------------------------------

set -eo pipefail

# ----- stdout/stderr go to both console and log, line-buffered -----
# tee dies silently and takes the script's output with it if the dir is missing.
mkdir -p /var/log/45drives
LOG=/var/log/45drives/bootstrap-super-simple-$(date +%F_%H%M).log
exec > >(stdbuf -oL -eL tee -a "$LOG") 2>&1

echo "[BOOTSTRAP_STARTED] $(date)"

if [[ $EUID -ne 0 ]]; then
  echo "[ERROR] This script must be run as root (or with passwordless sudo)."
  echo "[ERROR] Please use the root account in the Storage Wizard, or configure sudoers accordingly."
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
      # --refresh: an already-configured repo otherwise resolves against cached metadata.
      dnf install -y --refresh "$@"
    }
    # ZFS builds through DKMS, which needs headers for the running kernel. Best
    # effort: an exact-version kernel-devel is often missing from the repo.
    install_kernel_devel() {
      dnf install -y dkms "kernel-devel-$(uname -r)" "kernel-headers-$(uname -r)" \
        || echo "[WARN] Could not install dkms/kernel headers for $(uname -r); ZFS may need a reboot onto a matching kernel."
    }
    open_firewall_ports() {
      if command -v firewall-cmd >/dev/null 2>&1; then
        echo "[INFO] Opening ports for Cockpit (9090/TCP), Houston Broadcaster (9095/TCP) and mDNS (5353/UDP)…"

        # Cockpit (9090) and mDNS via services
        firewall-cmd --quiet --permanent --add-service=cockpit || true
        firewall-cmd --quiet --permanent --add-service=mdns || true

        # Houston broadcaster on 9095/tcp
        firewall-cmd --quiet --permanent --add-port=9095/tcp || true

        firewall-cmd --reload || true
      else
        echo "[WARN] firewalld not found; skipping Cockpit/mDNS/Houston firewall configuration."
      fi
    }
    # A repofile saved from a 404/redirect body makes dnf reject every later command.
    sanitize_45d_repo() {
      local f=/etc/yum.repos.d/45drives-community.repo
      if [[ -f "$f" ]] && ! grep -q '^\[' "$f"; then
        echo "[WARN] Removing malformed 45Drives repo file: $f"
        rm -f "$f"
      fi
    }
    setup_45d_repo() {
      if [[ -f "/etc/yum.repos.d/45drives.repo" ]]; then
        echo "45Drives repo found. Archiving..."
        mkdir -p /opt/45drives/archives/repos
        mv /etc/yum.repos.d/45drives.repo "/opt/45drives/archives/repos/45drives-$(date +%Y-%m-%d).repo"
        echo "The obsolete repos have been archived to '/opt/45drives/archives/repos'. Setting up the new repo..."
      fi
      local url=https://repo.45drives.com/repofiles/rocky/45drives-community.repo
      local tmp
      tmp="$(mktemp)"
      if ! curl -fsSL "$url" -o "$tmp"; then
        rm -f "$tmp"
        echo "[ERROR] Could not download $url" >&2
        return 1
      fi
      if ! grep -q '^\[' "$tmp"; then
        rm -f "$tmp"
        echo "[ERROR] $url did not return a valid yum repo file." >&2
        return 1
      fi
      mv "$tmp" /etc/yum.repos.d/45drives-community.repo
      chmod 644 /etc/yum.repos.d/45drives-community.repo
      dnf clean all
    }
    # dkms ships in EPEL on RHEL-likes, and some of its deps come from CRB/PowerTools.
    ensure_extra_repos() {
      local major="${VERSION_ID:-8}"
      major="${major%%.*}"
      dnf -y install dnf-plugins-core || true
      if ! rpm -q epel-release >/dev/null 2>&1; then
        echo "[INFO] Enabling EPEL..."
        dnf -y install epel-release \
          || dnf -y install "https://dl.fedoraproject.org/pub/epel/epel-release-latest-${major}.noarch.rpm" \
          || echo "[WARN] Could not enable EPEL; dkms may be unavailable."
      else
        echo "[INFO] EPEL already enabled."
      fi
      dnf -y config-manager --set-enabled crb 2>/dev/null \
        || dnf -y config-manager --set-enabled powertools 2>/dev/null \
        || true
    }
    OUR_REQUIRED_PACKAGES=(cockpit-super-simple-setup cockpit-zfs wireshield)
    REQUIRED_SERVICES=(cockpit.socket smb nmb)
    ;;

  *debian*|*ubuntu*)
    export DEBIAN_FRONTEND=noninteractive
    install_pkg() {
      echo "[INFO] Installing: $*"
      # DPkg::Lock::Timeout: unattended-upgrades routinely holds the lock on a
      # fresh install, which otherwise looks like a frozen setup.
      apt install -y -o DPkg::Lock::Timeout=600 "$@"
    }
    install_kernel_devel() {
      apt install -y -o DPkg::Lock::Timeout=600 dkms "linux-headers-$(uname -r)" \
        || echo "[WARN] Could not install dkms/linux-headers for $(uname -r); ZFS may need a reboot onto a matching kernel."
    }
    open_firewall_ports() {
      if command -v ufw >/dev/null 2>&1; then
        echo "[INFO] Opening ports for Cockpit (9090/TCP), Houston Broadcaster (9095/TCP) and mDNS (5353/UDP)…"

        ufw allow 9090/tcp || true          # Cockpit
        ufw allow 9095/tcp || true          # Houston broadcaster
        ufw allow mdns || ufw allow 5353/udp || true  # mDNS

        ufw reload || true
      else
        echo "[WARN] ufw not found; skipping Cockpit/mDNS/Houston firewall configuration."
      fi
    }
    # A .list saved from a 404/redirect body makes apt reject every later command.
    sanitize_45d_repo() {
      local f
      for f in /etc/apt/sources.list.d/45drives-community*.list; do
        [[ -e "$f" ]] || continue
        if ! grep -qE '^(deb |deb-src |Types:)' "$f"; then
          echo "[WARN] Removing malformed 45Drives repo file: $f"
          rm -f "$f"
        fi
      done
    }
    setup_45d_repo() {
      local codename="${VERSION_CODENAME:-}"
      if [[ -z "$codename" ]]; then
        echo "[ERROR] Could not determine the APT distro codename from /etc/os-release." >&2
        return 1
      fi
      apt update -y || true
      apt install -y ca-certificates gnupg curl wget
      wget -qO - https://repo.45drives.com/key/gpg.asc | gpg --pinentry-mode loopback --batch --yes --dearmor -o /usr/share/keyrings/45drives-archive-keyring.gpg
      # 45Drives ships a .list helper for the enterprise repo only, so build the community one here.
      local url="https://repo.45drives.com/community/${ID}"
      if ! curl -fsI "${url}/dists/${codename}/Release" >/dev/null; then
        echo "[ERROR] No 45Drives community repo published for ${ID} ${codename}." >&2
        return 1
      fi
      local list="/etc/apt/sources.list.d/45drives-community-${codename}.list"
      printf 'deb [arch=amd64 signed-by=/usr/share/keyrings/45drives-archive-keyring.gpg] %s %s main\n' \
        "$url" "$codename" > "$list"
      chmod 644 "$list"
      apt update -y
    }
    ensure_extra_repos() { :; }
    OUR_REQUIRED_PACKAGES=(cockpit-super-simple-setup cockpit-zfs wireshield)
    REQUIRED_SERVICES=(cockpit.socket smbd nmbd)
    ;;

  *)
    echo "[ERROR] Unsupported OS: ID=${ID:-unknown} ID_LIKE=${ID_LIKE:-'(unset)'}"
    exit 1
    ;;
esac

set -u

# A held package-manager lock is the usual cause of a setup that appears frozen.
for lock in /var/lib/dpkg/lock-frontend /var/run/dnf.pid /var/run/yum.pid; do
  if [[ -e "$lock" ]] && command -v fuser >/dev/null 2>&1 && fuser "$lock" >/dev/null 2>&1; then
    echo "[WARN] Another package manager is running (holding $lock) — waiting for it to finish."
  fi
done

# dnf/apt only discover this after downloading everything, so check up front.
REQUIRED_FREE_MB=2048
avail_mb="$(df -Pm / | awk 'NR==2 {print $4}')"
if [[ -n "$avail_mb" && "$avail_mb" -lt "$REQUIRED_FREE_MB" ]]; then
  echo "[ERROR] Only ${avail_mb}MB free on / — at least ${REQUIRED_FREE_MB}MB is required to install the 45Drives packages."
  echo "[ERROR] Free up space on / and run setup again."
  exit 1
fi

# Must run before any install: a broken repofile left by an earlier run makes
# every apt/dnf command fail, including the ones below.
sanitize_45d_repo
ensure_extra_repos
if ! setup_45d_repo; then
  echo "[ERROR] Failed to set up 45Drives repo!" >&2
  exit 1
fi

install_kernel_devel

# Everything else arrives as a dependency of these three.
install_pkg "${OUR_REQUIRED_PACKAGES[@]}"

# zfs setup
if [[ ! -f /etc/modules-load.d/zfs.conf ]]; then
  echo "zfs" > /etc/modules-load.d/zfs.conf
fi
modprobe zfs || echo "[WARN] Could not load the ZFS module; a reboot may be required."

open_firewall_ports

for svc in "${REQUIRED_SERVICES[@]}"; do
  systemctl enable --now "$svc" || echo "[WARN] Could not enable $svc."
done

# restarting cockpit socket required to load newly installed modules
systemctl restart cockpit.socket

echo "[INFO] Setup complete! Access Cockpit at: https://$(hostname -I | awk '{print $1}'):9090"
echo "[BOOTSTRAP_DONE]"
