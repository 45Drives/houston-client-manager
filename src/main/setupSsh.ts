import path from "path"
import fs from "fs";
import { getAsset } from "./utils";
import { getAgentSocket, getKeyDir, ensureKeyPair } from "./crossPlatformSsh";
import { NodeSSH } from 'node-ssh';
import type { CipherAlgorithm } from 'ssh2';
import net from 'net';
import { loadSettings } from './settingsStore';

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

  // Tier 1: SSH agent
  if (agentSock) {
    try {
      await ssh.connect({
        host, username: auth.username, agent: agentSock,
        readyTimeout: timeout, ...(algos && { algorithms: algos }),
      });
      return ssh;
    } catch { /* fall through */ }
  }

  // Tier 2: App-managed key (id_rsa)
  if (fs.existsSync(appKeyPath)) {
    try {
      await ssh.connect({
        host, username: auth.username,
        privateKey: fs.readFileSync(appKeyPath, 'utf8'),
        readyTimeout: timeout, ...(algos && { algorithms: algos }),
      });
      return ssh;
    } catch { /* fall through */ }
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
      return ssh;
    } catch { /* fall through */ }
  }

  // Tier 4: Password
  if (auth.password) {
    await ssh.connect({
      host, username: auth.username,
      password: auth.password,
      tryKeyboard: true,
      onKeyboardInteractive(_n: any, _i: any, _l: any, prompts: any[], finish: (r: string[]) => void) {
        finish(prompts.map(() => auth.password!));
      },
      readyTimeout: timeout, ...(algos && { algorithms: algos }),
    });
    return ssh;
  }

  throw new Error(`SSH connection to ${host} failed: no valid auth method available`);
}

export function checkSSH(host: string, timeout = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(timeout);
    sock.once('connect', () => { sock.destroy(); resolve(true) });
    sock.once('error', () => { sock.destroy(); resolve(false) });
    sock.once('timeout', () => { sock.destroy(); resolve(false) });
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

  ssh.dispose();
}

export async function checkRemoteDeps(
  host: string,
  username: string,
  privateKeyPath: string,
): Promise<{ missing: string[] }> {
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

missing=""

has_cmd() { command -v "$1" >/dev/null 2>&1; }
add_missing() {
  if [ -z "$missing" ]; then
    missing="$1"
  else
    missing="$missing $1"
  fi
}

# Cockpit bridge binary
if ! has_cmd cockpit-bridge; then
  add_missing cockpit
fi

# ZFS: zpool binary
if ! has_cmd zpool; then
  add_missing zfs
fi

# Samba: smbd (Debian/Ubuntu) or samba (RHEL-ish)
if ! has_cmd smbd && ! has_cmd samba; then
  add_missing samba
fi

# cockpit-super-simple-setup package via rpm/dpkg
case "$ID_LIKE" in
  *rhel*)
    if ! rpm -q cockpit-super-simple-setup >/dev/null 2>&1; then
      add_missing cockpit-super-simple-setup
    fi
    ;;
  *debian*|*ubuntu*)
    if ! dpkg -s cockpit-super-simple-setup >/dev/null 2>&1; then
      add_missing cockpit-super-simple-setup
    fi
    ;;
esac

if [ -z "$missing" ]; then
  echo "__OK__"
else
  echo "__MISSING__ $missing"
fi
`;

  const { stdout, stderr } = await ssh.execCommand(script);
  ssh.dispose();

  const out = (stdout || stderr).trim();
  if (out.startsWith("__OK__")) {
    return { missing: [] };
  }
  if (out.startsWith("__MISSING__")) {
    const parts = out.split(/\s+/).slice(1); // drop "__MISSING__"
    return { missing: parts };
  }

  throw new Error(`Unexpected dependency check output: ${out}`);
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
    throw new Error(
      `Bootstrap script exited with code ${result.code} (host ${host}).`
    );
  }

  return rebootRequired;
}

