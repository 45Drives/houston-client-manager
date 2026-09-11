import { computed, ref } from 'vue';
import { IPCRouter } from '@45drives/houston-common-lib';
import type { RestoreProgress } from './useRestore';

/**
 * Module-level store for operations that run on a connected server: remote restores and
 * ZFS snapshot work. RestoreBrowser and SnapshotManager both unmount as soon as the user
 * leaves the Backup Manager, so anything tracked inside them disappears mid-flight.
 */

export type RemoteOpKind = 'restore' | 'snapshot';

export interface RemoteOp {
  id: string;
  kind: RemoteOpKind;
  label: string;
  serverIp: string;
  username: string;
  phase: RestoreProgress['phase'] | 'running';
  message?: string;
  currentFile?: string;
  filesProcessed?: number;
  filesTotal?: number;
  bytesProcessed?: number;
  bytesTotal?: number;
  error?: string;
  /** Only rclone/rsync transfers can be killed mid-run; ZFS operations cannot. */
  cancellable: boolean;
  cancelling: boolean;
  startedAt: number;
  finishedAt: number | null;
}

const ops = ref<Record<string, RemoteOp>>({});

/** A finished entry lingers only long enough for a visible view to paint its outcome. */
const PRUNE_AFTER_MS = 20_000;

function isTerminal(phase: RemoteOp['phase']): boolean {
  return phase === 'complete' || phase === 'cancelled' || phase === 'error';
}

function prune(id: string): void {
  setTimeout(() => {
    const op = ops.value[id];
    if (op && op.finishedAt !== null) delete ops.value[id];
  }, PRUNE_AFTER_MS);
}

const progressHandler = (data: RestoreProgress) => {
  if (!data?.operationId) return;
  const existing = ops.value[data.operationId];
  if (!existing) return;

  // A late 'complete' from an in-flight chunk must not repaint a cancelled op as success.
  if (existing.phase === 'cancelled' && data.phase !== 'error') return;

  const finished = isTerminal(data.phase);
  ops.value[data.operationId] = {
    ...existing,
    phase: data.phase,
    message: data.message ?? existing.message,
    currentFile: data.currentFile ?? existing.currentFile,
    filesProcessed: data.filesProcessed ?? existing.filesProcessed,
    filesTotal: data.filesTotal ?? existing.filesTotal,
    bytesProcessed: data.bytesProcessed ?? existing.bytesProcessed,
    bytesTotal: data.bytesTotal ?? existing.bytesTotal,
    error: data.error ?? existing.error,
    finishedAt: finished ? Date.now() : existing.finishedAt,
  };
  if (finished) prune(data.operationId);
};

let listening = false;
function ensureListening(): void {
  if (listening) return;
  listening = true;
  IPCRouter.getInstance().addEventListener('restoreProgress', progressHandler);
}

export function beginRemoteOp(opts: {
  id: string;
  kind: RemoteOpKind;
  label: string;
  serverIp: string;
  username: string;
  cancellable?: boolean;
}): void {
  ensureListening();
  ops.value[opts.id] = {
    id: opts.id,
    kind: opts.kind,
    label: opts.label,
    serverIp: opts.serverIp,
    username: opts.username,
    phase: opts.kind === 'restore' ? 'listing' : 'running',
    cancellable: opts.cancellable ?? opts.kind === 'restore',
    cancelling: false,
    startedAt: Date.now(),
    finishedAt: null,
  };
}

export function finishRemoteOp(
  id: string,
  outcome?: { cancelled?: boolean; error?: string },
): void {
  const op = ops.value[id];
  if (!op) return;
  ops.value[id] = {
    ...op,
    phase: outcome?.cancelled ? 'cancelled' : outcome?.error ? 'error' : 'complete',
    error: outcome?.error ?? op.error,
    finishedAt: Date.now(),
  };
  prune(id);
}

export function dismissRemoteOp(id: string): void {
  delete ops.value[id];
}

export async function cancelRemoteOp(id: string): Promise<void> {
  const op = ops.value[id];
  if (!op || !op.cancellable || op.finishedAt !== null) return;
  ops.value[id] = { ...op, cancelling: true };
  try {
    await window.electron.ipcRenderer.invoke('restore:cancel', {
      serverIp: op.serverIp,
      username: op.username,
      operationId: id,
    });
  } catch {
    ops.value[id] = { ...ops.value[id], cancelling: false };
  }
}

export function useRemoteOps() {
  ensureListening();

  const activeRemoteOps = computed(() =>
    Object.values(ops.value).filter(o => o.finishedAt === null),
  );

  const remoteOpCount = computed(() => activeRemoteOps.value.length);

  function percentOf(op: RemoteOp): number | null {
    if (op.filesTotal) {
      return Math.min(100, Math.round(((op.filesProcessed ?? 0) / op.filesTotal) * 100));
    }
    if (op.bytesTotal) {
      return Math.min(100, Math.round(((op.bytesProcessed ?? 0) / op.bytesTotal) * 100));
    }
    return null;
  }

  return {
    ops,
    activeRemoteOps,
    remoteOpCount,
    percentOf,
    beginRemoteOp,
    finishRemoteOp,
    dismissRemoteOp,
    cancelRemoteOp,
  };
}
