/**
 * CredentialManager — Multi-server, multi-user encrypted credential storage
 *
 * Architecture:
 *   - Single JSON vault file per OS user, encrypted at rest via Electron safeStorage
 *   - Credentials keyed by composite key: `${host}\0${share}\0${username}`
 *   - Each credential entry stores: username, encrypted password, metadata
 *   - Passwords NEVER appear in logs, IPC serialization, or process arguments
 *
 * Storage locations (per-platform):
 *   Linux:   ~/.config/houston-client-manager/credentials.vault
 *   macOS:   ~/Library/Application Support/houston-client-manager/credentials.vault
 *   Windows: %APPDATA%/houston-client-manager/credentials.vault
 *
 * Encryption:
 *   - Electron safeStorage encrypts each password individually before storage
 *   - safeStorage uses OS-native keychain/credential-store:
 *       Linux:   libsecret (GNOME Keyring / KWallet)
 *       macOS:   Keychain Services
 *       Windows: DPAPI (Data Protection API)
 *   - The vault file itself is not useful without the logged-in OS user session
 *
 * Backward compatibility:
 *   - importLegacyCredentials() migrates existing plaintext .cred files
 *   - Platform-specific export methods generate the runtime credential files
 *     that cron/Task Scheduler scripts need (fstab entries, .cred files, Keychain)
 *
 * Schema (vault JSON after decryption of individual passwords):
 *   {
 *     "version": 1,
 *     "credentials": {
 *       "fileserver.local\0backups\0alice": {
 *         "host": "fileserver.local",
 *         "share": "backups",
 *         "username": "alice",
 *         "encryptedPassword": "<base64 safeStorage blob>",
 *         "createdAt": "2026-03-13T...",
 *         "updatedAt": "2026-03-13T..."
 *       }
 *     }
 *   }
 */

import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync, execSync } from 'child_process';
import { assertSafeHost, assertSafeShare, assertSafeUsername, shellQuote, toBase64 } from './security';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CredentialEntry {
  host: string;
  share: string;
  username: string;
  /** Base64-encoded safeStorage-encrypted password blob */
  encryptedPassword: string;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialVault {
  version: number;
  credentials: Record<string, CredentialEntry>;
}

export interface PlaintextCredential {
  host: string;
  share: string;
  username: string;
  password: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VAULT_FILENAME = 'credentials.vault';
const VAULT_VERSION = 1;
const KEY_SEPARATOR = '\0';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKey(host: string, share: string, username: string): string {
  return [host.toLowerCase(), share.toLowerCase(), username.toLowerCase()].join(KEY_SEPARATOR);
}

function vaultPath(): string {
  return path.join(app.getPath('userData'), VAULT_FILENAME);
}

function encryptPassword(plaintext: string): string {
  const buf = safeStorage.encryptString(plaintext);
  return buf.toString('base64');
}

function decryptPassword(base64Blob: string): string {
  const buf = Buffer.from(base64Blob, 'base64');
  return safeStorage.decryptString(buf);
}

// ---------------------------------------------------------------------------
// CredentialManager
// ---------------------------------------------------------------------------

export class CredentialManager {
  private vault: CredentialVault;
  private filePath: string;

  constructor() {
    this.filePath = vaultPath();
    this.vault = this.load();
  }

  // ── Persistence ──────────────────────────────────────────────────────

  private load(): CredentialVault {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as CredentialVault;
        if (parsed.version === VAULT_VERSION && parsed.credentials) {
          return parsed;
        }
      }
    } catch {
      // corrupt file — start fresh
    }
    return { version: VAULT_VERSION, credentials: {} };
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write atomically: write to temp then rename
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.vault, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);

    // Ensure restrictive permissions on the final file
    try { fs.chmodSync(this.filePath, 0o600); } catch { /* Windows may not support chmod */ }
  }

  // ── CRUD ─────────────────────────────────────────────────────────────

  /**
   * Store (or update) a credential. The password is encrypted before storage.
   */
  store(host: string, share: string, username: string, password: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS credential encryption is not available. Cannot store credentials securely.');
    }

    const key = makeKey(host, share, username);
    const now = new Date().toISOString();
    const existing = this.vault.credentials[key];

    this.vault.credentials[key] = {
      host,
      share,
      username,
      encryptedPassword: encryptPassword(password),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.save();
  }

  /**
   * Retrieve a credential with decrypted password.
   * Returns null if not found.
   */
  retrieve(host: string, share: string, username: string): PlaintextCredential | null {
    const key = makeKey(host, share, username);
    const entry = this.vault.credentials[key];
    if (!entry) return null;

    return {
      host: entry.host,
      share: entry.share,
      username: entry.username,
      password: decryptPassword(entry.encryptedPassword),
    };
  }

  /**
   * Remove a credential.
   * Returns true if it existed and was removed.
   */
  remove(host: string, share: string, username: string): boolean {
    const key = makeKey(host, share, username);
    if (!(key in this.vault.credentials)) return false;
    delete this.vault.credentials[key];
    this.save();
    return true;
  }

  /**
   * List all stored credentials (without passwords).
   */
  list(): Omit<CredentialEntry, 'encryptedPassword'>[] {
    return Object.values(this.vault.credentials).map(
      ({ encryptedPassword, ...rest }) => rest
    );
  }

  /**
   * List credentials for a specific host.
   */
  listForHost(host: string): Omit<CredentialEntry, 'encryptedPassword'>[] {
    const lowerHost = host.toLowerCase();
    return Object.values(this.vault.credentials)
      .filter(e => e.host.toLowerCase() === lowerHost)
      .map(({ encryptedPassword, ...rest }) => rest);
  }

  /**
   * Get a credential for a host+share, regardless of which user stored it.
   * Useful when only one credential exists per share.
   * Returns the first match.
   */
  findByHostAndShare(host: string, share: string): PlaintextCredential | null {
    const lowerHost = host.toLowerCase();
    const lowerShare = share.toLowerCase();

    for (const entry of Object.values(this.vault.credentials)) {
      if (entry.host.toLowerCase() === lowerHost && entry.share.toLowerCase() === lowerShare) {
        return {
          host: entry.host,
          share: entry.share,
          username: entry.username,
          password: decryptPassword(entry.encryptedPassword),
        };
      }
    }
    return null;
  }

  /**
   * Check if any credential exists for a given host+share.
   */
  has(host: string, share: string, username?: string): boolean {
    if (username) {
      return makeKey(host, share, username) in this.vault.credentials;
    }
    const lowerHost = host.toLowerCase();
    const lowerShare = share.toLowerCase();
    return Object.values(this.vault.credentials).some(
      e => e.host.toLowerCase() === lowerHost && e.share.toLowerCase() === lowerShare
    );
  }

  // ── Legacy Migration ─────────────────────────────────────────────────

  /**
   * Import credentials from legacy plaintext .cred files.
   * Call once during app startup migration.
   *
   * Linux:   /etc/samba/houston-credentials/*.cred
   * Windows: C:\ProgramData\houston-backups\credentials\*.cred
   * macOS:   Keychain entries with "houston-smb-" prefix (skipped — already encrypted)
   *
   * Returns number of credentials imported.
   */
  importLegacyCredentials(): number {
    const platform = os.platform();
    let imported = 0;

    if (platform === 'linux') {
      imported = this.importLegacyLinux();
    } else if (platform === 'win32') {
      imported = this.importLegacyWindows();
    }
    // macOS: Keychain is already secure; no migration needed

    return imported;
  }

  private importLegacyLinux(): number {
    const credDir = '/etc/samba/houston-credentials';
    if (!fs.existsSync(credDir)) return 0;

    let imported = 0;
    const files = fs.readdirSync(credDir).filter(f => f.endsWith('.cred'));

    for (const file of files) {
      try {
        const share = file.replace(/\.cred$/, '');
        const content = fs.readFileSync(path.join(credDir, file), 'utf-8');
        const usernameMatch = content.match(/^username=(.+)$/m);
        const passwordMatch = content.match(/^password=(.+)$/m);

        if (usernameMatch && passwordMatch) {
          // We need host from fstab to complete the key
          const host = this.findHostForShareInFstab(share);
          if (host) {
            // Only import if not already in vault
            if (!this.has(host, share, usernameMatch[1])) {
              this.store(host, share, usernameMatch[1], passwordMatch[1]);
              imported++;
            }
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return imported;
  }

  private importLegacyWindows(): number {
    const credDir = path.join(
      process.env.ProgramData || 'C:\\ProgramData',
      'houston-backups', 'credentials'
    );
    if (!fs.existsSync(credDir)) return 0;

    let imported = 0;
    const files = fs.readdirSync(credDir).filter(f => f.endsWith('.cred'));

    for (const file of files) {
      try {
        const share = file.replace(/\.cred$/, '');
        const content = fs.readFileSync(path.join(credDir, file), 'utf-8');
        const usernameMatch = content.match(/^username=(.+)$/m);
        const passwordMatch = content.match(/^password=(.+)$/m);

        if (usernameMatch && passwordMatch) {
          // On Windows, try to find host from scheduled tasks or use share name as fallback
          // For now, import with share as a placeholder host (will be corrected on next use)
          if (!this.has(share, share, usernameMatch[1])) {
            this.store(share, share, usernameMatch[1], passwordMatch[1]);
            imported++;
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return imported;
  }

  private findHostForShareInFstab(share: string): string | null {
    try {
      const fstab = fs.readFileSync('/etc/fstab', 'utf-8');
      // Match: //hostname/sharename ... credentials=.../sharename.cred
      const rx = new RegExp(`^//([^/\\s]+)/${share}\\s`, 'm');
      const m = rx.exec(fstab);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }

  // ── Platform Export (for unattended backup execution) ─────────────────

  /**
   * Export a credential to the platform-native format that cron/Task Scheduler
   * scripts need at runtime. This writes the minimal runtime credential file.
   *
   * This is called by BackupManager when scheduling a task, replacing the
   * old ensureFstabEntry() credential-writing logic.
   */
  exportForRuntime(host: string, share: string, username: string): void {
    const cred = this.retrieve(host, share, username);
    if (!cred) {
      throw new Error(`No stored credential for ${username}@${host}/${share}`);
    }

    const platform = os.platform();
    if (platform === 'linux') {
      this.exportLinuxCredFile(cred);
    } else if (platform === 'win32') {
      this.exportWindowsCredFile(cred);
    } else if (platform === 'darwin') {
      this.exportMacKeychain(cred);
    }
  }

  private exportLinuxCredFile(cred: PlaintextCredential): void {
    // This still writes the runtime .cred file that fstab references,
    // but now keyed by host+share+user to avoid collisions
    const credDir = '/etc/samba/houston-credentials';
    const credFile = path.join(credDir, `${cred.host}_${cred.share}_${cred.username}.cred`);

    // Build a helper script that pkexec can run
    const safeHost = assertSafeHost(cred.host);
    const safeShare = assertSafeShare(cred.share);
    const safeUser = assertSafeUsername(cred.username);
    const passwordB64 = toBase64(cred.password);
    const localUser = os.userInfo().username;

    const tempScript = `/tmp/houston_cred_export_${safeHost}_${safeShare}.sh`;
    const scriptContent = `#!/bin/bash
set -euo pipefail
mkdir -p ${shellQuote(credDir)}
chmod 700 ${shellQuote(credDir)}
PASSWORD="$(printf '%s' ${shellQuote(passwordB64)} | base64 --decode)"
printf 'username=%s\\n' ${shellQuote(safeUser)} > ${shellQuote(credFile)}
printf 'password=%s\\n' "$PASSWORD" >> ${shellQuote(credFile)}
chown ${localUser}:${localUser} ${shellQuote(credFile)}
chmod 600 ${shellQuote(credFile)}
`;

    fs.writeFileSync(tempScript, scriptContent, { mode: 0o700 });
    execFileSync('pkexec', ['bash', tempScript]);

    // Clean up temp script
    try { fs.unlinkSync(tempScript); } catch { /* best effort */ }
  }

  private exportWindowsCredFile(cred: PlaintextCredential): void {
    const credDir = path.join(
      process.env.ProgramData || 'C:\\ProgramData',
      'houston-backups', 'credentials'
    );
    if (!fs.existsSync(credDir)) {
      fs.mkdirSync(credDir, { recursive: true });
    }

    const credFile = path.join(credDir, `${cred.host}_${cred.share}_${cred.username}.cred`);
    const content = `username=${cred.username}\npassword=${cred.password}\n`;
    fs.writeFileSync(credFile, content, { mode: 0o600 });
  }

  private exportMacKeychain(cred: PlaintextCredential): void {

    const svc = `houston-smb-${cred.host}-${cred.share}`;

    // Remove old entry if present, then add new
    execSync(
      `security delete-generic-password -s ${shellQuote(svc)} -a ${shellQuote(cred.username)} 2>/dev/null || true`
    );

    // Use stdin to pass password (avoids ps visibility)
    execSync(
      `security add-generic-password -s ${shellQuote(svc)} -a ${shellQuote(cred.username)} -w -U`,
      { input: cred.password }
    );
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: CredentialManager | null = null;

export function getCredentialManager(): CredentialManager {
  if (!instance) {
    instance = new CredentialManager();
  }
  return instance;
}
