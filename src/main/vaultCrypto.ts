/**
 * Vault field encryption with a keyring-optional fallback.
 *
 * Preferred backend is Electron safeStorage (libsecret / Keychain / DPAPI).
 * That requires a reachable, unlocked OS credential store, which is not a given:
 * minimal Linux desktops, i3/sway sessions, auto-login users whose login keyring
 * never gets unlocked by PAM, sandboxed launches without a session bus, and
 * SSH/headless starts all report encryption as unavailable.
 *
 * Rather than refusing to save anything in that case, we fall back to AES-256-GCM
 * under a 0600 key file in userData. That is weaker than an OS keychain — anyone
 * who can read the user's files can read the key — but it is the same threat model
 * as the 0600 .cred files this app already writes for unattended backups, and it
 * keeps saved servers and scheduled backups working.
 *
 * Blob formats:
 *   "<base64>"            → safeStorage blob (unprefixed, unchanged from v3 vaults)
 *   "aesgcm1:<base64>"    → iv(12) || tag(16) || ciphertext, file-key backend
 */

import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export type VaultCryptoBackend = 'os' | 'file' | 'none';

export interface VaultCryptoStatus {
  /** Backend that new secrets will be written with. */
  backend: VaultCryptoBackend;
  /** Whether the OS keychain is usable right now. */
  osEncryptionAvailable: boolean;
  /** Chromium's selected store on Linux (gnome-libsecret, kwallet6, basic_text, ...). */
  osStorageBackend?: string;
  /** Absolute path of the fallback key file, when the fallback is in use. */
  keyFilePath?: string;
  /** Why the fallback (or nothing at all) is in use. */
  reason?: string;
}

const KEY_FILENAME = 'vault.key';
const FILE_PREFIX = 'aesgcm1:';
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;
let keyError = '';

function keyFilePath(): string {
  return path.join(app.getPath('userData'), KEY_FILENAME);
}

function loadOrCreateFileKey(): Buffer | null {
  if (cachedKey) return cachedKey;

  const file = keyFilePath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });

    if (fs.existsSync(file)) {
      const key = Buffer.from(fs.readFileSync(file, 'utf-8').trim(), 'base64');
      if (key.length === KEY_LEN) {
        try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
        cachedKey = key;
        return cachedKey;
      }
      // A truncated/foreign key can never decrypt existing blobs; keep it for forensics
      // and start over so the user can at least re-save credentials.
      try { fs.renameSync(file, `${file}.bad-${Date.now()}`); } catch { /* best effort */ }
    }

    const key = randomBytes(KEY_LEN);
    fs.writeFileSync(file, key.toString('base64'), { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
    cachedKey = key;
    keyError = '';
    return cachedKey;
  } catch (e: any) {
    keyError = `fallback key file unavailable: ${e?.message || e}`;
    return null;
  }
}

function osEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function osStorageBackend(): string | undefined {
  try {
    return typeof safeStorage.getSelectedStorageBackend === 'function'
      ? safeStorage.getSelectedStorageBackend()
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Probed on every call rather than cached — a keyring can become available after
 * launch (user unlocks the wallet, agent starts late) and we want to upgrade.
 */
export function getVaultBackend(): VaultCryptoBackend {
  if (osEncryptionAvailable()) return 'os';
  return loadOrCreateFileKey() ? 'file' : 'none';
}

export function getVaultCryptoStatus(): VaultCryptoStatus {
  const osAvailable = osEncryptionAvailable();
  const backend: VaultCryptoBackend = osAvailable ? 'os' : (loadOrCreateFileKey() ? 'file' : 'none');

  const status: VaultCryptoStatus = {
    backend,
    osEncryptionAvailable: osAvailable,
    osStorageBackend: osStorageBackend(),
  };

  if (backend === 'file') {
    status.keyFilePath = keyFilePath();
    status.reason = 'No OS credential store is available; credentials are encrypted with a local key file readable only by this user.';
  } else if (backend === 'none') {
    status.reason = keyError || 'No OS credential store and no writable fallback key file.';
  }

  return status;
}

export function isVaultEncryptionAvailable(): boolean {
  return getVaultBackend() !== 'none';
}

/** True when the blob was written by the fallback backend. */
export function isFileBackedBlob(blob: string): boolean {
  return blob.startsWith(FILE_PREFIX);
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return '';

  if (osEncryptionAvailable()) {
    return safeStorage.encryptString(plaintext).toString('base64');
  }

  const key = loadOrCreateFileKey();
  if (!key) {
    throw new Error(
      `Cannot store credentials securely: no OS credential store is available and the fallback key file could not be created (${keyError}).`
    );
  }

  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  return FILE_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

/**
 * Returns "" when a blob cannot be read — e.g. an OS-encrypted vault opened in a
 * session that lost its keyring. Callers treat that as "no saved credential" and
 * fall back to prompting, which beats crashing the IPC handler.
 */
export function decryptSecret(blob: string): string {
  if (!blob) return '';

  try {
    if (isFileBackedBlob(blob)) {
      const key = loadOrCreateFileKey();
      if (!key) return '';
      const raw = Buffer.from(blob.slice(FILE_PREFIX.length), 'base64');
      const iv = raw.subarray(0, IV_LEN);
      const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
      const ciphertext = raw.subarray(IV_LEN + TAG_LEN);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
    }

    if (!osEncryptionAvailable()) return '';
    return safeStorage.decryptString(Buffer.from(blob, 'base64'));
  } catch {
    return '';
  }
}

/** Test seam — drops the in-memory key so the next call re-reads from disk. */
export function resetVaultCryptoCache(): void {
  cachedKey = null;
  keyError = '';
}
