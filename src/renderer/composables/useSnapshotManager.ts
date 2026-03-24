import { ref, computed } from 'vue';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ZfsDataset {
  name: string;
  mountpoint: string;
  used: string;
  available: string;
}

export interface ZfsSnapshot {
  name: string;       // dataset@snapname
  dataset: string;
  snapName: string;
  creation: string;
  used: string;
  referenced: string;
}

export interface SnapshotFileEntry {
  name: string;
  path: string;
  size: number;
  isDir: boolean;
  modTime: number;
  selected?: boolean;
}

export interface SnapshotCreateResult {
  success: boolean;
  snapshotName?: string;
  error?: string;
}

export interface SnapshotDestroyResult {
  success: boolean;
  error?: string;
}

export interface SnapshotRollbackResult {
  success: boolean;
  dataset: string;
  snapshot: string;
  error?: string;
}

export interface SnapshotRestoreResult {
  success: boolean;
  filesRestored?: number;
  error?: string;
}

// ── Composable ───────────────────────────────────────────────────────────────

export function useSnapshotManager(serverIp: () => string, username: () => string) {
  const datasets = ref<ZfsDataset[]>([]);
  const snapshots = ref<ZfsSnapshot[]>([]);
  const files = ref<SnapshotFileEntry[]>([]);

  const loading = ref(false);
  const snapshotsLoading = ref(false);
  const browsing = ref(false);
  const operating = ref(false);
  const error = ref<string | null>(null);

  const selectedDataset = ref<string | null>(null);
  const selectedSnapshot = ref<ZfsSnapshot | null>(null);
  const filePath = ref<string[]>([]);

  // ── Derived ────────────────────────────────────────────────────────────

  const breadcrumb = computed(() => {
    const base = selectedSnapshot.value ? selectedSnapshot.value.snapName : '/';
    return [base, ...filePath.value];
  });

  const selectedFiles = computed(() =>
    files.value.filter(f => f.selected),
  );

  const filePathString = computed(() =>
    '/' + filePath.value.join('/'),
  );

  // ── Dataset operations ─────────────────────────────────────────────────

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

  async function selectDataset(dsName: string) {
    selectedDataset.value = dsName;
    selectedSnapshot.value = null;
    files.value = [];
    filePath.value = [];
    await loadSnapshots(dsName);
  }

  // ── Snapshot operations ────────────────────────────────────────────────

  async function loadSnapshots(dataset?: string) {
    const ds = dataset ?? selectedDataset.value;
    if (!ds) return;

    snapshotsLoading.value = true;
    error.value = null;
    try {
      snapshots.value = await window.electron.ipcRenderer.invoke('snapshot:list-snapshots', {
        serverIp: serverIp(),
        username: username(),
        dataset: ds,
      });
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to list snapshots';
      snapshots.value = [];
    } finally {
      snapshotsLoading.value = false;
    }
  }

  async function createSnapshot(dataset: string, snapName: string, recursive: boolean = false): Promise<SnapshotCreateResult> {
    operating.value = true;
    error.value = null;
    try {
      const result: SnapshotCreateResult = await window.electron.ipcRenderer.invoke('snapshot:create', {
        serverIp: serverIp(),
        username: username(),
        dataset,
        snapName,
        recursive,
      });
      if (!result.success) {
        error.value = result.error ?? 'Create failed';
      } else {
        // Refresh snapshot list
        await loadSnapshots(dataset);
      }
      return result;
    } catch (e: any) {
      error.value = e?.message ?? 'Create failed';
      return { success: false, error: error.value! };
    } finally {
      operating.value = false;
    }
  }

  async function destroySnapshot(snapshotName: string, recursive: boolean = false): Promise<SnapshotDestroyResult> {
    operating.value = true;
    error.value = null;
    try {
      const result: SnapshotDestroyResult = await window.electron.ipcRenderer.invoke('snapshot:destroy', {
        serverIp: serverIp(),
        username: username(),
        snapshotName,
        recursive,
      });
      if (!result.success) {
        error.value = result.error ?? 'Destroy failed';
      } else {
        // Refresh snapshot list
        await loadSnapshots();
      }
      return result;
    } catch (e: any) {
      error.value = e?.message ?? 'Destroy failed';
      return { success: false, error: error.value! };
    } finally {
      operating.value = false;
    }
  }

  async function rollbackSnapshot(snapshotName: string): Promise<SnapshotRollbackResult> {
    operating.value = true;
    error.value = null;
    try {
      const result: SnapshotRollbackResult = await window.electron.ipcRenderer.invoke('snapshot:rollback', {
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
      return { success: false, dataset: '', snapshot: snapshotName, error: error.value! };
    } finally {
      operating.value = false;
    }
  }

  // ── File browsing ──────────────────────────────────────────────────────

  async function browseSnapshot(snap: ZfsSnapshot, subPath?: string) {
    selectedSnapshot.value = snap;
    if (subPath === undefined) {
      filePath.value = [];
    }
    browsing.value = true;
    error.value = null;
    try {
      const entries: SnapshotFileEntry[] = await window.electron.ipcRenderer.invoke('snapshot:browse-files', {
        serverIp: serverIp(),
        username: username(),
        dataset: snap.dataset,
        snapName: snap.snapName,
        subPath: subPath ?? '/',
      });
      files.value = entries.map(f => ({ ...f, selected: false }));
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to browse snapshot';
      files.value = [];
    } finally {
      browsing.value = false;
    }
  }

  async function navigateInto(entry: SnapshotFileEntry) {
    if (!entry.isDir || !selectedSnapshot.value) return;
    filePath.value = [...filePath.value, entry.name];
    await browseSnapshot(selectedSnapshot.value, filePathString.value);
  }

  async function navigateUp() {
    if (filePath.value.length === 0 || !selectedSnapshot.value) return;
    filePath.value = filePath.value.slice(0, -1);
    await browseSnapshot(selectedSnapshot.value, filePathString.value);
  }

  async function navigateToBreadcrumb(index: number) {
    if (!selectedSnapshot.value) return;
    // index 0 = root of snapshot, index 1+ = folders
    filePath.value = filePath.value.slice(0, index);
    await browseSnapshot(selectedSnapshot.value, filePathString.value);
  }

  // ── File restore ───────────────────────────────────────────────────────

  async function restoreFiles(destPath: string): Promise<SnapshotRestoreResult> {
    if (!selectedSnapshot.value) {
      return { success: false, error: 'No snapshot selected' };
    }
    const selected = selectedFiles.value;
    if (selected.length === 0) {
      return { success: false, error: 'No files selected' };
    }

    operating.value = true;
    error.value = null;
    try {
      const result: SnapshotRestoreResult = await window.electron.ipcRenderer.invoke('snapshot:restore-files', {
        serverIp: serverIp(),
        username: username(),
        dataset: selectedSnapshot.value.dataset,
        snapName: selectedSnapshot.value.snapName,
        filePaths: selected.map(f => f.path),
        destPath,
      });
      if (!result.success) {
        error.value = result.error ?? 'Restore failed';
      }
      return result;
    } catch (e: any) {
      error.value = e?.message ?? 'Restore failed';
      return { success: false, error: error.value! };
    } finally {
      operating.value = false;
    }
  }

  // ── Selection helpers ──────────────────────────────────────────────────

  function toggleFileSelection(file: SnapshotFileEntry) {
    file.selected = !file.selected;
  }

  function selectAll() {
    files.value.forEach(f => { if (!f.isDir) f.selected = true; });
  }

  function deselectAll() {
    files.value.forEach(f => (f.selected = false));
  }

  function clearError() {
    error.value = null;
  }

  function reset() {
    datasets.value = [];
    snapshots.value = [];
    files.value = [];
    selectedDataset.value = null;
    selectedSnapshot.value = null;
    filePath.value = [];
    error.value = null;
  }

  return {
    // State
    datasets,
    snapshots,
    files,
    loading,
    snapshotsLoading,
    browsing,
    operating,
    error,
    selectedDataset,
    selectedSnapshot,
    filePath,

    // Computed
    breadcrumb,
    selectedFiles,
    filePathString,

    // Dataset
    loadDatasets,
    selectDataset,

    // Snapshot CRUD
    loadSnapshots,
    createSnapshot,
    destroySnapshot,
    rollbackSnapshot,

    // File browsing
    browseSnapshot,
    navigateInto,
    navigateUp,
    navigateToBreadcrumb,

    // File restore
    restoreFiles,

    // Selection
    toggleFileSelection,
    selectAll,
    deselectAll,

    // Util
    clearError,
    reset,
  };
}
