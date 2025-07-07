import path from "path";
import { app } from "electron";
import os from "os";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { getOS, getAppPath } from "./utils";

const execFileAsync = promisify(execFile);

/* ---------- AGENT HANDLING ---------- */
export function getAgentSocket(): string | undefined {
    // Standard Un*x → honour whatever the shell exported
    if (process.env.SSH_AUTH_SOCK) return process.env.SSH_AUTH_SOCK;

    // Windows: ssh2 understands the literal string "pageant"                     :contentReference[oaicite:0]{index=0}
    if (process.platform === "win32") return "pageant";

    return undefined;                 // fall back to password / key upload
}

/* ---------- ssh-keygen ---------- */
export async function ensureKeyPair(
    privateKeyPath: string,
    publicKeyPath: string,
): Promise<void> {
    try {
        await fs.promises.access(privateKeyPath);
        await fs.promises.access(publicKeyPath);
        return;                         // already present → nothing to do
    } catch { /* generate below */ }

    const sshKeygen = getOS() === 'win'
        ? `${path.join(process.resourcesPath, "static", "bin", 'ssh-keygen.exe')}`
        : 'ssh-keygen';
    if (!fs.existsSync(sshKeygen)) {
        throw new Error(`ssh-keygen not found at ${sshKeygen}`);
    }
          
    await execFileAsync(
        sshKeygen,
        ["-t", "ed25519", "-f", privateKeyPath, "-N", "", "-q"],
        { windowsHide: true },          // no black terminal on Windows
    );
}

/* ---------- per-OS paths that your callers need ---------- */
export function getKeyDir() {
    // one place under %APPDATA% / ~/.config / ~/Library
    return path.join(app.getPath("userData"), ".ssh");
}
