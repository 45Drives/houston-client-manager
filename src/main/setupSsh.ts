import path from "path"
import fs from "fs";
import { getAsset } from "./utils";
import { getKeyDir, ensureKeyPair } from "./crossPlatformSsh";
import { NodeSSH } from 'node-ssh';
import net from 'net';

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

// Generates + uploads SSH key
export async function setupSshKey(
  host: string,
  username: string,
  password: string
): Promise<void> {
  const ssh = await connectWithPassword({ host, username, password });

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


async function connectWithPassword({
  host,
  username,
  password,
}: {
  host: string;
  username: string;
  password: string;
}) {
  const ssh = new NodeSSH();
  await ssh.connect({
    host,
    username,
    password,                   // plain “password” auth
    tryKeyboard: true,          // allow keyboard-interactive fallback
    // debug: info => console.debug('⎇ SSH DEBUG:', info),
    onKeyboardInteractive(
      _name, _instr, _lang, prompts, finish,
    ) {
      // answer every prompt with the same password
      finish(prompts.map(() => password));
    },
    readyTimeout: 20_000,
  });
  return ssh;
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
    readyTimeout: 20_000,
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
    readyTimeout: 20_000,
  });

  await ssh.putFile(scriptLocalPath, scriptRemotePath);

  let rebootRequired = false;

  const result = await ssh.execCommand(
    `sudo -S -p '' bash "${scriptRemotePath}"`,
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

