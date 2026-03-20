import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Each test gets a fresh module import via vi.resetModules() to avoid
// the internal cache leaking between tests.

const tmpDir = '/tmp/settingsStore-test-' + Date.now();
const settingsPath = path.join(tmpDir, 'settings.json');

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string) => tmpDir,
  },
}));

function writeRaw(data: string) {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(settingsPath, data, 'utf-8');
}

function readRaw() {
  return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
}

async function freshImport() {
  vi.resetModules();
  return await import('./settingsStore');
}

beforeEach(() => {
  try { fs.unlinkSync(settingsPath); } catch { /* ok */ }
  try { fs.rmdirSync(tmpDir); } catch { /* ok */ }
});

afterEach(() => {
  try { fs.unlinkSync(settingsPath); } catch { /* ok */ }
  try { fs.rmdirSync(tmpDir); } catch { /* ok */ }
});

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT_SETTINGS
// ─────────────────────────────────────────────────────────────────────────────
describe('DEFAULT_SETTINGS', () => {
  it('has expected default values', async () => {
    const { DEFAULT_SETTINGS } = await freshImport();
    expect(DEFAULT_SETTINGS.serverDisplayFormat).toBe('both');
    expect(DEFAULT_SETTINGS.autoConnectFavorites).toBe(true);
    expect(DEFAULT_SETTINGS.discoveryScanIntervalMs).toBe(5000);
    expect(DEFAULT_SETTINGS.discoveryInactivityTimeoutMs).toBe(60000);
    expect(DEFAULT_SETTINGS.discoveryFallbackEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.sshTimeoutMs).toBe(20000);
    expect(DEFAULT_SETTINGS.logRetentionDays).toBe(14);
    expect(DEFAULT_SETTINGS.showNotifications).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// loadSettings()
// ─────────────────────────────────────────────────────────────────────────────
describe('loadSettings()', () => {
  it('returns defaults when no file exists', async () => {
    const { loadSettings, DEFAULT_SETTINGS } = await freshImport();
    const s = loadSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('merges partial JSON with defaults', async () => {
    writeRaw(JSON.stringify({ sshTimeoutMs: 30000 }));
    const { loadSettings } = await freshImport();
    const s = loadSettings();
    expect(s.sshTimeoutMs).toBe(30000);
    expect(s.logRetentionDays).toBe(14);
    expect(s.showNotifications).toBe(true);
    expect(s.discoveryScanIntervalMs).toBe(5000);
  });

  it('returns defaults on corrupt JSON', async () => {
    writeRaw('NOT JSON AT ALL');
    const { loadSettings, DEFAULT_SETTINGS } = await freshImport();
    const s = loadSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('caches after first load', async () => {
    const { loadSettings } = await freshImport();
    const a = loadSettings();
    const b = loadSettings();
    expect(a).toBe(b); // same reference
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// saveSettings()
// ─────────────────────────────────────────────────────────────────────────────
describe('saveSettings()', () => {
  it('persists partial updates to file', async () => {
    const { saveSettings } = await freshImport();
    saveSettings({ serverDisplayFormat: 'ip' });
    const raw = readRaw();
    expect(raw.serverDisplayFormat).toBe('ip');
    expect(raw.logRetentionDays).toBe(14);
  });

  it('successive saves merge correctly', async () => {
    const { saveSettings, loadSettings } = await freshImport();
    saveSettings({ sshTimeoutMs: 30000 });
    saveSettings({ logRetentionDays: 7 });
    const s = loadSettings();
    expect(s.sshTimeoutMs).toBe(30000);
    expect(s.logRetentionDays).toBe(7);
  });

  it('enforces minimum discoveryScanIntervalMs (2000)', async () => {
    const { saveSettings } = await freshImport();
    const s = saveSettings({ discoveryScanIntervalMs: 500 });
    expect(s.discoveryScanIntervalMs).toBe(2000);
  });

  it('enforces minimum discoveryInactivityTimeoutMs (10000)', async () => {
    const { saveSettings } = await freshImport();
    const s = saveSettings({ discoveryInactivityTimeoutMs: 100 });
    expect(s.discoveryInactivityTimeoutMs).toBe(10000);
  });

  it('enforces minimum sshTimeoutMs (5000)', async () => {
    const { saveSettings } = await freshImport();
    const s = saveSettings({ sshTimeoutMs: 1000 });
    expect(s.sshTimeoutMs).toBe(5000);
  });

  it('enforces minimum logRetentionDays (1)', async () => {
    const { saveSettings } = await freshImport();
    const s = saveSettings({ logRetentionDays: 0 });
    expect(s.logRetentionDays).toBe(1);
  });

  it('allows values at the minimum boundary', async () => {
    const { saveSettings } = await freshImport();
    const s = saveSettings({
      discoveryScanIntervalMs: 2000,
      discoveryInactivityTimeoutMs: 10000,
      sshTimeoutMs: 5000,
      logRetentionDays: 1,
    });
    expect(s.discoveryScanIntervalMs).toBe(2000);
    expect(s.discoveryInactivityTimeoutMs).toBe(10000);
    expect(s.sshTimeoutMs).toBe(5000);
    expect(s.logRetentionDays).toBe(1);
  });

  it('updates the cached value', async () => {
    const { saveSettings, loadSettings } = await freshImport();
    loadSettings(); // prime cache
    saveSettings({ showNotifications: false });
    const s = loadSettings();
    expect(s.showNotifications).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resetSettings()
// ─────────────────────────────────────────────────────────────────────────────
describe('resetSettings()', () => {
  it('clears saved settings and returns defaults', async () => {
    const { saveSettings, resetSettings, DEFAULT_SETTINGS } = await freshImport();
    saveSettings({ sshTimeoutMs: 50000, logRetentionDays: 30 });
    const s = resetSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('removes the settings file', async () => {
    const { saveSettings, resetSettings } = await freshImport();
    saveSettings({ sshTimeoutMs: 50000 });
    expect(fs.existsSync(settingsPath)).toBe(true);
    resetSettings();
    expect(fs.existsSync(settingsPath)).toBe(false);
  });

  it('subsequent loadSettings returns defaults after reset', async () => {
    const { saveSettings, resetSettings, loadSettings, DEFAULT_SETTINGS } = await freshImport();
    saveSettings({ showNotifications: false });
    resetSettings();
    const s = loadSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });
});
