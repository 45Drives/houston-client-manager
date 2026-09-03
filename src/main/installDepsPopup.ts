import { dialog } from 'electron';
import sudo from 'sudo-prompt';
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SUDO_OPTIONS = { name: '45Drives Storage Wizard' };

/**
 * Binaries this app shells out to on each platform. Windows needs none of this —
 * robocopy, PowerShell, Task Scheduler and "net use" all ship with the OS.
 */
export const CLIENT_TOOLS: Record<'linux' | 'darwin', string[]> = {
  linux: ['smbclient', 'mount.cifs', 'rsync', 'crontab'],
  darwin: ['smbclient'],
};

interface PackageManager {
  bin: string;
  /** Runs unattended under sudo/pkexec. */
  install: (packages: string[]) => string;
  /** Shown to the user so they can run it themselves. */
  hint: (packages: string[]) => string;
  packageFor: Record<string, string>;
}

const APT_LIKE = { smbclient: 'smbclient', 'mount.cifs': 'cifs-utils', rsync: 'rsync', crontab: 'cron' };
const RPM_LIKE = { smbclient: 'samba-client', 'mount.cifs': 'cifs-utils', rsync: 'rsync', crontab: 'cronie' };

const PACKAGE_MANAGERS: PackageManager[] = [
  {
    bin: 'apt-get',
    install: (p) => `apt-get update && apt-get install -y ${p.join(' ')}`,
    hint: (p) => `sudo apt install ${p.join(' ')}`,
    packageFor: APT_LIKE,
  },
  {
    bin: 'dnf',
    install: (p) => `dnf install -y ${p.join(' ')}`,
    hint: (p) => `sudo dnf install ${p.join(' ')}`,
    packageFor: RPM_LIKE,
  },
  {
    bin: 'yum',
    install: (p) => `yum install -y ${p.join(' ')}`,
    hint: (p) => `sudo yum install ${p.join(' ')}`,
    packageFor: RPM_LIKE,
  },
  {
    bin: 'zypper',
    install: (p) => `zypper --non-interactive install ${p.join(' ')}`,
    hint: (p) => `sudo zypper install ${p.join(' ')}`,
    packageFor: RPM_LIKE,
  },
  {
    bin: 'pacman',
    install: (p) => `pacman -S --noconfirm ${p.join(' ')}`,
    hint: (p) => `sudo pacman -S ${p.join(' ')}`,
    packageFor: { smbclient: 'smbclient', 'mount.cifs': 'cifs-utils', rsync: 'rsync', crontab: 'cronie' },
  },
];

const BREW: PackageManager = {
  bin: 'brew',
  install: (p) => `brew install ${p.join(' ')}`,
  hint: (p) => `brew install ${p.join(' ')}`,
  packageFor: { smbclient: 'samba', rsync: 'rsync' },
};

/** mount.cifs and crontab live in sbin, which Electron's inherited PATH often omits. */
function searchDirs(): string[] {
  const fromPath = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return [...new Set([...fromPath, '/usr/local/bin', '/opt/homebrew/bin', '/sbin', '/usr/sbin', '/usr/local/sbin'])];
}

function resolveBinary(bin: string): string | null {
  for (const dir of searchDirs()) {
    const candidate = path.join(dir, bin);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

function detectPackageManager(): PackageManager | null {
  if (os.platform() === 'darwin') return resolveBinary('brew') ? BREW : null;
  return PACKAGE_MANAGERS.find((pm) => resolveBinary(pm.bin)) ?? null;
}

export interface ClientToolStatus {
  /** Requested binaries that are not present. */
  missing: string[];
  /** Packages that would supply them, when the package manager is known. */
  packages: string[];
  /** Copy-pasteable install command, or null when no package manager was found. */
  hint: string | null;
}

/** Defaults to every tool this platform needs when no explicit list is given. */
export function checkClientTools(tools?: string[]): ClientToolStatus {
  const platform = os.platform();
  const required = tools ?? (platform === 'linux' ? CLIENT_TOOLS.linux
    : platform === 'darwin' ? CLIENT_TOOLS.darwin
      : []);

  // Windows ships everything this app uses, so nothing is ever reported missing there.
  const missing = platform === 'win32' ? [] : required.filter((bin) => !resolveBinary(bin));
  if (missing.length === 0) return { missing, packages: [], hint: null };

  const pm = detectPackageManager();
  if (!pm) return { missing, packages: [], hint: null };

  const packages = [...new Set(missing.map((bin) => pm.packageFor[bin]).filter(Boolean))];
  return { missing, packages, hint: packages.length ? pm.hint(packages) : null };
}

function runInstall(pm: PackageManager, packages: string[]): Promise<void> {
  if (pm === BREW) {
    const brew = resolveBinary('brew')!;
    return new Promise((resolve, reject) => {
      // Homebrew refuses to run as root, so this must not go through sudo-prompt.
      execFile(brew, ['install', ...packages], { timeout: 15 * 60_000 }, (error) =>
        error ? reject(error) : resolve()
      );
    });
  }
  return new Promise((resolve, reject) => {
    sudo.exec(pm.install(packages), SUDO_OPTIONS, (error) => (error ? reject(error) : resolve()));
  });
}

function missingToolMessage(status: ClientToolStatus): string {
  const list = status.missing.join(' and ');
  const verb = status.missing.length > 1 ? 'are' : 'is';
  if (os.platform() === 'darwin' && !resolveBinary('brew')) {
    return `${list} ${verb} not installed on this Mac, which backups need. Install Homebrew from https://brew.sh, then run "brew install samba".`;
  }
  if (status.hint) {
    return `${list} ${verb} not installed on this computer, which backups need. Install with: ${status.hint}`;
  }
  return `${list} ${verb} not installed on this computer, which backups need. Install the equivalent packages using your distribution's package manager.`;
}

/**
 * Verifies the requested client tooling is present, offering a one-click install when it is not.
 * Called at the point of use so the app never nags on launch.
 */
export async function ensureClientTools(
  tools?: string[],
  options: { prompt?: boolean } = {}
): Promise<{ ok: boolean; message?: string }> {
  const { prompt = true } = options;
  const status = checkClientTools(tools);
  if (status.missing.length === 0) return { ok: true };

  console.warn(`[Dependencies] Missing client tools: ${status.missing.join(', ')}`);

  if (!prompt || status.packages.length === 0) {
    return { ok: false, message: missingToolMessage(status) };
  }

  const pm = detectPackageManager()!;
  const choice = await dialog.showMessageBox({
    type: 'question',
    title: 'Install Required Tools',
    message: 'Missing backup tools',
    detail: `Backups need ${status.missing.join(' and ')}, which ${status.missing.length > 1 ? 'are' : 'is'} not installed on this computer.\n\nInstall ${status.packages.join(' and ')} now?${pm === BREW ? '' : ' You will be asked for your administrator password.'}`,
    buttons: ['Install', 'Not Now'],
    defaultId: 0,
    cancelId: 1,
  });

  if (choice.response !== 0) {
    return { ok: false, message: missingToolMessage(status) };
  }

  try {
    await runInstall(pm, status.packages);
  } catch (error: any) {
    console.error('[Dependencies] Install failed:', error?.message || error);
    return {
      ok: false,
      message: `Could not install ${status.packages.join(' and ')} automatically. Install manually with: ${status.hint}`,
    };
  }

  const after = checkClientTools(tools);
  if (after.missing.length > 0) return { ok: false, message: missingToolMessage(after) };
  return { ok: true };
}
