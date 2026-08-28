import path from "path"
import fs from "fs";
import { getAsset } from "./utils";
import { getAgentSocket, getKeyDir, ensureKeyPair } from "./crossPlatformSsh";
import { NodeSSH } from 'node-ssh';
import type { CipherAlgorithm } from 'ssh2';
import net from 'net';
import { loadSettings } from './settingsStore';
import { logEvent, errMsg } from './logging';
import { describeConnectionError, failureLine } from '../shared/connectionErrors';
import { HOUSTON_PACKAGE_NAMES, isBelowMinimum } from '../shared/serverPackages';

// ── Shared SSH auth types ────────────────────────────────────────────────────

export type SshAuthMethod = 'password' | 'key';

export interface SshAuth {
  username: string;
  /** Auth method — 'password' (default) or 'key' (user-supplied private key file) */
  method?: SshAuthMethod;
  /** Password for 'password' method, or used as fallback when key auth fails */
  password?: string;
  /** Absolute path to user-supplied private key file (for 'key' method) */
  privateKeyPath?: string;
  /** Optional passphrase for the private key */
  passphrase?: string;
}

/**
 * Build ssh2/node-ssh ConnectConfig for any auth scenario.
 * Supports: user-supplied key, app-managed key, SSH agent, password fallback.
 */
export function buildSshConnectOptions(host: string, auth: SshAuth): Record<string, any> {
  const settings = loadSettings();
  const timeout = settings.sshTimeoutMs;

  const base: Record<string, any> = {
    host,
    username: auth.username,
    readyTimeout: timeout,
  };

  // Fast cipher preference
  if (settings.sshFastCiphers) {
    base.algorithms = {
      cipher: ['aes128-gcm@openssh.com', 'aes256-gcm@openssh.com', 'aes128-ctr', 'aes256-ctr'] as CipherAlgorithm[],
    };
  }

  if (auth.method === 'key' && auth.privateKeyPath) {
    // User-supplied private key
    base.privateKey = fs.readFileSync(auth.privateKeyPath, 'utf-8');
    if (auth.passphrase) base.passphrase = auth.passphrase;
    return base;
  }

  // Default: password mode
  if (auth.password) {
    base.password = auth.password;
    base.tryKeyboard = true;
    base.onKeyboardInteractive = (_name: any, _instr: any, _lang: any, prompts: any[], finish: (responses: string[]) => void) => {
      finish(prompts.map(() => auth.password!));
    };
  }

  return base;
}

/**
 * Connect with full fallback chain: agent → app key → user-supplied key/password.
 * Use this for operations that happen after initial setup (key already deployed).
 */
export async function connectWithFallback(host: string, auth: SshAuth): Promise<NodeSSH> {
  const ssh = new NodeSSH();
  const keyDir = getKeyDir();
  const appKeyPath = path.join(keyDir, 'id_rsa');
  const appPubPath = `${appKeyPath}.pub`;
  await ensureKeyPair(appKeyPath, appPubPath);

  const settings = loadSettings();
  const timeout = settings.sshTimeoutMs;
  const algos = settings.sshFastCiphers
    ? { cipher: ['aes128-gcm@openssh.com', 'aes256-gcm@openssh.com', 'aes128-ctr', 'aes256-ctr'] as CipherAlgorithm[] }
    : undefined;

  const agentSock = getAgentSocket();
  const startedAt = Date.now();
  const attempts: string[] = [];

  logEvent('ssh:connect', { host, username: auth.username, method: auth.method }, 'debug');

  // Tier 1: SSH agent
  if (agentSock) {
    try {
      await ssh.connect({
        host, username: auth.username, agent: agentSock,
        readyTimeout: timeout, ...(algos && { algorithms: algos }),
      });
      logEvent('ssh:connect.done', { host, username: auth.username, tier: 'agent', durationMs: Date.now() - startedAt });
      return ssh;
    } catch (err) { attempts.push(`agent: ${errMsg(err)}`); }
  }

  // Tier 2: App-managed key (id_rsa)
  if (fs.existsSync(appKeyPath)) {
    try {
      await ssh.connect({
        host, username: auth.username,
        privateKey: fs.readFileSync(appKeyPath, 'utf8'),
        readyTimeout: timeout, ...(algos && { algorithms: algos }),
      });
      logEvent('ssh:connect.done', { host, username: auth.username, tier: 'app-key', durationMs: Date.now() - startedAt });
      return ssh;
    } catch (err) { attempts.push(`app-key: ${errMsg(err)}`); }
  }

  // Tier 3: User-supplied key
  if (auth.method === 'key' && auth.privateKeyPath) {
    try {
      await ssh.connect({
        host, username: auth.username,
        privateKey: fs.readFileSync(auth.privateKeyPath, 'utf-8'),
        ...(auth.passphrase && { passphrase: auth.passphrase }),
        readyTimeout: timeout, ...(algos && { algorithms: algos }),
      });
      logEvent('ssh:connect.done', { host, username: auth.username, tier: 'user-key', durationMs: Date.now() - startedAt });
      return ssh;
    } catch (err) { attempts.push(`user-key: ${errMsg(err)}`); }
  }

  // Tier 4: Password
  if (auth.password) {
    try {
      await ssh.connect({
        host, username: auth.username,
        password: auth.password,
        tryKeyboard: true,
        onKeyboardInteractive(_n: any, _i: any, _l: any, prompts: any[], finish: (r: string[]) => void) {
          finish(prompts.map(() => auth.password!));
        },
        readyTimeout: timeout, ...(algos && { algorithms: algos }),
      });
      logEvent('ssh:connect.done', { host, username: auth.username, tier: 'password', durationMs: Date.now() - startedAt });
      return ssh;
    } catch (err) {
      attempts.push(`password: ${errMsg(err)}`);
      const failure = describeConnectionError(err, host);
      logEvent('ssh:connect.error', {
        host, username: auth.username, attempts,
        durationMs: Date.now() - startedAt,
        message: failureLine(failure),
        reason: failure.kind,
        transient: failure.transient,
        error: errMsg(err),
      }, failure.transient ? 'warn' : 'error');
      // Half-open sockets left by the failed tiers count against sshd's MaxStartups.
      try { ssh.dispose(); } catch { /* never connected */ }
      throw new Error(failureLine(failure));
    }
  }

  logEvent('ssh:connect.error', {
    host, username: auth.username, attempts,
    durationMs: Date.now() - startedAt,
    message: `No usable sign-in method for ${host}. Add a password or SSH key for this server and try again.`,
    reason: 'no-auth-method',
    transient: false,
    error: 'no valid auth method available',
  }, 'error');
  try { ssh.dispose(); } catch { /* never connected */ }
  throw new Error(
    `No usable sign-in method for ${host}. Add a password or SSH key for this server and try again.`,
  );
}

export function checkSSH(host: string, timeout = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(timeout);
    sock.once('connect', () => { sock.destroy(); resolve(true) });
    sock.once('error', () => { sock.destroy(); logEvent('ssh:reachability', { host, reachable: false, reason: 'error' }, 'debug'); resolve(false) });
    sock.once('timeout', () => { sock.destroy(); logEvent('ssh:reachability', { host, reachable: false, reason: 'timeout', timeout }, 'debug'); resolve(false) });
    sock.connect(22, host);
  });
}

export async function verifySshCredentials(
  host: string,
  username: string,
  password: string,
  auth?: SshAuth,
): Promise<{ success: boolean; error?: string; isAdmin?: boolean }> {
  const ssh = new NodeSSH();
  try {
    const connectOpts = auth
      ? buildSshConnectOptions(host, auth)
      : buildSshConnectOptions(host, { username, password, method: 'password' });
    await ssh.connect(connectOpts);

    // Check if user has admin privileges (root or wheel/sudo group)
    let isAdmin = false;
    try {
      const uidResult = await ssh.execCommand('id -u');
      if (uidResult.stdout.trim() === '0') {
        isAdmin = true;
      } else {
        const groupsResult = await ssh.execCommand('id -Gn');
        const groups = groupsResult.stdout.trim().split(/\s+/);
        isAdmin = groups.includes('wheel') || groups.includes('sudo');
      }
    } catch {
      // If we can't determine privileges, allow proceeding (fail open for the check)
      isAdmin = true;
    }

    return { success: true, isAdmin };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('ssh:verify-credentials.error', { host, username, error: message }, 'warn');
    return { success: false, error: message };
  } finally {
    ssh.dispose();
  }
}

// Generates + uploads SSH key
export async function setupSshKey(
  host: string,
  username: string,
  password: string,
  auth?: SshAuth,
): Promise<void> {
  const connectOpts = auth
    ? buildSshConnectOptions(host, auth)
    : buildSshConnectOptions(host, { username, password, method: 'password' });
  const ssh = new NodeSSH();
  await ssh.connect(connectOpts);

  const keyDir = getKeyDir();
  await fs.promises.mkdir(keyDir, { recursive: true });

  const privateKeyPath = path.join(keyDir, "id_rsa");
  const publicKeyPath = `${privateKeyPath}.pub`;

  // This uses the crossPlatformSsh implementation, which already:
  // - Resolves ssh-keygen correctly on Windows vs macOS/Linux
  // - Checks PATH on non-Windows via `which`
  // - Throws a clear error if it's truly missing
  await ensureKeyPair(privateKeyPath, publicKeyPath);

  const publicKey = await fs.promises.readFile(publicKeyPath, "utf8");

  await ssh.execCommand(`
    mkdir -p ~/.ssh &&
    grep -qxF "${publicKey.trim()}" ~/.ssh/authorized_keys || echo "${publicKey.trim()}" >> ~/.ssh/authorized_keys &&
    chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys
  `);

  logEvent('ssh:key-deployed', { host, username, keyPath: publicKeyPath });

  ssh.dispose();
}

export { HOUSTON_PACKAGES, HOUSTON_PACKAGE_NAMES } from '../shared/serverPackages';

export interface RemoteDepCheck {
  /** Everything missing — base OS deps plus 45Drives packages. */
  missing: string[];
  /** Base OS deps only (cockpit / zfs / samba). Requires the full bootstrap. */
  baseMissing: string[];
  /** 45Drives packages only. Installable from the community repo alone. */
  houstonMissing: string[];
  /** 45Drives packages installed at an older version than the repo offers. */
  houstonOutdated: string[];
  /** 45Drives packages older than the minimum this client supports. */
  houstonBelowMinimum: string[];
  /** Installed version per 45Drives package, for packages that are present. */
  houstonVersions: Record<string, string>;
  /** Whether the 45Drives community repo is already configured. */
  repoConfigured: boolean;
}

export async function checkRemoteDeps(
  host: string,
  username: string,
  privateKeyPath: string,
): Promise<RemoteDepCheck> {
  const ssh = new NodeSSH();

  await ssh.connect({
    host,
    username,
    privateKey: fs.readFileSync(privateKeyPath, "utf8"),
    readyTimeout: loadSettings().sshTimeoutMs,
  });

  const script = `
set -e
if [ -f /etc/os-release ]; then . /etc/os-release; fi
OS_LIKE="$ID_LIKE $ID"

base_missing=""
houston_missing=""
houston_outdated=""
repo=no

has_cmd() { command -v "$1" >/dev/null 2>&1; }

pkg_installed() {
  case "$OS_LIKE" in
    *rhel*|*fedora*|*centos*)
      rpm -q "$1" >/dev/null 2>&1
      ;;
    *debian*|*ubuntu*)
      dpkg -s "$1" >/dev/null 2>&1
      ;;
    *)
      return 0
      ;;
  esac
}

# Prints the installed version, or nothing if it cannot be determined.
pkg_version() {
  case "$OS_LIKE" in
    *rhel*|*fedora*|*centos*)
      rpm -q --qf '%{VERSION}-%{RELEASE}' "$1" 2>/dev/null
      ;;
    *debian*|*ubuntu*)
      dpkg-query -W -f='\${Version}' "$1" 2>/dev/null
      ;;
  esac
}

add_base() {
  if [ -z "$base_missing" ]; then base_missing="$1"; else base_missing="$base_missing $1"; fi
}
add_houston() {
  if [ -z "$houston_missing" ]; then houston_missing="$1"; else houston_missing="$houston_missing $1"; fi
}
add_outdated() {
  if [ -z "$houston_outdated" ]; then houston_outdated="$1"; else houston_outdated="$houston_outdated $1"; fi
}

# Cockpit bridge binary
if ! has_cmd cockpit-bridge; then
  add_base cockpit
fi

# ZFS: zpool binary
if ! has_cmd zpool; then
  add_base zfs
fi

# Samba: smbd (Debian/Ubuntu) or samba (RHEL-ish)
if ! has_cmd smbd && ! has_cmd samba; then
  add_base samba
fi

# 45Drives community repo
case "$OS_LIKE" in
  *rhel*|*fedora*|*centos*)
    if [ -f /etc/yum.repos.d/45drives-community.repo ]; then repo=yes; fi
    ;;
  *debian*|*ubuntu*)
    for f in /etc/apt/sources.list.d/45drives-community*.list; do
      if [ -f "$f" ]; then repo=yes; fi
    done
    ;;
esac

# 45Drives packages
HOUSTON_PKGS="${HOUSTON_PACKAGE_NAMES.join(' ')}"
installed_pkgs=""
installed_versions=""
for p in $HOUSTON_PKGS; do
  if pkg_installed "$p"; then
    installed_pkgs="$installed_pkgs $p"
    installed_versions="$installed_versions $p=$(pkg_version "$p")"
  else
    add_houston "$p"
  fi
done

# Compare installed versions against the repo candidate. Advisory only — any
# failure here just leaves the outdated list empty.
if [ "$repo" = yes ] && [ -n "$installed_pkgs" ]; then
  case "$OS_LIKE" in
    *rhel*|*fedora*|*centos*)
      upgrades=""
      rc=0
      if has_cmd dnf; then
        upgrades="$(dnf -q check-update $installed_pkgs 2>/dev/null)" || rc=$?
      elif has_cmd yum; then
        upgrades="$(yum -q check-update $installed_pkgs 2>/dev/null)" || rc=$?
      fi
      if [ "$rc" = 100 ]; then
        for p in $installed_pkgs; do
          if printf '%s\\n' "$upgrades" | grep -q "^$p\\."; then
            add_outdated "$p"
          fi
        done
      fi
      ;;
    *debian*|*ubuntu*)
      # Without this the candidate version comes from a possibly stale cache.
      if [ -z "$(find /var/lib/apt/lists -maxdepth 1 -name '*_Packages*' -mtime -1 2>/dev/null)" ]; then
        apt-get update -qq >/dev/null 2>&1 || true
      fi
      for p in $installed_pkgs; do
        pol="$(apt-cache policy "$p" 2>/dev/null)" || pol=""
        inst="$(printf '%s\\n' "$pol" | awk '/Installed:/ { print $2; exit }')"
        cand="$(printf '%s\\n' "$pol" | awk '/Candidate:/ { print $2; exit }')"
        if [ -n "$inst" ] && [ -n "$cand" ] && [ "$inst" != '(none)' ] && [ "$cand" != '(none)' ]; then
          if dpkg --compare-versions "$inst" lt "$cand"; then
            add_outdated "$p"
          fi
        fi
      done
      ;;
  esac
fi

echo "__REPO__ $repo"
echo "__BASE__ $base_missing"
echo "__HOUSTON__ $houston_missing"
echo "__OUTDATED__ $houston_outdated"
echo "__VERSIONS__ $installed_versions"
`;

  const { stdout, stderr } = await ssh.execCommand(script);
  ssh.dispose();

  const out = (stdout || stderr).trim();
  const readLine = (tag: string): string | null => {
    const line = out.split('\n').map((l) => l.trim()).find((l) => l.startsWith(tag));
    return line ? line.slice(tag.length).trim() : null;
  };

  const repoLine = readLine('__REPO__');
  const baseLine = readLine('__BASE__');
  const houstonLine = readLine('__HOUSTON__');
  const outdatedLine = readLine('__OUTDATED__');
  const versionsLine = readLine('__VERSIONS__');

  if (repoLine === null || baseLine === null || houstonLine === null) {
    logEvent('ssh:check-remote-deps.error', { host, output: out }, 'error');
    throw new Error(`Unexpected dependency check output: ${out}`);
  }

  const baseMissing = baseLine ? baseLine.split(/\s+/) : [];
  const houstonMissing = houstonLine ? houstonLine.split(/\s+/) : [];
  const houstonOutdated = outdatedLine ? outdatedLine.split(/\s+/) : [];

  const houstonVersions: Record<string, string> = {};
  for (const entry of versionsLine ? versionsLine.split(/\s+/) : []) {
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    const version = entry.slice(eq + 1).trim();
    if (version) houstonVersions[entry.slice(0, eq)] = version;
  }

  const houstonBelowMinimum = Object.keys(houstonVersions).filter((name) =>
    isBelowMinimum(name, houstonVersions[name]),
  );

  const result: RemoteDepCheck = {
    missing: [...baseMissing, ...houstonMissing],
    baseMissing,
    houstonMissing,
    houstonOutdated,
    houstonBelowMinimum,
    houstonVersions,
    repoConfigured: repoLine === 'yes',
  };

  logEvent(
    'ssh:check-remote-deps',
    { host, ...result },
    result.missing.length || result.houstonOutdated.length || result.houstonBelowMinimum.length
      ? 'warn'
      : 'info',
  );
  return result;
}

/**
 * Configure the 45Drives community repo (if needed) and install the given
 * packages. Lighter than the full bootstrap — used when the base OS deps are
 * already present and only 45Drives packages are missing.
 */
export async function ensureHoustonPackages(
  host: string,
  username: string,
  privateKeyPath: string,
  password: string,
  packages: readonly string[] = HOUSTON_PACKAGE_NAMES,
  onLine?: (line: string, stream: "stdout" | "stderr") => void,
): Promise<boolean> {
  if (packages.length === 0) return true;

  const ssh = new NodeSSH();
  await ssh.connect({
    host,
    username,
    privateKey: fs.readFileSync(privateKeyPath, "utf8"),
    readyTimeout: loadSettings().sshTimeoutMs,
  });

  logEvent('ssh:ensure-houston-packages', { host, username, packages });

  const pkgList = packages.join(' ');
  const script = `
set -eo pipefail
if [ -r /etc/os-release ]; then . /etc/os-release; else echo "[ERROR] /etc/os-release not found"; exit 1; fi
OS_LIKE="$ID_LIKE $ID"

case "$OS_LIKE" in
  *rhel*|*fedora*|*centos*)
    if [ ! -f /etc/yum.repos.d/45drives-community.repo ]; then
      echo "[INFO] Setting up 45Drives community repo..."
      if [ -f /etc/yum.repos.d/45drives.repo ]; then
        mkdir -p /opt/45drives/archives/repos
        mv /etc/yum.repos.d/45drives.repo "/opt/45drives/archives/repos/45drives-$(date +%Y-%m-%d).repo"
      fi
      curl -sSL https://repo.45drives.com/repofiles/rocky/45drives-community.repo -o /etc/yum.repos.d/45drives-community.repo
      dnf clean all
    else
      echo "[INFO] 45Drives community repo already configured."
    fi
    echo "[INFO] Installing: ${pkgList}"
    dnf install -y ${pkgList}
    ;;
  *debian*|*ubuntu*)
    if ! ls /etc/apt/sources.list.d/45drives-community*.list >/dev/null 2>&1; then
      echo "[INFO] Setting up 45Drives community repo..."
      apt-get update -y
      apt-get install -y ca-certificates gnupg curl wget
      wget -qO - https://repo.45drives.com/key/gpg.asc | gpg --pinentry-mode loopback --batch --yes --dearmor -o /usr/share/keyrings/45drives-archive-keyring.gpg
      curl -sSL "https://repo.45drives.com/repofiles/$ID/45drives-community-$VERSION_CODENAME.list" \\
        -o "/etc/apt/sources.list.d/45drives-community-$VERSION_CODENAME.list"
    else
      echo "[INFO] 45Drives community repo already configured."
    fi
    apt-get update -y
    echo "[INFO] Installing: ${pkgList}"
    apt-get install -y ${pkgList}
    ;;
  *)
    echo "[ERROR] Unsupported OS: ID=$ID ID_LIKE=$ID_LIKE"
    exit 1
    ;;
esac

systemctl restart cockpit.socket || true
echo "[INFO] 45Drives packages installed."
`;

  const scriptRemotePath = "/tmp/ensure-houston-packages.sh";
  await ssh.execCommand(`cat > ${scriptRemotePath}`, { stdin: script });

  const result = await ssh.execCommand(
    `sudo -S -p '' bash -c 'tr -d "\\r" < "${scriptRemotePath}" | bash'`,
    {
      cwd: "/tmp",
      stdin: password + "\n",
      execOptions: { pty: true },
      onStdout(chunk) {
        const line = chunk.toString().trim();
        if (!line || line === password) return;
        onLine?.(line, "stdout");
      },
      onStderr(chunk) {
        const text = chunk.toString().trim();
        if (!text || text === password) return;
        if (text.startsWith("[sudo] password for")) return;
        onLine?.(text, "stderr");
      },
    },
  );

  await ssh.execCommand(`rm -f ${scriptRemotePath}`);
  ssh.dispose();

  if (typeof result.code === "number" && result.code !== 0) {
    logEvent('ssh:ensure-houston-packages.error', { host, packages, exitCode: result.code }, 'error');
    throw new Error(
      `Failed to install 45Drives packages on ${host} (exit code ${result.code}).`,
    );
  }

  logEvent('ssh:ensure-houston-packages.done', { host, packages });
  return true;
}



//  Upload and run install script
export async function runBootstrapScript(
  host: string,
  username: string,
  privateKeyPath: string,
  password: string,
  onLine?: (line: string, stream: "stdout" | "stderr") => void,
): Promise<boolean> {
  const ssh = new NodeSSH();
  const scriptLocalPath = await getAsset("static", "setup-super-simple.sh");
  const scriptRemotePath = "/tmp/setup-super-simple.sh";

  logEvent('ssh:bootstrap', { host, username, script: scriptRemotePath });

  await ssh.connect({
    host,
    username,
    privateKey: fs.readFileSync(privateKeyPath, "utf8"),
    readyTimeout: loadSettings().sshTimeoutMs,
  });

  await ssh.putFile(scriptLocalPath, scriptRemotePath);

  let rebootRequired = false;

  const result = await ssh.execCommand(
    `sudo -S -p '' bash -c 'tr -d "\\r" < "${scriptRemotePath}" | bash'`,
    {
      cwd: "/tmp",
      stdin: password + "\n",
      execOptions: { pty: true },
      onStdout(chunk) {
        const line = chunk.toString().trim();
        if (!line) return;

        // hard stop: do NOT ever log or bubble the raw password
        if (line === password) return;

        console.info(`[bootstrap stdout ${host}] ${line}`);
        onLine?.(line, "stdout");
        if (line.includes("[REBOOT_NEEDED]")) rebootRequired = true;
      },
      onStderr(chunk) {
        const text = chunk.toString().trim();
        if (!text) return;

        // hide sudo’s password prompt from logs/UI
        if (text.startsWith("[sudo] password for")) return;

        // just in case some crazy sudo config echos the password to stderr:
        if (text === password) return;

        console.warn(`[bootstrap stderr ${host}] ${text}`);
        onLine?.(text, "stderr");
      },
    },
  );

  ssh.dispose();

  if (typeof result.code === "number" && result.code !== 0) {
    logEvent('ssh:bootstrap.error', { host, username, exitCode: result.code }, 'error');
    throw new Error(
      `Bootstrap script exited with code ${result.code} (host ${host}).`
    );
  }

  logEvent('ssh:bootstrap.done', { host, username, rebootRequired });

  return rebootRequired;
}

