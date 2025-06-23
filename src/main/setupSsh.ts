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
  const ssh = new NodeSSH();
  // const sshDir = path.join(getAppPath(), ".ssh");
  const sshDir = path.join(app.getPath('userData'), '.ssh');
  const privateKeyPath = path.join(sshDir, "id_rsa");
  const publicKeyPath = path.join(sshDir, "id_rsa.pub");

  if (!fs.existsSync(sshDir)) fs.mkdirSync(sshDir, { recursive: true });

  if (!fs.existsSync(privateKeyPath)) {
    const sshKeygen = getOS() === 'win'
      ? `"${path.join(getAppPath(), 'static', 'bin', 'ssh-keygen.exe')}"`
      : 'ssh-keygen';

    await new Promise<void>((resolve, reject) => {
      exec(`${sshKeygen} -t rsa -b 4096 -f "${privateKeyPath}" -N ""`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  const publicKey = fs.readFileSync(publicKeyPath, 'utf8');

  await ssh.connect({
    host,
    username,
    password
  });

  await ssh.execCommand(`
    mkdir -p ~/.ssh &&
    grep -qxF "${publicKey.trim()}" ~/.ssh/authorized_keys || echo "${publicKey.trim()}" >> ~/.ssh/authorized_keys &&
    chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys
  `);

  ssh.dispose();
}


// 🧩 Upload and run install script
export async function runBootstrapScript(host: string, username: string, privateKeyPath: string): Promise<void> {
  const ssh = new NodeSSH();
  const scriptLocalPath = await getAsset("static", "setup-super-simple.sh");
  const scriptRemotePath = '/tmp/setup-super-simple.sh';

  await ssh.connect({ host, username, privateKey: fs.readFileSync(privateKeyPath, 'utf8') });
  await ssh.putFile(scriptLocalPath, scriptRemotePath);

  console.log(`[${host}] Starting bootstrap…`);
  await ssh.exec(
    `sudo ${scriptRemotePath}`,
    [],                     // no extra args
    {
      cwd: '/tmp',
      onStdout(chunk) { console.log(`[${host}] ${chunk.toString().trim()}`); },
      onStderr(chunk) { console.error(`[${host}] ${chunk.toString().trim()}`); },
    }
  );

  console.log(`[${host}] Bootstrap complete.`);
  ssh.dispose();
}
