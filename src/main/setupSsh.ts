import { exec } from "child_process";
import path from "path";
import fs from "fs";
import { getAppPath, getOS } from "./utils";
import { NodeSSH } from 'node-ssh';
import { getAsset } from './utils';
import net from 'net';
import { app } from 'electron';

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
// 🧩 Generates + uploads SSH key
export async function setupSshKey(host: string, username: string, password: string): Promise<void> {
  const ssh = await connectWithPassword({ host, username: username, password: password });
  // const sshDir = path.join(getAppPath(), ".ssh");
  const sshDir = path.join(app.getPath('userData'), '.ssh');
  const privateKeyPath = path.join(sshDir, "id_rsa");
  const publicKeyPath = path.join(sshDir, "id_rsa.pub");

  if (!fs.existsSync(sshDir)) fs.mkdirSync(sshDir, { recursive: true });

  if (!fs.existsSync(privateKeyPath)) {
    const sshKeygen = getOS() === 'win'
      ? `${path.join(process.resourcesPath, "static", "bin", 'ssh-keygen.exe')}`
      : 'ssh-keygen';
    if (!fs.existsSync(sshKeygen)) {
      throw new Error(`ssh-keygen not found at ${sshKeygen}`);
    }
      
    await new Promise<void>((resolve, reject) => {
      exec(`"${sshKeygen}" -t rsa -b 4096 -f "${privateKeyPath}" -N ""`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  const publicKey = fs.readFileSync(publicKeyPath, 'utf8');

  // await ssh.connect({
  //   host,
  //   username,
  //   password
  // });

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


// 🧩 Upload and run install script
export async function runBootstrapScript(
  host: string,
  username: string,
  privateKeyPath: string,
): Promise<boolean> {
  const ssh = new NodeSSH();
  const scriptLocalPath = await getAsset("static", "setup-super-simple.sh");
  const scriptRemotePath = "/tmp/setup-super-simple.sh";

  await ssh.connect({
    host,
    username,
    privateKey: fs.readFileSync(privateKeyPath, "utf8"),
    readyTimeout: 20_000,
    // debug: info => console.debug('⎇ SSH DEBUG:', info),
  });
  await ssh.putFile(scriptLocalPath, scriptRemotePath);

  let rebootRequired = false;

  await ssh.exec(
    // run line-buffered
    `stdbuf -oL -eL bash "${scriptRemotePath}"`,
    [],                               // no positional parameters
    {
      cwd: '/tmp',
      stream: 'both',                 // get both stdout and stderr
      execOptions: { pty: true },     // ← THIS is the only change
      onStdout(chunk) {
        const line = chunk.toString().trim();
        console.debug(`[${host}] ${line}`);
        if (line.includes('[REBOOT_NEEDED]')) rebootRequired = true;
      },
      onStderr(chunk) {
        console.warn(`[${host}] ${chunk.toString().trim()}`);
      },
    },
  );

  ssh.dispose();
  return rebootRequired;
}
