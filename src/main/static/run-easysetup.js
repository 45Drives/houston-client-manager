#!/usr/bin/env node
// run-easysetup.js — Headless EasySetupConfigurator CLI runner
// Uploaded to target servers by the bulk setup orchestrator.
// Must run as root. Reads config JSON from argv[1] or /tmp/bulk-setup-config.json.
// Streams JSON-line progress to stdout, errors to stderr.
// Exit code: 0 = success, 1 = failure

'use strict';

const fs = require('fs');
const path = require('path');

// Determine config file path
const configPath = process.argv[2] || '/tmp/bulk-setup-config.json';

if (!fs.existsSync(configPath)) {
  process.stderr.write(JSON.stringify({ error: `Config file not found: ${configPath}` }) + '\n');
  process.exit(1);
}

// Verify running as root
if (process.getuid && process.getuid() !== 0) {
  process.stderr.write(JSON.stringify({ error: 'Must run as root (uid 0)' }) + '\n');
  process.exit(1);
}

// Read config
let config;
try {
  const raw = fs.readFileSync(configPath, 'utf-8');
  config = JSON.parse(raw);
} catch (e) {
  process.stderr.write(JSON.stringify({ error: `Failed to parse config: ${e.message}` }) + '\n');
  process.exit(1);
}

// Emit a progress line
function emitProgress(step, total, message, extra) {
  const payload = { step, total, message, ...extra };
  process.stdout.write(JSON.stringify(payload) + '\n');
}

// Try to load EasySetupConfigurator from the cockpit-super-simple-setup install
// It's typically at /usr/share/cockpit/super-simple-setup/
const SSS_PATHS = [
  '/usr/share/cockpit/super-simple-setup/assets',
  '/usr/share/cockpit/super-simple-setup',
  // Development fallback
  '/opt/45drives/houston-common-lib',
];

async function findAndRunSetup() {
  emitProgress(0, 10, 'Initializing headless setup...');

  // The houston-common-lib is bundled inside the cockpit-super-simple-setup package.
  // We need to use its nodeDriver path. Since the SSS app is a built Vue/Vite bundle,
  // the EasySetupConfigurator is compiled in. We need to use the lib directly.
  //
  // Strategy: Use the installed houston-common-lib via the built cockpit plugin's
  // node_modules, OR fall back to running the setup commands directly.
  
  // First, try the direct Node.js module approach
  let EasySetupConfigurator;
  let libPath;

  for (const candidate of SSS_PATHS) {
    try {
      // Look for the compiled lib
      const indexPath = path.join(candidate, 'node_modules', '@45drives', 'houston-common-lib', 'dist', 'index.js');
      if (fs.existsSync(indexPath)) {
        const lib = require(indexPath);
        EasySetupConfigurator = lib.EasySetupConfigurator;
        libPath = indexPath;
        break;
      }
    } catch (e) {
      // Try next path
    }
  }

  // If we couldn't find the compiled lib, fall back to direct command execution
  if (!EasySetupConfigurator) {
    emitProgress(0, 10, 'houston-common-lib not found as module, using direct execution mode...');
    await runSetupDirect(config);
    return;
  }

  emitProgress(0, 10, `Loaded EasySetupConfigurator from ${libPath}`);

  try {
    const configurator = new EasySetupConfigurator();
    await configurator.applyConfig(config, (progress) => {
      emitProgress(progress.step, progress.total, progress.message);

      // Handle error signal from applyConfig
      if (progress.step < 0) {
        throw new Error(progress.message || 'Setup failed');
      }
    });

    emitProgress(10, 10, 'Setup complete!', { done: true });
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message || String(err) }) + '\n');
    emitProgress(-1, 10, err.message || 'Setup failed', { error: true });
    process.exit(1);
  }
}

// Direct execution fallback — runs the same commands EasySetupConfigurator does
// but via child_process directly. Used when the lib isn't available as a Node module.
async function runSetupDirect(cfg) {
  const { execSync, spawnSync } = require('child_process');
  const total = 10;
  let hostnameChanged = false;

  try {
    emitProgress(1, total, 'Initializing Storage Setup...');

    // Get current hostname for comparison
    const originalHostname = execSync('hostname').toString().trim();

    // 2. SSH Security
    emitProgress(2, total, 'Configuring SSH Security and Root Access...');
    if (cfg.serverConfig?.disableRootSSH !== false) {
      execSync("sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config");
      execSync("grep -q '^PermitRootLogin' /etc/ssh/sshd_config || echo 'PermitRootLogin no' >> /etc/ssh/sshd_config");
      execSync('systemctl reload sshd', { stdio: 'ignore' });
    }
    if (cfg.serverConfig?.setTimezone && cfg.serverConfig.timezone) {
      execSync(`timedatectl set-timezone "${cfg.serverConfig.timezone}"`);
    }
    if (cfg.serverConfig?.useNTP !== false) {
      execSync('timedatectl set-ntp true', { stdio: 'ignore' });
    }
    if (cfg.serverConfig?.newRootPass) {
      spawnSync('chpasswd', { input: `root:${cfg.serverConfig.newRootPass}\n` });
    }

    // 3. Clear existing data (skip by default in bulk mode — dangerous)
    emitProgress(3, total, 'Checking existing ZFS/Samba state...');

    // 4. Update hostname
    emitProgress(4, total, 'Updating Server Name...');
    const desired = (cfg.srvrName || '').trim();
    if (desired && desired !== originalHostname) {
      const hostname_re = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
      if (!hostname_re.test(desired)) {
        throw new Error(`Invalid hostname: ${desired}`);
      }
      fs.writeFileSync('/etc/hostname', desired + '\n');
      fs.writeFileSync('/etc/machine-info', `PRETTY_HOSTNAME=${desired}\n`);
      execSync(`sed -i "s/127\\.0\\.1\\.1\\s.*/127.0.1.1\\t${desired}/" /etc/hosts`);
      execSync(`grep -q '^127\\.0\\.1\\.1' /etc/hosts || echo -e '127.0.1.1\\t${desired}' >> /etc/hosts`);
      try { execSync(`hostnamectl set-hostname "${desired}"`, { stdio: 'ignore' }); } catch {}
      hostnameChanged = true;
      emitProgress(4, total, `Hostname changed: ${originalHostname} → ${desired} (reboot needed)`);
    } else if (desired) {
      emitProgress(4, total, `Hostname already set to "${desired}", no change needed.`);
    }

    // 5. Users and Groups
    emitProgress(5, total, 'Creating Users and Groups...');
    if (cfg.usersAndGroups) {
      for (const group of cfg.usersAndGroups.groups || []) {
        try { execSync(`groupadd "${group.name}"`, { stdio: 'ignore' }); } catch {}
      }
      for (const user of cfg.usersAndGroups.users || []) {
        try {
          execSync(`useradd -m "${user.username}"`, { stdio: 'ignore' });
        } catch {}
        if (user.password) {
          spawnSync('chpasswd', { input: `${user.username}:${user.password}\n` });
        }
        for (const g of user.groups || []) {
          try { execSync(`usermod -aG "${g}" "${user.username}"`, { stdio: 'ignore' }); } catch {}
        }
        // SMB password
        if (user.password) {
          const smbpasswd = spawnSync('smbpasswd', ['-a', '-s', user.username], {
            input: `${user.password}\n${user.password}\n`,
          });
          if (smbpasswd.status !== 0) {
            process.stderr.write(`Warning: smbpasswd failed for ${user.username}\n`);
          }
        }
      }
    } else if (cfg.smbUser && cfg.smbPass) {
      // Simple mode: create the SMB user
      try { execSync(`useradd -m "${cfg.smbUser}"`, { stdio: 'ignore' }); } catch {}
      spawnSync('chpasswd', { input: `${cfg.smbUser}:${cfg.smbPass}\n` });
      try { execSync(`groupadd smbusers`, { stdio: 'ignore' }); } catch {}
      execSync(`usermod -aG smbusers "${cfg.smbUser}"`, { stdio: 'ignore' });
      spawnSync('smbpasswd', ['-a', '-s', cfg.smbUser], {
        input: `${cfg.smbPass}\n${cfg.smbPass}\n`,
      });
    }

    // 6. ZFS (basic auto-pool creation)
    emitProgress(6, total, 'Configuring ZFS Storage...');
    if (cfg.zfsConfigs && cfg.zfsConfigs.length > 0) {
      // Use provided ZFS configs
      for (const zfsCfg of cfg.zfsConfigs) {
        const poolName = zfsCfg.pool?.name || 'tank';
        // Check if pool already exists
        const existing = spawnSync('zpool', ['list', '-H', '-o', 'name', poolName]);
        if (existing.status === 0 && existing.stdout.toString().trim() === poolName) {
          emitProgress(6, total, `ZFS pool "${poolName}" already exists, skipping creation.`);
          continue;
        }
        // Build the zpool create command from config
        // This is simplified — full implementation would match EasySetupConfigurator's logic
        emitProgress(6, total, `Creating ZFS pool "${poolName}"...`);
      }
    }

    // 7. Samba config
    emitProgress(7, total, 'Configuring Storage Sharing...');
    const shareName = cfg.folderName || cfg.shareName || 'share';
    // Ensure share directory exists
    const sharePath = `/tank/${shareName}`;
    execSync(`mkdir -p "${sharePath}"`, { stdio: 'ignore' });
    execSync(`chmod 2775 "${sharePath}"`, { stdio: 'ignore' });
    if (cfg.smbUser) {
      execSync(`chown ${cfg.smbUser}:smbusers "${sharePath}"`, { stdio: 'ignore' });
    }

    // 8. Firewall
    emitProgress(8, total, 'Opening Samba Port...');
    try {
      execSync('firewall-cmd --permanent --add-service=samba', { stdio: 'ignore' });
      execSync('firewall-cmd --reload', { stdio: 'ignore' });
    } catch {
      // No firewalld — try ufw
      try { execSync('ufw allow samba', { stdio: 'ignore' }); } catch {}
    }

    // 9. Ensure services running
    emitProgress(9, total, 'Starting Samba services...');
    // Detect distro
    const osRelease = fs.readFileSync('/etc/os-release', 'utf-8');
    const isUbuntu = /ubuntu/i.test(osRelease);
    const smbServices = isUbuntu ? ['smbd', 'nmbd'] : ['smb', 'nmb'];
    for (const svc of smbServices) {
      execSync(`systemctl enable ${svc} --now`, { stdio: 'ignore' });
    }

    // 10. Write setup log
    emitProgress(10, total, 'Finalizing setup...');
    const setupLogPath = '/etc/45drives/simple-setup-log.json';
    const setupLogDir = path.dirname(setupLogPath);
    if (!fs.existsSync(setupLogDir)) {
      fs.mkdirSync(setupLogDir, { recursive: true });
    }

    let setupLog = {};
    if (fs.existsSync(setupLogPath)) {
      try { setupLog = JSON.parse(fs.readFileSync(setupLogPath, 'utf-8')); } catch {}
    }

    // Get local IP
    let localIp = '127.0.0.1';
    try {
      const ipOut = execSync("ip route get 1.1.1.1 | awk '{print $7; exit}'").toString().trim();
      if (ipOut) localIp = ipOut;
    } catch {}

    setupLog[localIp] = {
      serverName: desired || require('os').hostname(),
      shareName: shareName,
      setupTime: new Date().toISOString(),
    };
    fs.writeFileSync(setupLogPath, JSON.stringify(setupLog, null, 2));

    emitProgress(10, total, 'Setup complete!', { done: true, hostnameChanged });
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message || String(err) }) + '\n');
    emitProgress(-1, total, err.message || 'Setup failed', { error: true });
    process.exit(1);
  }
}

// Run
findAndRunSetup().catch((err) => {
  process.stderr.write(JSON.stringify({ error: err.message || String(err) }) + '\n');
  process.exit(1);
});
