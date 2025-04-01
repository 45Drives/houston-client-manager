import { exec } from "child_process";
import path from "path";
import fs from "fs";
import { Server } from "./types";
import { Client } from 'ssh2';
import { getAppPath, getOS } from "./utils";

const username = "root";
const password = "password";

// Paths
export async function setupSsh(server: Server) {
  // Determine the base path
  let basePath = getAppPath();

  const cwRsyncPath = path.join(basePath,  "cwrsync");
  const sshKeyPath = path.join(basePath,  ".ssh", "id_rsa");
  const sshKeyPubPath = path.join(basePath,  ".ssh", "id_rsa.pub");
  const ssh_keygen = getOS() === "win" ? `"${path.join(cwRsyncPath, "bin", "ssh-keygen.exe")}"` : "ssh-keygen";

  // Ensure .ssh directory exists
  const sshDir = path.join(basePath,  ".ssh");
  if (!fs.existsSync(sshDir)) {
    fs.mkdirSync(sshDir, { recursive: true });
  }

  // Generate SSH key if it doesn’t exist
  if (!fs.existsSync(sshKeyPath)) {
    console.log("Generating SSH Key...", sshKeyPath);
    
    exec(
      `${ssh_keygen} -t rsa -b 4096 -f "${sshKeyPath}" -N ""`,
      { cwd: cwRsyncPath },
      (error, stdout, stderr) => {
        if (error) {
          console.error(`Error generating SSH key: ${error.message}`);
          return;
        }
        console.log("SSH key generated successfully!");
        console.log(stdout);

        putPublicKeyOnServer(server, sshKeyPubPath, sshKeyPath);
      }
    );
  } else {
    putPublicKeyOnServer(server, sshKeyPubPath, sshKeyPath);
  }
}
function putPublicKeyOnServer(server: Server, publicKeyPath: string, privateKeyPath) {
  // Read the public key
  const publicKey = fs.readFileSync(publicKeyPath, 'utf8').trim();
  const privateKey = fs.readFileSync(privateKeyPath, 'utf8').trim();

  const host = server.ip;
  // Initialize the SSH client
  const conn = new Client();

  console.log("publickey:", publicKey);
  conn.on('ready', () => {
    console.log('SSH connection established!');

    // Command to create the .ssh directory and add the public key to authorized_keys
    const command = `
    mkdir -p ~/.ssh && 
    grep -qxF "${publicKey}" ~/.ssh/authorized_keys || echo "${publicKey}" >> ~/.ssh/authorized_keys && 
    chmod 700 ~/.ssh && 
    chmod 600 ~/.ssh/authorized_keys
    `;

    conn.exec(command, (err, stream) => {
      if (err) {
        console.error('Error executing command:', err);
        return;
      }

      stream.on('close', (code, signal) => {
        if (code === 0) {
          console.log('Public key added to authorized_keys successfully!');
        } else {
          console.log(`Command failed with exit code ${code}`);
        }

        // End the SSH session
        conn.end();
      });

      // Log any error output
      stream.on('data', (data) => {
        console.log('STDOUT:', data.toString());
      });
      stream.stderr.on('data', (data) => {
        console.error('STDERR:', data.toString());
      });
    });
  }).on('error', (err) => {
    console.error('SSH connection error:', err);
  }).connect({
    host,
    port: 22,
    username,
    password,
    privateKey
  });
}

