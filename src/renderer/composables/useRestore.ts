import { ref, reactive, onBeforeUnmount, computed } from 'vue';
import { IPCRouter } from '@45drives/houston-common-lib';

// ── Types (mirror restoreManager.ts) ─────────────────────────────────────────

export interface RemoteEntry {
  name: string;
  type: string;
}

export interface RemoteFileEntry {
  Path: string;
  Name: string;
  Size: number;
  MimeType: string;
  ModTime: string;
  IsDir: boolean;
  selected?: boolean;
}

export interface ServerFileEntry {
  name: string;
  path: string;
  size: number;
  isDir: boolean;
  modTime: string;
  selected?: boolean;
}

export interface RestoreProgress {
  operationId: string;
  phase: 'listing' | 'downloading' | 'staging' | 'copying' | 'complete' | 'error';
  currentFile?: string;
  filesProcessed?: number;
  filesTotal?: number;
  bytesProcessed?: number;
  bytesTotal?: number;
  message?: string;
  error?: string;
}

export interface ZfsDataset {
  name: string;
  mountpoint: string;
  used: string;
  available: string;
}

export interface ZfsSnapshot {
  name: string;
  dataset: string;
  snapName: string;
  creation: string;
  used: string;
  referenced: string;
}

export interface S2STask {
  name: string;
  localPath: string;
  remoteHost: string;
  remotePort: number;
  remoteUser: string;
  remotePath: string;
  direction: 'push' | 'pull';
}

export type SourceType = 'cloud' | 's2s' | 'snapshot';

// ── Composable ───────────────────────────────────────────────────────────────

export function useRestore(serverIp: () => string, username: () => string) {
  // Reactive state
  const remotes = ref<RemoteEntry[]>([]);
  const files = ref<(RemoteFileEntry | ServerFileEntry)[]>([]);
  const datasets = ref<ZfsDataset[]>([]);
  const snapshots = ref<ZfsSnapshot[]>([]);
  const s2sTasks = ref<S2STask[]>([]);
  const selectedS2STask = ref<S2STask | null>(null);

  const loading = ref(false);
  const browsing = ref(false);
  const restoring = ref(false);
  const error = ref<string | null>(null);

  const progress = reactive<RestoreProgress>({
    operationId: '',
    phase: 'listing',
  });

  const currentPath = ref<string[]>([]);
  const currentRemote = ref<string>('');
  const sourceType = ref<SourceType>('cloud');

  // ── Derived state ──────────────────────────────────────────────────────

  const breadcrumb = computed(() => {
    const parts = [currentRemote.value || '/'];
    return parts.concat(currentPath.value);
  });

  const selectedFiles = computed(() =>
    files.value.filter(f => 'selected' in f && f.selected)
  );

  const pathString = computed(() =>
    '/' + currentPath.value.join('/')
  );

  // ── Progress listener ──────────────────────────────────────────────────

  const progressHandler = (data: RestoreProgress) => {
    Object.assign(progress, data);
  };

  const router = IPCRouter.getInstance();
  router.addEventListener('restoreProgress', progressHandler);
  onBeforeUnmount(() => {
    router.removeEventListener('restoreProgress', progressHandler);
  });

  // ── Cloud remote operations ────────────────────────────────────────────

  async function loadRemotes() {
    loading.value = true;
    error.value = null;
    try {
      remotes.value = await window.electron.ipcRenderer.invoke('restore:list-remotes', {
        serverIp: serverIp(),
        username: username(),
      });
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to list remotes';
      remotes.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function browseRemote(remote: string, remotePath: string) {
    browsing.value = true;
    error.value = null;
    currentRemote.value = remote;
    try {
      const entries: RemoteFileEntry[] = await window.electron.ipcRenderer.invoke('restore:browse-remote', {
        serverIp: serverIp(),
        username: username(),
        remote,
        remotePath,
      });
      files.value = entries.map(f => ({ ...f, selected: false }));
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to browse remote';
      files.value = [];
    } finally {
      browsing.value = false;
    }
  }

  // ── Server-to-Server task operations ─────────────────────────────────

  async function loadS2STasks() {
    loading.value = true;
    error.value = null;
    try {
      s2sTasks.value = await window.electron.ipcRenderer.invoke('restore:list-s2s-tasks', {
        serverIp: serverIp(),
        username: username(),
      });
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to list server-to-server tasks';
      s2sTasks.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function browseS2SRemote(task: S2STask, remotePath: string) {
    browsing.value = true;
    error.value = null;
    selectedS2STask.value = task;
    currentRemote.value = `${task.remoteUser}@${task.remoteHost}:${task.remotePath}`;
    try {
      const entries: ServerFileEntry[] = await window.electron.ipcRenderer.invoke('restore:browse-s2s-remote', {
        serverIp: serverIp(),
        username: username(),
        remoteHost: task.remoteHost,
        remotePort: task.remotePort,
        remoteUser: task.remoteUser,
        remotePath,
      });
      files.value = entries.map(f => ({ ...f, selected: false }));
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to browse remote server';
      files.value = [];
    } finally {
      browsing.value = false;
    }
  }

  // ── Server path browsing ───────────────────────────────────────────────

  async function browseServer(serverPath: string) {
    browsing.value = true;
    error.value = null;
    currentRemote.value = '';
    try {
      const entries: ServerFileEntry[] = await window.electron.ipcRenderer.invoke('restore:browse-server', {
        serverIp: serverIp(),
        username: username(),
        serverPath,
      });
      files.value = entries.map(f => ({ ...f, selected: false }));
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to browse server';
      files.value = [];
    } finally {
      browsing.value = false;
    }
  }

  // ── Navigation ─────────────────────────────────────────────────────────

  async function navigateInto(entry: RemoteFileEntry | ServerFileEntry) {
    const isDir = 'IsDir' in entry ? entry.IsDir : entry.isDir;
    if (!isDir) return;

    const name = 'Name' in entry ? entry.Name : entry.name;
    currentPath.value = [...currentPath.value, name];

    if (sourceType.value === 'cloud') {
      await browseRemote(currentRemote.value, pathString.value);
    } else if (sourceType.value === 's2s' && selectedS2STask.value) {
      // Build the full path from the task's base remote path + current navigation
      const basePath = selectedS2STask.value.direction === 'push'
        ? selectedS2STask.value.remotePath
        : selectedS2STask.value.localPath;
      const fullPath = basePath.replace(/\/$/, '') + pathString.value;
      await browseS2SRemote(selectedS2STask.value, fullPath);
    } else {
      await browseServer(pathString.value);
    }
  }

  async function navigateUp() {
    if (currentPath.value.length === 0) return;
    currentPath.value = currentPath.value.slice(0, -1);

    if (sourceType.value === 'cloud') {
      await browseRemote(currentRemote.value, pathString.value);
    } else if (sourceType.value === 's2s' && selectedS2STask.value) {
      const basePath = selectedS2STask.value.direction === 'push'
        ? selectedS2STask.value.remotePath
        : selectedS2STask.value.localPath;
      const fullPath = basePath.replace(/\/$/, '') + pathString.value;
      await browseS2SRemote(selectedS2STask.value, fullPath);
    } else {
      await browseServer(pathString.value);
    }
  }

  async function navigateToBreadcrumb(index: number) {
    // index 0 = root, index 1 = first folder, etc.
    currentPath.value = currentPath.value.slice(0, index);

    if (sourceType.value === 'cloud') {
      await browseRemote(currentRemote.value, pathString.value);
    } else if (sourceType.value === 's2s' && selectedS2STask.value) {
      const basePath = selectedS2STask.value.direction === 'push'
        ? selectedS2STask.value.remotePath
        : selectedS2STask.value.localPath;
      const fullPath = basePath.replace(/\/$/, '') + pathString.value;
      await browseS2SRemote(selectedS2STask.value, fullPath);
    } else {
      await browseServer(pathString.value);
    }
  }

  function resetBrowse() {
    files.value = [];
    currentPath.value = [];
    currentRemote.value = '';
    selectedS2STask.value = null;
    error.value = null;
  }

  // ── Restore operations ─────────────────────────────────────────────────

  async function startRestore(opts: {
    destPath: string;
    target: 'server' | 'client';
    smbSharePath?: string;
  }) {
    restoring.value = true;
    error.value = null;

    // Build source identifier
    const source = sourceType.value === 'cloud'
      ? currentRemote.value
      : sourceType.value === 's2s' && selectedS2STask.value
        ? `s2s:${selectedS2STask.value.remoteUser}@${selectedS2STask.value.remoteHost}`
        : 'server';
    const sourcePath = pathString.value;

    try {
      const result = await window.electron.ipcRenderer.invoke('restore:start', {
        serverIp: serverIp(),
        username: username(),
        source,
        sourcePath,
        destPath: opts.destPath,
        target: opts.target,
        smbSharePath: opts.smbSharePath,
      });
      if (!result.success) {
        error.value = result.error ?? 'Restore failed';
      }
      return result;
    } catch (e: any) {
      error.value = e?.message ?? 'Restore failed';
      return { success: false, error: error.value };
    } finally {
      restoring.value = false;
    }
  }

  async function cancelRestore() {
    if (!progress.operationId) return;
    try {
      await window.electron.ipcRenderer.invoke('restore:cancel', {
        serverIp: serverIp(),
        username: username(),
        operationId: progress.operationId,
      });
    } catch (e: any) {
      console.error('Failed to cancel restore:', e);
    }
  }

  // ── Snapshot operations ────────────────────────────────────────────────

  async function loadDatasets() {
    loading.value = true;
    error.value = null;
    try {
      datasets.value = await window.electron.ipcRenderer.invoke('snapshot:list-datasets', {
        serverIp: serverIp(),
        username: username(),
      });
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to list datasets';
      datasets.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function loadSnapshots(dataset?: string) {
    loading.value = true;
    error.value = null;
    try {
      snapshots.value = await window.electron.ipcRenderer.invoke('snapshot:list-snapshots', {
        serverIp: serverIp(),
        username: username(),
        dataset,
      });
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to list snapshots';
      snapshots.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function rollbackSnapshot(snapshotName: string) {
    restoring.value = true;
    error.value = null;
    try {
      const result = await window.electron.ipcRenderer.invoke('snapshot:rollback', {
        serverIp: serverIp(),
        username: username(),
        snapshotName,
      });
      if (!result.success) {
        error.value = result.error ?? 'Rollback failed';
      }
      return result;
    } catch (e: any) {
      error.value = e?.message ?? 'Rollback failed';
      return { success: false, error: error.value };
    } finally {
      restoring.value = false;
    }
  }

  // ── Selection helpers ──────────────────────────────────────────────────

  function toggleFileSelection(file: RemoteFileEntry | ServerFileEntry) {
    file.selected = !file.selected;
  }

  function selectAll() {
    files.value.forEach(f => (f.selected = true));
  }

  function deselectAll() {
    files.value.forEach(f => (f.selected = false));
  }

  return {
    // State
    remotes,
    files,
    datasets,
    snapshots,
    s2sTasks,
    selectedS2STask,
    loading,
    browsing,
    restoring,
    error,
    progress,
    currentPath,
    currentRemote,
    sourceType,

    // Computed
    breadcrumb,
    selectedFiles,
    pathString,

    // Cloud
    loadRemotes,
    browseRemote,

    // Server-to-Server
    loadS2STasks,
    browseS2SRemote,

    // Server
    browseServer,

    // Navigation
    navigateInto,
    navigateUp,
    navigateToBreadcrumb,
    resetBrowse,

    // Restore
    startRestore,
    cancelRestore,

    // Snapshots
    loadDatasets,
    loadSnapshots,
    rollbackSnapshot,

    // Selection
    toggleFileSelection,
    selectAll,
    deselectAll,
  };
}
