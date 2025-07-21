import path from "path";
import { app } from "electron";
import os from "os";
import fs from "fs";
import { execFile, spawnSync } from "child_process";
import { promisify } from "util";
import { getOS, getAppPath, getAsset } from "./utils";

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
export async function ensureKeyPair(pk: string, pub: string) {
    try {
        await fs.promises.access(pk);
        await fs.promises.access(pub);
        return;
    } catch { /* fall through to generate */ }

    const sshKeygen = getOS() === 'win'
        ? await getAsset('static/bin', 'ssh-keygen.exe')
        : 'ssh-keygen';

    if (getOS() !== 'win') {
        const which = spawnSync('which', [sshKeygen]);
        if (which.status !== 0) {
            throw new Error(`ssh-keygen binary not found in $PATH`);
        }
    } else if (!fs.existsSync(sshKeygen)) {
        throw new Error(`ssh-keygen.exe not found at ${sshKeygen}`);
    }

    await execFileAsync(
        sshKeygen,
        ['-t', 'rsa', '-b', '4096', '-f', pk, '-N', '', '-q'],
        { windowsHide: true }
    );
}


/* ---------- per-OS paths that your callers need ---------- */
export function getKeyDir() {
    // one place under %APPDATA% / ~/.config / ~/Library
    return path.join(app.getPath("userData"), ".ssh");
}
