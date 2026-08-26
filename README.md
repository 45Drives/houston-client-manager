# 45Drives Storage Wizard

The 45Drives Storage Wizard is a desktop application that connects your computer to one or more 45Drives servers to configure storage, schedule backups, replicate data to another site or the cloud, and restore files — without touching a command line.

> **Full documentation:** [45Drives Storage Wizard User Guide](docs/45Drives_Storage_Wizard_User_Guide.md)

---

## What It Does

| Area | Capability |
|---|---|
| **Server setup** | Discovers 45Drives servers on the network, installs the server components over SSH, and runs the Super Simple Setup wizard (Simple or Custom path) inline in the app. |
| **Bulk setup** | Configure and deploy many servers at once from shared global defaults, with importable/exportable templates and optional parallel execution. |
| **Local backups** | Schedule folders on *this computer* to back up to an SMB share on your server. |
| **Remote backups** | Server-side scheduled tasks — Rsync file sync, ZFS incremental replication, and cloud sync — that run whether or not your computer is on. |
| **Cloud accounts** | Saved credentials for Dropbox, Google Drive, Google Cloud, Azure Blob, Backblaze B2, Amazon S3, Wasabi, Ceph, IDrive e2, and Storj. OAuth providers link with a browser sign-in. |
| **Off-site backups** | Pair two servers over an encrypted WireGuard tunnel with a 6-character code, then point any backup task at the tunnel IP. |
| **Restore** | Browse local backups, remote backup targets, cloud destinations, and ZFS snapshots, then restore to the server or download to this computer. |
| **Snapshots** | Browse, roll back, and delete ZFS snapshots, including the automatic hourly/daily/weekly snapshots created by Split Pools. |
| **Dashboard** | Saved servers, storage and system health, scheduled/failed task counts, recent activity, upcoming backups, and a live topology map of your backup network. |
| **Credential vault** | Saved server logins stored securely on this device, with active/stale/orphaned tracking. |
| **Automatic updates** | The app checks for a new release shortly after startup, downloads it in the background, and installs it on quit. |

---

## How the Pieces Fit Together

The desktop app is the front door. It installs and embeds three Cockpit modules that run on the server itself:

| Component | Runs on | Handles |
|---|---|---|
| **Storage Wizard** (this repo) | Your computer | Discovery, installation, local backups, dashboard, credential vault |
| **Super Simple Setup** | The server | ZFS pools, datasets, users, groups, Samba shares |
| **Task Scheduler** | The server | Remote backup tasks, snapshots, restore, cloud sync |
| **WireShield** | The server | Encrypted WireGuard tunnels to servers at other sites |

You never install or open these separately — the app deploys them over SSH during setup and presents them inline.

---

## Installation

Download the installer for your platform from the release page.

### Windows

1. Download `45Drives-Storage-Wizard-<version>-win-x64.exe`.
2. Run it and follow the prompts. The installer is per-user, so no administrator password is needed to install, and you can change the install location.
3. Launch from the Start Menu or the **45Drives Storage Wizard** desktop shortcut.

The app runs with standard user permissions and requests elevation (UAC) only when creating scheduled tasks, mounting SMB shares, or accessing protected directories.

### macOS

1. Download `45Drives-Storage-Wizard-<version>-mac-arm64.dmg` (Apple Silicon) or `-mac-x64.dmg` (Intel).
2. Open the `.dmg` and drag **45Drives Storage Wizard** into **Applications**.
3. Launch from Launchpad or Applications. On the first run macOS may ask you to confirm — click **Open**.

If you plan to create **local backups**, grant `cron` Full Disk Access:

1. **System Settings → Privacy & Security → Full Disk Access**
2. Click **+**, navigate to `/usr/sbin/cron`, and click **Open**
3. Toggle it on, then restart the app.

### Linux

| Distribution | File | Install command |
|---|---|---|
| Ubuntu / Debian | `45Drives-Storage-Wizard-<version>-linux-amd64.deb` | `sudo apt install ./45Drives-Storage-Wizard-<version>-linux-amd64.deb` |
| Rocky / RHEL / AlmaLinux / Fedora | `45Drives-Storage-Wizard-<version>-linux-x86_64.rpm` | `sudo dnf install ./45Drives-Storage-Wizard-<version>-linux-x86_64.rpm` |
| Arch / Manjaro | `45Drives-Storage-Wizard-<version>-linux-x64.pacman` | `sudo pacman -U ./45Drives-Storage-Wizard-<version>-linux-x64.pacman` |

The `.deb` and `.rpm` files can also be opened directly in GNOME Software or KDE Discover. Once installed, launch from your desktop application menu or run `45drives-setup-wizard` in a terminal.

Root privileges are requested only when required — creating an `fstab` entry for an SMB mount, installing a `cron` job for scheduled backups, or reading a protected folder. Subsequent tasks for the same server usually will not re-prompt.

---

## Quick Start

1. Rack, cable, and power on the server.
2. Open the app and run the **Setup Wizard**. Pick your server from the discovery list — or enter its IP manually if mDNS is blocked on your network — and sign in as `root`. The app installs the server components over SSH.
3. Choose **Simple** setup, name the server and its network folder, review the drive summary, and click **Complete Setup**. Enable **Split Pools** if you want an on-box replicated backup pool with automatic snapshots.
4. Open the **Backup Manager**:
   - **Local Backups** — pick folders on this computer and a schedule. Runs from this computer, so it needs to be powered on.
   - **Remote Backups** — connect to the server and create server-side tasks (Rsync, ZFS replication, or cloud sync). Runs on the server, independently of this computer.
5. For an off-site copy, open **WireShield** from a backup task's **VPN Tunnel** button, pair the two servers with a 6-character code, and point the task at the remote tunnel IP.
6. To get files back, use **Restore** in the Backup Manager, or **Snapshots** for a ZFS point-in-time recovery.

Step-by-step instructions for every screen are in the [User Guide](docs/45Drives_Storage_Wizard_User_Guide.md).

---

## Development

```bash
npm install
npm run dev      # run the app in development
npm run build    # build the renderer and main process
```

Packaging is driven by `electron-builder.json`. Release artifacts are named `${productName}-${version}-${os}-${arch}.${ext}` and published to GitHub releases, which is also the source for in-app automatic updates.

### References

- [User Guide](docs/45Drives_Storage_Wizard_User_Guide.md)
- [Bulk setup template example](docs/bulk-setup-template-example.json)

---

_For support, contact your 45Drives representative or visit [45drives.com](https://www.45drives.com)._
