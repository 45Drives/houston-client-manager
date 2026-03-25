import { ref, onMounted } from 'vue';

// ── Types (mirror settingsStore.ts) ──────────────────────────────────────

export interface AppSettings {
  serverDisplayFormat: 'hostname' | 'ip' | 'both';
  autoConnectFavorites: boolean;
  discoveryScanIntervalMs: number;
  discoveryInactivityTimeoutMs: number;
  discoveryFallbackEnabled: boolean;
  sshTimeoutMs: number;
  logRetentionDays: number;
  showNotifications: boolean;
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
  restoreHistory: RestoreHistoryEntry[];
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

export interface SavedServer {
  id: string;
  host: string;
  name?: string;
  username: string;
  favorite?: boolean;
  lastUsedAt?: number;
}

// ── Composable ───────────────────────────────────────────────────────────

const _settings = ref<AppSettings | null>(null);
const _loaded = ref(false);

export function useSettings() {
  const loading = ref(false);

  async function load() {
    if (_loaded.value && _settings.value) return _settings.value;
    loading.value = true;
    try {
      _settings.value = await window.electron.ipcRenderer.invoke('settings:get');
      _loaded.value = true;
    } catch (e) {
      console.error('Failed to load settings:', e);
    } finally {
      loading.value = false;
    }
    return _settings.value;
  }

  async function save(partial: Partial<AppSettings>) {
    try {
      _settings.value = await window.electron.ipcRenderer.invoke('settings:set', partial);
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
    return _settings.value;
  }

  async function reset() {
    try {
      _settings.value = await window.electron.ipcRenderer.invoke('settings:reset');
    } catch (e) {
      console.error('Failed to reset settings:', e);
    }
    return _settings.value;
  }

  // ── Server management helpers ────────────────────────────────────────

  async function listServers(): Promise<SavedServer[]> {
    return await window.electron.ipcRenderer.invoke('cred:list-servers') ?? [];
  }

  async function setServerName(id: string, name: string) {
    await window.electron.ipcRenderer.invoke('cred:set-name', id, name);
  }

  async function setServerFavorite(id: string, favorite: boolean) {
    await window.electron.ipcRenderer.invoke('cred:set-favorite', id, favorite);
  }

  async function removeServer(id: string) {
    await window.electron.ipcRenderer.invoke('cred:remove', id);
  }

  // Auto-load on first use
  if (!_loaded.value) load();

  return {
    settings: _settings,
    loading,
    load,
    save,
    reset,
    listServers,
    setServerName,
    setServerFavorite,
    removeServer,
  };
}
