import { ref, computed } from 'vue';
import { beginRemoteOp, finishRemoteOp } from './useRemoteOps';

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
  /** Set when the main process refused to destroy without an explicit acknowledgement */
  blocked?: 'anchor' | 'anchor_unknown';
  anchor?: ReplicationAnchor | null;
  reason?: string;
}

export interface SnapshotRollbackResult {
  success: boolean;
  dataset: string;
  snapshot: string;
  error?: string;
}

export interface ReplicationAnchor {
  snapshotName: string;
  snapName: string;
  tasks: Array<{ name: string; target: string }>;
}

export interface ReplicationAnchorResult {
  status: 'ok' | 'unavailable';
  anchors: ReplicationAnchor[];
  unverifiedTasks: string[];
  reason?: string;
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

  /** Map of snapName → anchor info for the currently selected dataset */
  const anchorMap = ref<Map<string, ReplicationAnchor>>(new Map());
  const anchorsLoading = ref(false);
  /** 'unavailable' means we could not prove a snapshot is safe to delete, not that it is. */
  const anchorStatus = ref<'ok' | 'unavailable'>('unavailable');
  const anchorReason = ref<string | null>(null);

  const selectedDataset = ref<string | null>(null);
  const selectedSnapshot = ref<ZfsSnapshot | null>(null);
  const filePath = ref<string[]>([]);

  /** ZFS work has no progress stream, so it is tracked as an indeterminate shared op. */
  async function trackedOp<T extends { success: boolean; error?: string }>(
    label: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const id = crypto.randomUUID();
    beginRemoteOp({
      id,
      kind: 'snapshot',
      label,
      serverIp: serverIp(),
      username: username(),
      cancellable: false,
    });
    try {
      const result = await fn();
      // A guard that asks for confirmation isn't a failure, so don't flag the op red.
      const blocked = (result as { blocked?: string }).blocked;
      finishRemoteOp(id, { error: (result.success || blocked) ? undefined : (result.error ?? label + ' failed') });
      return result;
    } catch (e: any) {
      finishRemoteOp(id, { error: e?.message ?? label + ' failed' });
      throw e;
    }
  }

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
    anchorMap.value = new Map();
    anchorStatus.value = 'unavailable';
    anchorReason.value = null;
    await loadSnapshots(dsName);
    // Load replication anchors in the background (non-blocking)
    loadAnchors(dsName);
  }

  // ── Replication anchor detection ────────────────────────────────────────

  async function loadAnchors(dataset?: string) {
    const ds = dataset ?? selectedDataset.value;
    if (!ds) return;

    anchorsLoading.value = true;
    try {
      const result: ReplicationAnchorResult = await window.electron.ipcRenderer.invoke(
        'snapshot:get-replication-anchors',
        { serverIp: serverIp(), username: username(), dataset: ds },
      );
      const map = new Map<string, ReplicationAnchor>();
      for (const a of result?.anchors ?? []) {
        map.set(a.snapName, a);
      }
      anchorMap.value = map;
      anchorStatus.value = result?.status === 'ok' ? 'ok' : 'unavailable';
      anchorReason.value = result?.reason ?? null;
    } catch (e: any) {
      anchorMap.value = new Map();
      anchorStatus.value = 'unavailable';
      anchorReason.value = e?.message ?? 'Replication anchor detection failed.';
    } finally {
      anchorsLoading.value = false;
    }
  }

  function getAnchor(snapName: string): ReplicationAnchor | undefined {
    return anchorMap.value.get(snapName);
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
      const result = await trackedOp<SnapshotCreateResult>(
        `Creating snapshot ${dataset}@${snapName}`,
        () => window.electron.ipcRenderer.invoke('snapshot:create', {
          serverIp: serverIp(),
          username: username(),
          dataset,
          snapName,
          recursive,
        }),
      );
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

  async function destroySnapshot(
    snapshotName: string,
    recursive: boolean = false,
    acknowledgeAnchor: boolean = false,
  ): Promise<SnapshotDestroyResult> {
    operating.value = true;
    error.value = null;
    try {
      const result = await trackedOp<SnapshotDestroyResult>(
        `Deleting snapshot ${snapshotName}`,
        () => window.electron.ipcRenderer.invoke('snapshot:destroy', {
          serverIp: serverIp(),
          username: username(),
          snapshotName,
          recursive,
          acknowledgeAnchor,
        }),
      );
      if (result.blocked) return result;
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
      const result = await trackedOp<SnapshotRollbackResult>(
        `Rolling back ${snapshotName}`,
        () => window.electron.ipcRenderer.invoke('snapshot:rollback', {
          serverIp: serverIp(),
          username: username(),
          snapshotName,
        }),
      );
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
      const result = await trackedOp<SnapshotRestoreResult>(
        `Restoring ${selected.length} file(s) from ${selectedSnapshot.value.snapName}`,
        () => window.electron.ipcRenderer.invoke('snapshot:restore-files', {
          serverIp: serverIp(),
          username: username(),
          dataset: selectedSnapshot.value!.dataset,
          snapName: selectedSnapshot.value!.snapName,
          filePaths: selected.map(f => f.path),
          destPath,
        }),
      );
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
    anchorMap.value = new Map();
    anchorStatus.value = 'unavailable';
    anchorReason.value = null;
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
    anchorMap,
    anchorsLoading,
    anchorStatus,
    anchorReason,

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

    // Replication anchors
    loadAnchors,
    getAnchor,

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
