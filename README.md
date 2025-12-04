# 45Drives Setup Wizard

The 45Drives Setup Wizard connects your personal computer to a 45Drives server to configure storage, schedule backups, and manage ongoing tasks. Follow the instructions below to download, install, and launch the application on your preferred platform.

---

## Installation Steps

###  Windows

1. Download the Windows Installer:  
   \`45drives-setup-wizard.Setup.1.0.0.exe\`  
2. Run the installer and follow the on-screen prompts.  
3. After installation:  
   -  If the **Run 45Drives Setup Wizard** checkbox is selected at the end, the app will launch automatically.  
   - 🖱️ Otherwise, launch it anytime from:  
     - Desktop shortcut  
     - Start Menu → **45Drives Setup Wizard**

**Notes**  
- The app runs with standard user permissions.  
- It will automatically request elevated privileges (UAC) for operations like:  
  - Creating scheduled tasks  
  - Mounting SMB shares  
  - Accessing protected directories  

---

###  macOS

1. Download the macOS disk image:  
   \`45drives-setup-wizard.dmg\`  
2. Open the \`.dmg\` and drag **45Drives Setup Wizard.app** into **Applications**.  
3. Launch the app via Launchpad or Applications.

#### First-Time Launch

-  macOS may warn: “Are you sure you want to open this application?” → Click **Open**.  
-  **Full Disk Access Required** for cron-backed backups of protected folders.

**Grant Full Disk Access to \`cron\`:**  
1. System Settings → Privacy & Security → Full Disk Access  
2. Click **+**, navigate to \`/usr/sbin/cron\`, and click **Open**  
3. Toggle on access for \`cron\`  
4. Restart your Mac or re-run the app  

---

###  Linux

#### Download the Installer

| Distro                   | File Name                                            |
| ------------------------ | ---------------------------------------------------- |
| Rocky / RHEL / AlmaLinux | \`45drives-setup-wizard-1.0.0.x86_64.rpm\`             |
| Ubuntu / Debian          | \`45drives-setup-wizard_1.0.0_amd64.deb\`              |
| Arch Linux               | \`45drives-setup-wizard-1.0.0.pacman\`                 |

####  Installation Methods

#####  GUI Install  
1. Double-click the downloaded file.  
2. Complete installation via GNOME Software, KDE Discover, etc.

#####  CLI Install  
\`\`\`bash
# Rocky / RHEL
sudo dnf install ./45drives-setup-wizard-1.0.0.x86_64.rpm

# Ubuntu / Debian
sudo apt install ./45drives-setup-wizard_1.0.0_amd64.deb

# Arch Linux
sudo pacman -U ./45drives-setup-wizard-1.0.0.pacman
\`\`\`

####  Launch the Application

- From your desktop environment’s launcher (search “45Drives Setup Wizard”), or  
- In a terminal:  
  \`\`\`bash
  45drives-setup-wizard
  \`\`\`

** Root Privileges**  
Requested only when necessary to:  
-  Create an \`fstab\` entry for SMB mounts  
-  Install a \`cron\` job for scheduled backups  
-  Access protected folders  
Subsequent tasks for the same server usually won’t require re-elevation.

---

##  Setting Up a Server

On first launch, the wizard appears automatically. If you land in the Backup Client, open the ☰ menu and select **Setup**.

1. **Welcome Screen**  
   - Overview of what the app will do  
   -  Tooltips for more info  
   - Click **Next** to proceed  

2. **Physical Setup**  
   1. Unbox and install your drives  
   2. Plug in the power cable  
   3. Connect to your network  
   4. Power on the server  

---

##  Discovering a Server

- Auto-detects 45Drives servers on your local network.  
- Listed under **Discovered 45Drives Storage Servers**.

**If none appear:**  
1. Click **Add a Server Manually**  
2. Enter IP and SSH credentials  
3. Click **Add Server**  
4. The app installs required software via SSH.

---

##  Simple Setup

### Configuration Prompts

-  **Server Name** (hostname)  
-  **Initial user** & password  
-  **Network Folder Name** (SMB share)

Options:  
- Set a root password  
- Use the same or a new password for root  

 Root credentials cannot be recovered—store them safely!

---

##  Disk Summary

3D disk viewer shows drive status:  
-  Orange = issue detected  
-  Green = selected

Enable **Active Backup** to create two mirrored pools:  
- **Primary Pool** (Magenta)  
- **Backup Pool** (Teal)

---

##  Final Summary & Setup

- Review all settings  
- Click **Back** to revise, or **Complete Setup** to start  
- Progress checklist displays tasks as they run

---

##  Post-Setup Options

- **Go to Backup Manager** – schedule/run backups  
- **Set Up More Storage Servers** – discovery screen  
- **Go to Houston Command Center** – full UI in browser

---

##  Backup Manager

###  Welcome Page

- Click **Next** to choose:  
  - **Create Backup Schedule**  
  - **Review Your Backups**

###  Create Backup Schedule

####  Simple Backup

- Backup Location  
- Interval (hourly/daily/weekly/monthly)  
- Folders:  
  - ➕ Add folder → **OK**  
  - ➖ Remove folder  

> All folders share the same interval.

####  Custom Backup

1. Select **Backup Location**  
2. ➕ Add folder  
3. Calendar UI: set start date/time & frequency  
4. **Save Schedule**  
5. Repeat for more tasks  

 Edit or Delete tasks as needed.  
Click **Next** when done.

###  Server Credentials

Enter setup Username & Password → **Next**.

###  Backup Summary

Shows:  
- Backup Server  
- Folder list  
- Interval/settings  

 Notes:  
- **Linux**: banner for initial \`sudo\` prompt.  
- **Windows/macOS**: UAC/elevation prompts.

Click **Next**.

###  Backup Confirmation

Success screen → **Go to Backup Manager**.

###  Review Your Backups

- List of scheduled tasks  

**Controls per task:**  
-  Edit Schedule  
-  Backup Now  
-  Delete Task  

**Multi-select:**  
- Highlight tasks → **Delete Selected**

###  Open Backup Folders

1. Select tasks  
2. **Next**  
3. Enter credentials  
4. **Open**  

Mounts SMB share & opens server directories.

---

###  Restore Backups

In the Restore Backup module (☰ menu):

1. **Welcome & Server Selection**  
   - **Restore Welcome** screen → **Next**  
   - Choose server, enter Username & Password → **Next**

2. **Browse Backups**  
   - Select a backup on the left  
   - View contents in main pane  
   - Use **Search** to filter

3. **Select Items**  
   - Tick checkboxes for files/folders  
   - **Select All** / **Deselect All**  
   - Click **Restore Selected**

4. **Confirm & Restore**  
   - Warning: existing files will be **overwritten**  
   - Click **Restore Now**  
   - Progress bar shows status

5. **Open & Finish**  
   - **Open All** opens restored folders  
   - **Dismiss** closes the dialog

 Your files are back in their original locations!

---

_That’s it! More features are coming—Remote/Offsite backup, Snapshot rollback/restore, and additional quality-of-life improvements. Stay tuned for updates from 45Drives._
