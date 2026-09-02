/**
 * CredentialManager v3 — Flat server record model
 *
 * One record per server. Each record holds:
 *   - Server identity (hostname + IP, synced from discovery)
 *   - Admin/cockpit login credentials (loginUser + loginPass)
 *   - SMB credentials for local backups (smbShare + smbUser + smbPass)
 *   - Metadata (displayName, favorite, source, setupComplete, etc.)
 *
 * Storage locations (per-platform):
 *   Linux:   ~/.config/houston-client-manager/credentials.vault
 *   macOS:   ~/Library/Application Support/houston-client-manager/credentials.vault
 *   Windows: %APPDATA%/houston-client-manager/credentials.vault
 *
 * Encryption:
 *   Electron safeStorage encrypts each password individually before storage.
 *   Uses OS-native keychain/credential-store (libsecret / Keychain / DPAPI).
 *   Passwords NEVER appear in logs, IPC serialization, or process arguments.
 *
 * Schema (vault JSON):
 *   {
 *     "version": 3,
 *     "servers": {
 *       "<uuid>": {
 *         "id": "<uuid>",
 *         "hostname": "f8x1.local",
 *         "ip": "192.168.207.49",
 *         "displayName": "f8x1",
 *         "loginUser": "root",
 *         "loginPass": "<base64 safeStorage>",
 *         "smbShare": "storage",
 *         "smbUser": "jimmy",
 *         "smbPass": "<base64 safeStorage>",
 *         "source": "wizard",
 *         "setupComplete": true,
 *         "favorite": true,
 *         "lastUsedAt": 1720000000000,
 *         "createdAt": "...", "updatedAt": "..."
 *       }
 *     }
 *   }
 */

import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync, execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { assertSafeHost, assertSafeShare, assertSafeUsername, shellQuote, toBase64 } from './security';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ServerSource = 'discovered' | 'manual' | 'wizard';

export interface ServerRecord {
  id: string;
  hostname: string;       // mDNS/DNS name, can be ""
  ip: string;             // IP address, can be ""
  displayName: string;    // User-facing name
  // Admin/cockpit login
  loginUser: string;
  loginPass: string;      // Encrypted (safeStorage base64 blob)
  // SSH key auth (alternative to password)
  sshKeyPath: string;     // Absolute path to user-supplied private key file (or "")
  sshPassphrase: string;  // Encrypted passphrase for the key (or "")
  // SMB for local backups
  smbShare: string;       // Share name (e.g. "storage")
  smbUser: string;        // SMB username (may differ from loginUser)
  smbPass: string;        // Encrypted (safeStorage base64 blob)
  // Metadata
  source: ServerSource;
  setupComplete: boolean;
  favorite: boolean;
  lastUsedAt: number;
  createdAt: string;
  updatedAt: string;
}

/** What the renderer/IPC sees (no passwords) */
export interface ServerInfo {
  id: string;
  hostname: string;
  ip: string;
  displayName: string;
  loginUser: string;
  sshKeyPath: string;
  smbShare: string;
  smbUser: string;
  source: ServerSource;
  setupComplete: boolean;
  favorite: boolean;
  lastUsedAt: number;
  createdAt: string;
  updatedAt: string;
}

/** Plaintext credential for retrieve()/findByHostAndShare() compat */
export interface PlaintextCredential {
  host: string;
  share: string;
  username: string;
  password: string;
}

/** Legacy v1 credential entry (for migration) */
interface LegacyCredentialEntry {
  host: string;
  share: string;
  username: string;
  encryptedPassword: string;
  createdAt: string;
  updatedAt: string;
  name?: string;
  favorite?: boolean;
  lastUsedAt?: number;
}

interface LegacyVault {
  version: 1;
  credentials: Record<string, LegacyCredentialEntry>;
}

/** v2 SMB credential entry (for migration from v2) */
interface V2SmbCredentialEntry {
  host: string;
  share: string;
  username: string;
  encryptedPassword: string;
  createdAt: string;
  updatedAt: string;
}

interface V2Vault {
  version: 2;
  servers: Record<string, {
    id: string;
    hostname: string;
    ip: string;
    displayName: string;
    loginUser: string;
    loginPass: string;
    smbShare: string;
    source: ServerSource;
    setupComplete: boolean;
    favorite: boolean;
    lastUsedAt: number;
    createdAt: string;
    updatedAt: string;
  }>;
  credentials: Record<string, V2SmbCredentialEntry>;
}

export interface CredentialVault {
  version: number;
  servers: Record<string, ServerRecord>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VAULT_FILENAME = 'credentials.vault';
const VAULT_VERSION = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function vaultPath(): string {
  return path.join(app.getPath('userData'), VAULT_FILENAME);
}

function encryptPassword(plaintext: string): string {
  if (!plaintext) return '';
  const buf = safeStorage.encryptString(plaintext);
  return buf.toString('base64');
}

function decryptPassword(base64Blob: string): string {
  if (!base64Blob) return '';
  const buf = Buffer.from(base64Blob, 'base64');
  return safeStorage.decryptString(buf);
}

function isIpAddress(s: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s);
}

/** mDNS reports "host.local." while records often hold the bare hostname — compare them equal. */
function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '').replace(/\.local$/, '');
}

function hostMatches(server: ServerRecord, hostOrIp: string): boolean {
  const key = normalizeHost(hostOrIp);
  if (!key) return false;
  if (server.ip && normalizeHost(server.ip) === key) return true;
  if (server.hostname && normalizeHost(server.hostname) === key) return true;
  return false;
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
        const parsed = JSON.parse(raw);

        if (parsed.version === VAULT_VERSION && parsed.servers) {
          return parsed as CredentialVault;
        }

        // Migrate from v2
        if (parsed.version === 2 && parsed.servers) {
          const migrated = this.migrateFromV2(parsed as V2Vault);
          this.vault = migrated;
          this.filePath = vaultPath();
          this.save();
          return migrated;
        }

        // Migrate from v1
        if (parsed.version === 1 && parsed.credentials) {
          const migrated = this.migrateFromV1(parsed as LegacyVault);
          this.vault = migrated;
          this.filePath = vaultPath();
          this.save();
          return migrated;
        }
      }
    } catch {
      // corrupt file — start fresh
    }
    return { version: VAULT_VERSION, servers: {} };
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.vault, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
    try { fs.chmodSync(this.filePath, 0o600); } catch { /* Windows */ }
  }

  // ── Migration from v2 ───────────────────────────────────────────────

  private migrateFromV2(v2: V2Vault): CredentialVault {
    const newVault: CredentialVault = { version: VAULT_VERSION, servers: {} };

    for (const old of Object.values(v2.servers)) {
      // Find the best SMB credential for this server from the v2 credentials map
      const serverHosts = [old.hostname, old.ip].filter(Boolean).map(h => h.toLowerCase());
      let smbUser = '';
      let smbPass = '';
      let smbShare = old.smbShare || '';

      // Search credentials map for matching SMB entry
      for (const cred of Object.values(v2.credentials || {})) {
        if (!serverHosts.includes(cred.host.toLowerCase())) continue;
        if (cred.share === '*') continue; // wildcard = login cred, not SMB
        // Prefer entry whose share matches the server's smbShare
        if (smbShare && cred.share.toLowerCase() === smbShare.toLowerCase()) {
          smbUser = cred.username;
          smbPass = cred.encryptedPassword;
          break;
        }
        // Otherwise take first real share match
        if (!smbUser) {
          smbShare = cred.share;
          smbUser = cred.username;
          smbPass = cred.encryptedPassword;
        }
      }

      newVault.servers[old.id] = {
        id: old.id,
        hostname: old.hostname,
        ip: old.ip,
        displayName: old.displayName,
        loginUser: old.loginUser,
        loginPass: old.loginPass,
        sshKeyPath: '',
        sshPassphrase: '',
        smbShare,
        smbUser,
        smbPass,
        source: old.source,
        setupComplete: old.setupComplete,
        favorite: old.favorite,
        lastUsedAt: old.lastUsedAt,
        createdAt: old.createdAt,
        updatedAt: old.updatedAt,
      };
    }

    return newVault;
  }

  // ── Migration from v1 ───────────────────────────────────────────────

  private migrateFromV1(legacy: LegacyVault): CredentialVault {
    const entries = Object.values(legacy.credentials);
    const newVault: CredentialVault = { version: VAULT_VERSION, servers: {} };

    // Group entries by host (case-insensitive)
    const byHost = new Map<string, LegacyCredentialEntry[]>();
    for (const e of entries) {
      const key = e.host.toLowerCase();
      const list = byHost.get(key) ?? [];
      list.push(e);
      byHost.set(key, list);
    }

    for (const [, group] of byHost) {
      const sorted = [...group].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
      const wildcards = sorted.filter(e => e.share === '*');
      const realShares = sorted.filter(e => e.share !== '*');

      // Login creds: prefer wildcard entry, else most recent
      const loginEntry = wildcards[0] ?? sorted[0];
      // SMB creds: first real share entry
      const smbEntry = realShares[0];

      const host = loginEntry.host;
      const id = randomUUID();
      const now = new Date().toISOString();

      const server: ServerRecord = {
        id,
        hostname: isIpAddress(host) ? '' : host,
        ip: isIpAddress(host) ? host : '',
        displayName: group.find(e => e.name)?.name || '',
        loginUser: loginEntry.username,
        loginPass: loginEntry.encryptedPassword,
        sshKeyPath: '',
        sshPassphrase: '',
        smbShare: smbEntry?.share || '',
        smbUser: smbEntry?.username || '',
        smbPass: smbEntry?.encryptedPassword || '',
        source: 'manual',
        setupComplete: false,
        favorite: group.some(e => e.favorite),
        lastUsedAt: Math.max(...group.map(e => e.lastUsedAt ?? 0)),
        createdAt: group.map(e => e.createdAt).filter(Boolean).sort()[0] || now,
        updatedAt: now,
      };
      newVault.servers[id] = server;
    }

    return newVault;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SERVER REGISTRY
  // ═══════════════════════════════════════════════════════════════════════

  findServer(hostOrIp: string): ServerRecord | null {
    if (!hostOrIp) return null;
    for (const s of Object.values(this.vault.servers)) {
      if (hostMatches(s, hostOrIp)) return s;
    }
    return null;
  }

  getServer(id: string): ServerRecord | null {
    return this.vault.servers[id] ?? null;
  }

  listServersInfo(): ServerInfo[] {
    return Object.values(this.vault.servers).map(s => ({
      id: s.id,
      hostname: s.hostname,
      ip: s.ip,
      displayName: s.displayName,
      loginUser: s.loginUser,
      sshKeyPath: s.sshKeyPath || '',
      smbShare: s.smbShare,
      smbUser: s.smbUser,
      source: s.source,
      setupComplete: s.setupComplete,
      favorite: s.favorite,
      lastUsedAt: s.lastUsedAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  addServer(opts: {
    hostname?: string;
    ip?: string;
    displayName?: string;
    loginUser?: string;
    loginPass?: string;
    sshKeyPath?: string;
    sshPassphrase?: string;
    smbShare?: string;
    smbUser?: string;
    smbPass?: string;
    source?: ServerSource;
    setupComplete?: boolean;
    favorite?: boolean;
  }): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS credential encryption is not available. Cannot store credentials securely.');
    }

    // Dedup: check if server already exists
    let existing: ServerRecord | null = null;
    if (opts.ip) existing = this.findServer(opts.ip);
    if (!existing && opts.hostname) existing = this.findServer(opts.hostname);

    if (existing) {
      const changes: Parameters<typeof this.updateServer>[1] = {};
      if (opts.hostname) changes.hostname = opts.hostname;
      if (opts.ip && !existing.ip) changes.ip = opts.ip;
      if (opts.displayName !== undefined) changes.displayName = opts.displayName;
      // Never blank an existing SSH login just because an SMB-only caller omitted it
      if (opts.loginUser) changes.loginUser = opts.loginUser;
      if (opts.loginPass) changes.loginPass = opts.loginPass;
      if (opts.sshKeyPath !== undefined) changes.sshKeyPath = opts.sshKeyPath;
      if (opts.sshPassphrase !== undefined) changes.sshPassphrase = opts.sshPassphrase;
      if (opts.smbShare !== undefined) changes.smbShare = opts.smbShare;
      if (opts.smbUser !== undefined) changes.smbUser = opts.smbUser;
      if (opts.smbPass !== undefined) changes.smbPass = opts.smbPass;
      if (opts.source !== undefined) changes.source = opts.source;
      if (opts.setupComplete !== undefined) changes.setupComplete = opts.setupComplete;
      if (opts.favorite !== undefined) changes.favorite = opts.favorite;
      return this.updateServer(existing.id, changes);
    }

    const now = new Date().toISOString();
    const id = randomUUID();

    this.vault.servers[id] = {
      id,
      hostname: opts.hostname || '',
      ip: opts.ip || '',
      displayName: opts.displayName || '',
      loginUser: opts.loginUser || '',
      loginPass: opts.loginPass ? encryptPassword(opts.loginPass) : '',
      sshKeyPath: opts.sshKeyPath || '',
      sshPassphrase: opts.sshPassphrase ? encryptPassword(opts.sshPassphrase) : '',
      smbShare: opts.smbShare || '',
      smbUser: opts.smbUser || '',
      smbPass: opts.smbPass ? encryptPassword(opts.smbPass) : '',
      source: opts.source || 'manual',
      setupComplete: opts.setupComplete ?? false,
      favorite: opts.favorite ?? false,
      lastUsedAt: Date.now(),
      createdAt: now,
      updatedAt: now,
    };
    this.save();
    return id;
  }

  updateServer(id: string, update: {
    hostname?: string;
    ip?: string;
    displayName?: string;
    loginUser?: string;
    loginPass?: string;
    sshKeyPath?: string;
    sshPassphrase?: string;
    smbShare?: string;
    smbUser?: string;
    smbPass?: string;
    source?: ServerSource;
    setupComplete?: boolean;
    favorite?: boolean;
  }): string {
    const s = this.vault.servers[id];
    if (!s) throw new Error(`Server not found: ${id}`);

    if (update.hostname !== undefined) s.hostname = update.hostname;
    if (update.ip !== undefined) s.ip = update.ip;
    if (update.displayName !== undefined) s.displayName = update.displayName;
    if (update.loginUser !== undefined) s.loginUser = update.loginUser;
    if (update.loginPass !== undefined) s.loginPass = encryptPassword(update.loginPass);
    if (update.sshKeyPath !== undefined) s.sshKeyPath = update.sshKeyPath;
    if (update.sshPassphrase !== undefined) s.sshPassphrase = update.sshPassphrase ? encryptPassword(update.sshPassphrase) : '';
    if (update.smbShare !== undefined) s.smbShare = update.smbShare;
    if (update.smbUser !== undefined) s.smbUser = update.smbUser;
    if (update.smbPass !== undefined) s.smbPass = encryptPassword(update.smbPass);
    if (update.source !== undefined) s.source = update.source;
    if (update.setupComplete !== undefined) s.setupComplete = update.setupComplete;
    if (update.favorite !== undefined) s.favorite = update.favorite;

    s.lastUsedAt = Date.now();
    s.updatedAt = new Date().toISOString();
    this.save();
    return id;
  }

  removeServer(id: string): boolean {
    if (!this.vault.servers[id]) return false;
    delete this.vault.servers[id];
    this.save();
    return true;
  }

  setFavorite(id: string, fav: boolean): void {
    const s = this.vault.servers[id];
    if (s) { s.favorite = fav; this.save(); }
  }

  setName(id: string, name: string): void {
    const s = this.vault.servers[id];
    if (s) { s.displayName = name || ''; this.save(); }
  }

  setDisplayName(id: string, name: string): void {
    this.setName(id, name);
  }

  touch(id: string): void {
    const s = this.vault.servers[id];
    if (s) { s.lastUsedAt = Date.now(); this.save(); }
  }

  /**
   * Get admin/cockpit login credentials for a server.
   */
  getLoginCredentials(hostOrIp: string): { id: string; username: string; password: string; sshKeyPath?: string; sshPassphrase?: string } | null {
    const s = this.findServer(hostOrIp);
    if (!s || !s.loginUser) return null;
    return {
      id: s.id,
      username: s.loginUser,
      password: decryptPassword(s.loginPass),
      sshKeyPath: s.sshKeyPath || undefined,
      sshPassphrase: s.sshPassphrase ? decryptPassword(s.sshPassphrase) : undefined,
    };
  }

  /**
   * Get SMB credentials for a server (for local backup mounts).
   */
  getSmbCredentials(hostOrIp: string): { id: string; share: string; username: string; password: string } | null {
    const s = this.findServer(hostOrIp);
    if (!s || !s.smbUser || !s.smbPass) return null;
    return { id: s.id, share: s.smbShare, username: s.smbUser, password: decryptPassword(s.smbPass) };
  }

  // ── Discovery sync ──────────────────────────────────────────────────

  syncDiscovery(hostname: string, ip: string, opts?: { shareName?: string; setupComplete?: boolean }): void {
    const byHostname = hostname ? this.findServer(hostname) : null;
    const byIp = ip ? this.findServer(ip) : null;

    if (byHostname && byIp && byHostname.id !== byIp.id) {
      // Two records for same machine — merge them
      this.mergeServers(byHostname.id, byIp.id);
      const merged = this.vault.servers[byHostname.id];
      if (merged) {
        if (!merged.hostname) merged.hostname = hostname;
        if (!merged.ip) merged.ip = ip;
        // The server reports its current share, so a re-setup renaming it wins.
        if (opts?.shareName && merged.smbShare !== opts.shareName) merged.smbShare = opts.shareName;
        if (opts?.setupComplete !== undefined) merged.setupComplete = opts.setupComplete;
        merged.updatedAt = new Date().toISOString();
        this.save();
      }
    } else if (byHostname) {
      let changed = false;
      if (ip && !byHostname.ip) { byHostname.ip = ip; changed = true; }
      if (opts?.shareName && byHostname.smbShare !== opts.shareName) { byHostname.smbShare = opts.shareName; changed = true; }
      if (opts?.setupComplete !== undefined && byHostname.setupComplete !== opts.setupComplete) {
        byHostname.setupComplete = opts.setupComplete; changed = true;
      }
      if (changed) { byHostname.updatedAt = new Date().toISOString(); this.save(); }
    } else if (byIp) {
      let changed = false;
      if (hostname && byIp.hostname !== hostname) { byIp.hostname = hostname; changed = true; }
      if (opts?.shareName && byIp.smbShare !== opts.shareName) { byIp.smbShare = opts.shareName; changed = true; }
      if (opts?.setupComplete !== undefined && byIp.setupComplete !== opts.setupComplete) {
        byIp.setupComplete = opts.setupComplete; changed = true;
      }
      if (changed) { byIp.updatedAt = new Date().toISOString(); this.save(); }
    }
  }

  private mergeServers(keepId: string, mergeId: string): void {
    const keep = this.vault.servers[keepId];
    const merge = this.vault.servers[mergeId];
    if (!keep || !merge) return;

    if (!keep.hostname && merge.hostname) keep.hostname = merge.hostname;
    if (!keep.ip && merge.ip) keep.ip = merge.ip;
    if (!keep.displayName && merge.displayName) keep.displayName = merge.displayName;
    if (!keep.loginUser && merge.loginUser) {
      keep.loginUser = merge.loginUser;
      keep.loginPass = merge.loginPass;
    }
    if (!keep.smbShare && merge.smbShare) keep.smbShare = merge.smbShare;
    if (!keep.smbUser && merge.smbUser) {
      keep.smbUser = merge.smbUser;
      keep.smbPass = merge.smbPass;
    }
    keep.favorite = keep.favorite || merge.favorite;
    keep.lastUsedAt = Math.max(keep.lastUsedAt, merge.lastUsedAt);
    if (merge.setupComplete) keep.setupComplete = true;

    delete this.vault.servers[mergeId];
    this.save();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CREDENTIAL RESOLUTION — used by backup handlers
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * retrieve(host, share, user) — resolve credentials for backup operations.
   * Returns SMB creds if share matches, otherwise falls back to login creds.
   */
  retrieve(host: string, share: string, username: string): PlaintextCredential | null {
    const server = this.findServer(host);
    if (!server) return null;

    // If asking for SMB creds and we have them
    if (share && share !== '*' && server.smbUser && server.smbPass) {
      if (!username || server.smbUser.toLowerCase() === username.toLowerCase()) {
        const pass = decryptPassword(server.smbPass);
        if (pass) return { host, share: server.smbShare, username: server.smbUser, password: pass };
      }
    }

    // Fall back to login credentials (if username matches or not specified)
    if (server.loginUser && (!username || server.loginUser.toLowerCase() === username.toLowerCase())) {
      const pass = decryptPassword(server.loginPass);
      if (pass) return { host, share, username: server.loginUser, password: pass };
    }

    return null;
  }

  /**
   * findByHostAndShare(host, share) — find creds for a host+share combo.
   * Prefers SMB creds, falls back to login creds.
   */
  findByHostAndShare(host: string, share: string): PlaintextCredential | null {
    const server = this.findServer(host);
    if (!server) return null;

    // If the server has SMB creds for this share
    if (server.smbUser && server.smbPass && (!share || share === '*' || server.smbShare.toLowerCase() === share.toLowerCase())) {
      const pass = decryptPassword(server.smbPass);
      if (pass) return { host, share: server.smbShare, username: server.smbUser, password: pass };
    }

    // Fall back to login creds
    if (server.loginUser) {
      const pass = decryptPassword(server.loginPass);
      if (pass) return { host, share, username: server.loginUser, password: pass };
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // IPC-FACING METHODS
  // ═══════════════════════════════════════════════════════════════════════

  // ── servers:list ─────────────────────────────────────────────────────

  listAllServers(): {
    id: string; host: string; shareName: string; username: string;
    name?: string; favorite?: boolean; lastUsedAt?: number;
    createdAt?: string; updatedAt?: string;
    hostname?: string; ip?: string;
    smbUser?: string;
    source?: ServerSource; setupComplete?: boolean;
  }[] {
    return Object.values(this.vault.servers).map(s => ({
      id: s.id,
      host: s.ip || s.hostname,
      shareName: s.smbShare,
      username: s.loginUser,
      name: s.displayName || s.hostname || '',
      favorite: s.favorite,
      lastUsedAt: s.lastUsedAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      hostname: s.hostname,
      ip: s.ip,
      smbUser: s.smbUser,
      source: s.source,
      setupComplete: s.setupComplete,
    }));
  }

  // ── servers:add ──────────────────────────────────────────────────────

  addServerEntry(
    host: string,
    shareName: string,
    username: string,
    password: string,
    opts?: { name?: string; favorite?: boolean; hostname?: string; smbUser?: string; smbPass?: string; sshKeyPath?: string; sshPassphrase?: string; setupComplete?: boolean }
  ): string {
    const hostname = isIpAddress(host) ? '' : host;
    const ip = isIpAddress(host) ? host : '';

    return this.addServer({
      hostname: hostname || opts?.hostname,
      ip,
      displayName: opts?.name,
      loginUser: username,
      loginPass: password,
      sshKeyPath: opts?.sshKeyPath,
      sshPassphrase: opts?.sshPassphrase,
      smbShare: (shareName && shareName !== '*') ? shareName : undefined,
      smbUser: opts?.smbUser,
      smbPass: opts?.smbPass,
      favorite: opts?.favorite,
      setupComplete: opts?.setupComplete,
    });
  }

  // ── servers:update ───────────────────────────────────────────────────

  updateServerEntry(
    id: string,
    update: {
      host?: string; hostname?: string; ip?: string;
      shareName?: string; username?: string; password?: string;
      smbUser?: string; smbPass?: string;
      name?: string; favorite?: boolean;
    }
  ): string {
    const server = this.vault.servers[id];
    if (!server) throw new Error('Server not found: ' + id);

    const changes: Parameters<typeof this.updateServer>[1] = {};

    if (update.hostname !== undefined) changes.hostname = update.hostname;
    if (update.ip !== undefined) changes.ip = update.ip;
    if (update.host !== undefined) {
      if (isIpAddress(update.host)) changes.ip = update.host;
      else changes.hostname = update.host;
    }
    if (update.shareName !== undefined) changes.smbShare = update.shareName === '*' ? '' : update.shareName;
    if (update.username !== undefined) changes.loginUser = update.username;
    if (update.password !== undefined) changes.loginPass = update.password;
    if (update.smbUser !== undefined) changes.smbUser = update.smbUser;
    if (update.smbPass !== undefined) changes.smbPass = update.smbPass;
    if (update.name !== undefined) changes.displayName = update.name;
    if (update.favorite !== undefined) changes.favorite = update.favorite;

    return this.updateServer(id, changes);
  }

  removeServerEntry(id: string): boolean {
    return this.removeServer(id);
  }

  setServerFavorite(id: string, fav: boolean): void {
    this.setFavorite(id, fav);
  }

  touchServer(id: string): void {
    this.touch(id);
  }

  // ── cred:* IPC compat (used by older code paths) ────────────────────

  storeServer(host: string, username: string, password: string, opts?: { name?: string; favorite?: boolean; sshKeyPath?: string; sshPassphrase?: string }): string {
    return this.addServerEntry(host, '', username, password, opts);
  }

  listServers(): { id: string; host: string; name?: string; username: string; favorite?: boolean; lastUsedAt?: number }[] {
    return Object.values(this.vault.servers).map(s => ({
      id: s.id,
      host: s.ip || s.hostname,
      name: s.displayName,
      username: s.loginUser,
      favorite: s.favorite,
      lastUsedAt: s.lastUsedAt,
    }));
  }

  getForHost(host: string): { id: string; username: string; password: string; sshKeyPath?: string; sshPassphrase?: string } | null {
    return this.getLoginCredentials(host);
  }

  removeById(id: string): boolean {
    if (this.vault.servers[id]) return this.removeServer(id);
    // Legacy: id might be "host|share|user" format
    const parts = id.split('|');
    const host = parts[0];
    if (!host) return false;
    const server = this.findServer(host);
    return server ? this.removeServer(server.id) : false;
  }

  setFavoriteById(id: string, fav: boolean): void {
    if (this.vault.servers[id]) { this.setFavorite(id, fav); return; }
    const host = id.split('|')[0];
    if (!host) return;
    const s = this.findServer(host);
    if (s) this.setFavorite(s.id, fav);
  }

  setNameById(id: string, name: string): void {
    if (this.vault.servers[id]) { this.setName(id, name); return; }
    const host = id.split('|')[0];
    if (!host) return;
    const s = this.findServer(host);
    if (s) this.setName(s.id, name);
  }

  touchById(id: string): void {
    if (this.vault.servers[id]) { this.touch(id); return; }
    const host = id.split('|')[0];
    if (!host) return;
    const s = this.findServer(host);
    if (s) this.touch(s.id);
  }

  /**
   * store(host, share, user, pass) — legacy store compat.
   * If share is '*' or empty, updates login creds.
   * Otherwise updates SMB creds on the server record.
   */
  store(host: string, share: string, username: string, password: string): void {
    if (share === '*' || !share) {
      const existing = this.findServer(host);
      if (existing) {
        existing.loginUser = username;
        existing.loginPass = encryptPassword(password);
        existing.lastUsedAt = Date.now();
        existing.updatedAt = new Date().toISOString();
        this.save();
      } else {
        this.addServer({
          hostname: isIpAddress(host) ? '' : host,
          ip: isIpAddress(host) ? host : '',
          loginUser: username,
          loginPass: password,
        });
      }
    } else {
      // SMB credential — store on server record
      const existing = this.findServer(host);
      if (existing) {
        existing.smbShare = share;
        existing.smbUser = username;
        existing.smbPass = encryptPassword(password);
        existing.lastUsedAt = Date.now();
        existing.updatedAt = new Date().toISOString();
        this.save();
      } else {
        this.addServer({
          hostname: isIpAddress(host) ? '' : host,
          ip: isIpAddress(host) ? host : '',
          smbShare: share,
          smbUser: username,
          smbPass: password,
        });
      }
    }
  }

  /**
   * remove(host, share, user) — legacy remove compat.
   */
  remove(host: string, share: string, _username: string): boolean {
    const s = this.findServer(host);
    if (!s) return false;
    if (share === '*' || !share) {
      return this.removeServer(s.id);
    }
    // Just clear SMB creds from the server record
    s.smbShare = '';
    s.smbUser = '';
    s.smbPass = '';
    s.updatedAt = new Date().toISOString();
    this.save();
    return true;
  }

  /**
   * list() — legacy list compat. Returns server entries in old format.
   */
  list(): { host: string; share: string; username: string; name?: string; favorite?: boolean; lastUsedAt?: number; createdAt?: string; updatedAt?: string }[] {
    return Object.values(this.vault.servers).map(s => ({
      host: s.ip || s.hostname,
      share: s.smbShare || '*',
      username: s.smbUser || s.loginUser,
      name: s.displayName,
      favorite: s.favorite,
      lastUsedAt: s.lastUsedAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  /**
   * listForHost(host) — legacy: list creds for a host (resolves aliases).
   */
  listForHost(host: string): { host: string; share: string; username: string; name?: string; favorite?: boolean; lastUsedAt?: number }[] {
    const server = this.findServer(host);
    if (!server) return [];
    return [{
      host: server.ip || server.hostname,
      share: server.smbShare || '*',
      username: server.smbUser || server.loginUser,
      name: server.displayName,
      favorite: server.favorite,
      lastUsedAt: server.lastUsedAt,
    }];
  }

  /**
   * has(host) — check if a server exists.
   */
  has(host: string, _share?: string, _username?: string): boolean {
    return !!this.findServer(host);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LEGACY FILE MIGRATION
  // ═══════════════════════════════════════════════════════════════════════

  importLegacyCredentials(): number {
    const platform = os.platform();
    if (platform === 'linux') return this.importLegacyLinux();
    if (platform === 'win32') return this.importLegacyWindows();
    return 0;
  }

  private importLegacyLinux(): number {
    const credDir = '/etc/samba/houston-credentials';
    if (!fs.existsSync(credDir)) return 0;

    let imported = 0;
    let files: string[];
    try { files = fs.readdirSync(credDir).filter(f => f.endsWith('.cred')); }
    catch { return 0; }

    for (const file of files) {
      try {
        const share = file.replace(/\.cred$/, '');
        const content = fs.readFileSync(path.join(credDir, file), 'utf-8');
        const usernameMatch = content.match(/^username=(.+)$/m);
        const passwordMatch = content.match(/^password=(.+)$/m);
        if (usernameMatch && passwordMatch) {
          const host = this.findHostForShareInFstab(share);
          if (host && !this.findServer(host)) {
            this.addServer({
              hostname: isIpAddress(host) ? '' : host,
              ip: isIpAddress(host) ? host : '',
              loginUser: usernameMatch[1],
              loginPass: passwordMatch[1],
              smbShare: share,
              smbUser: usernameMatch[1],
              smbPass: passwordMatch[1],
              source: 'manual',
            });
            imported++;
          }
        }
      } catch { /* skip */ }
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
        if (usernameMatch && passwordMatch && !this.findServer(share)) {
          this.addServer({
            displayName: share,
            loginUser: usernameMatch[1],
            loginPass: passwordMatch[1],
            smbShare: share,
            smbUser: usernameMatch[1],
            smbPass: passwordMatch[1],
            source: 'manual',
          });
          imported++;
        }
      } catch { /* skip */ }
    }
    return imported;
  }

  private findHostForShareInFstab(share: string): string | null {
    try {
      const fstab = fs.readFileSync('/etc/fstab', 'utf-8');
      const rx = new RegExp(`^//([^/\\s]+)/${share}\\s`, 'm');
      const m = rx.exec(fstab);
      return m ? m[1] : null;
    } catch { return null; }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PLATFORM EXPORT — runtime cred files for cron/Task Scheduler
  // ═══════════════════════════════════════════════════════════════════════

  exportForRuntime(host: string, share: string, username: string): void {
    const server = this.findServer(host);
    if (!server) throw new Error(`No stored credential for ${username}@${host}/${share}`);

    let password: string;
    // Prefer SMB creds if user matches
    if (server.smbUser && server.smbUser.toLowerCase() === username.toLowerCase()) {
      password = decryptPassword(server.smbPass);
    } else {
      password = decryptPassword(server.loginPass);
    }
    if (!password) throw new Error(`No stored credential for ${username}@${host}/${share}`);

    const cred: PlaintextCredential = { host, share, username, password };
    const platform = os.platform();
    if (platform === 'linux') this.exportLinuxCredFile(cred);
    else if (platform === 'win32') this.exportWindowsCredFile(cred);
    else if (platform === 'darwin') this.exportMacKeychain(cred);
  }

  private exportLinuxCredFile(cred: PlaintextCredential): void {
    const credDir = '/etc/samba/houston-credentials';
    const credFile = path.join(credDir, `${cred.host}_${cred.share}_${cred.username}.cred`);
    const safeHost = assertSafeHost(cred.host);
    const safeShare = assertSafeShare(cred.share);
    const safeUser = assertSafeUsername(cred.username);
    const passwordB64 = toBase64(cred.password);
    const localUser = os.userInfo().username;

    const tempScript = `/tmp/houston_cred_export_${safeHost}_${safeShare}.sh`;
    const scriptContent = `#!/bin/bash
set -euo pipefail
mkdir -p ${shellQuote(credDir)}
chmod 711 ${shellQuote(credDir)}
PASSWORD="$(printf '%s' ${shellQuote(passwordB64)} | base64 --decode)"
printf 'username=%s\\n' ${shellQuote(safeUser)} > ${shellQuote(credFile)}
printf 'password=%s\\n' "$PASSWORD" >> ${shellQuote(credFile)}
chown ${localUser}:${localUser} ${shellQuote(credFile)}
chmod 600 ${shellQuote(credFile)}
`;
    fs.writeFileSync(tempScript, scriptContent, { mode: 0o700 });
    execFileSync('pkexec', ['bash', tempScript]);
    try { fs.unlinkSync(tempScript); } catch { /* best effort */ }
  }

  private exportWindowsCredFile(cred: PlaintextCredential): void {
    const credDir = path.join(
      process.env.ProgramData || 'C:\\ProgramData',
      'houston-backups', 'credentials'
    );
    if (!fs.existsSync(credDir)) fs.mkdirSync(credDir, { recursive: true });
    const credFile = path.join(credDir, `${cred.host}_${cred.share}_${cred.username}.cred`);
    fs.writeFileSync(credFile, `username=${cred.username}\npassword=${cred.password}\n`, { mode: 0o600 });
  }

  private exportMacKeychain(cred: PlaintextCredential): void {
    const svc = `houston-smb-${cred.host}-${cred.share}-${cred.username}`;
    execSync(`security delete-generic-password -s ${shellQuote(svc)} -a ${shellQuote(cred.username)} 2>/dev/null || true`);
    execSync(`security add-generic-password -s ${shellQuote(svc)} -a ${shellQuote(cred.username)} -w -U`, { input: cred.password });
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
