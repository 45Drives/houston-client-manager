/**
 * SettingsStore — Simple JSON-backed app preferences.
 *
 * Stored at: <userData>/settings.json
 * All values have sensible defaults so the file can be absent or partial.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

// ── Schema ─────────────────────────────────────────────────────────────────

export interface AppSettings {
  /** How to display servers: 'hostname', 'ip', 'both' */
  serverDisplayFormat: 'hostname' | 'ip' | 'both';

  /** Auto-connect to favorite servers when selected */
  autoConnectFavorites: boolean;

  /** Discovery scan interval in ms (min 2000) */
  discoveryScanIntervalMs: number;

  /** How long to keep offline servers visible, in ms */
  discoveryInactivityTimeoutMs: number;

  /** Whether to run fallback subnet scan when mDNS fails */
  discoveryFallbackEnabled: boolean;

  /** Default SSH connection timeout in ms */
  sshTimeoutMs: number;

  /** Use fast SSH ciphers (AES-128-GCM) for transfers — recommended for LAN */
  sshFastCiphers: boolean;

  /** Log retention in days */
  logRetentionDays: number;

  /** Show notification toasts in-app */
  showNotifications: boolean;

  /** Whether guided tours are enabled */
  guidedToursEnabled: boolean;

  /** First-time user onboarding flags */
  onboarding: {
    dashboardTourDone: boolean;
    backupManagerSeen: boolean;
    backupManagerTourDone: boolean;
    createBackupTourDone: boolean;
    backupListTourDone: boolean;
    backupBrowserTourDone: boolean;
    editTaskTourDone: boolean;
    remoteBackupsTourDone: boolean;
    restoreBrowserTourDone: boolean;
    snapshotManagerTourDone: boolean;
  };

  /** Restore operation history (capped at 20 entries) */
  restoreHistory: RestoreHistoryEntry[];

  /** Last known remote/cloud backup relationships per server host, keyed by host */
  topologyIndex: Record<string, TopologyIndexEntry>;
}

export interface TopologyIndexEntry {
  host: string;
  probedAt: number;
  reachable: boolean;
  error?: string;
  rsyncTasks: Array<{
    name: string;
    localPath: string;
    remoteHost: string;
    remotePort: number;
    remoteUser: string;
    remotePath: string;
    direction: 'push' | 'pull';
  }>;
  replicationTasks: Array<{
    name: string;
    sourceDataset: string;
    destDataset: string;
    destHost: string;
    destUser: string;
    destSshPort: number;
    direction: 'push' | 'pull';
  }>;
  cloudSyncTasks: Array<{
    name: string;
    localPath: string;
    targetPath: string;
    remote: string;
    provider: string;
    direction: string;
  }>;
  cloudRemotes: Array<{ name: string; type: string }>;
}

export interface RestoreHistoryEntry {
  timestamp: number;
  source: string;
  sourcePath: string;
  destPath: string;
  target: 'server' | 'client';
  sourceType: 'cloud' | 's2s' | 'snapshot';
  fileCount: number | string;
  success: boolean;
  error?: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  serverDisplayFormat: 'both',
  autoConnectFavorites: true,
  discoveryScanIntervalMs: 5000,
  discoveryInactivityTimeoutMs: 60000,
  discoveryFallbackEnabled: true,
  sshTimeoutMs: 20000,
  sshFastCiphers: false,
  logRetentionDays: 14,
  showNotifications: true,
  guidedToursEnabled: true,
  onboarding: {
    dashboardTourDone: false,
    backupManagerSeen: false,
    backupManagerTourDone: false,
    createBackupTourDone: false,
    backupListTourDone: false,
    backupBrowserTourDone: false,
    editTaskTourDone: false,
    remoteBackupsTourDone: false,
    restoreBrowserTourDone: false,
    snapshotManagerTourDone: false,
  },
  restoreHistory: [],
  topologyIndex: {},
};

// ── Store ──────────────────────────────────────────────────────────────────

const SETTINGS_FILENAME = 'settings.json';

function filePath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILENAME);
}

let cached: AppSettings | null = null;

export function loadSettings(): AppSettings {
  if (cached) return cached;
  try {
    if (fs.existsSync(filePath())) {
      const raw = fs.readFileSync(filePath(), 'utf-8');
      const parsed = JSON.parse(raw);
      // Merge with defaults so missing keys get default values
      const merged = { ...DEFAULT_SETTINGS, ...parsed };
      // Deep-merge nested objects so partial stored values get defaults
      merged.onboarding = { ...DEFAULT_SETTINGS.onboarding, ...parsed.onboarding };
      merged.restoreHistory = Array.isArray(parsed.restoreHistory) ? parsed.restoreHistory : [];
      cached = merged;
      return cached!;
    }
  } catch {
    // corrupt file — use defaults
  }
  cached = { ...DEFAULT_SETTINGS };
  return cached;
}

export function saveSettings(partial: Partial<AppSettings>): AppSettings {
  const current = loadSettings();
  const merged = { ...current, ...partial };

  // Enforce minimums
  if (merged.discoveryScanIntervalMs < 2000) merged.discoveryScanIntervalMs = 2000;
  if (merged.discoveryInactivityTimeoutMs < 10000) merged.discoveryInactivityTimeoutMs = 10000;
  if (merged.sshTimeoutMs < 5000) merged.sshTimeoutMs = 5000;
  if (merged.logRetentionDays < 1) merged.logRetentionDays = 1;

  const dir = path.dirname(filePath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath());

  cached = merged;
  return merged;
}

export function resetSettings(): AppSettings {
  cached = null;
  try {
    if (fs.existsSync(filePath())) fs.unlinkSync(filePath());
  } catch { /* ignore */ }
  return loadSettings();
}
