import { computed, ref } from "vue";
import { IPCRouter } from "@45drives/houston-common-lib";

/**
 * Restore progress lives at module scope for the same reason backup progress does:
 * it used to be component state in BackupBrowser, so navigating away tore the IPC
 * listener down and the run became invisible — and coming back offered a Restore
 * button that would happily start a second copy of the same job.
 */

export interface RestoreState {
  /** A restore is in flight. Stays true until restoreCompleted arrives. */
  active: boolean;
  /** Backup uuid being restored from, so a view can tell "mine" from "someone else's". */
  uuid: string;
  /** Human label for the badge and menu strip. */
  label: string;
  current: number;
  total: number;
  lastFile: string;
  copiedBytes: number;
  totalBytes: number;
  errors: number;
  /** Folders to offer to open once the run finishes. */
  folders: string[];
  /** Set when restoreCompleted lands; drives the "open folder" prompt. */
  finishedAt: number | null;
  /** Fallback folder when the backend reports none. */
  client: string;
  /** A stop was requested and the backend has not confirmed it yet. */
  cancelling: boolean;
  /** The finished run was stopped by the user rather than completing. */
  cancelled: boolean;
}

function emptyState(): RestoreState {
  return {
    active: false,
    uuid: "",
    label: "",
    current: 0,
    total: 0,
    lastFile: "",
    copiedBytes: 0,
    totalBytes: 0,
    errors: 0,
    folders: [],
    finishedAt: null,
    client: "",
    cancelling: false,
    cancelled: false,
  };
}

const restore = ref<RestoreState>(emptyState());

const isRestoring = computed(() => restore.value.active);

const activeFileName = computed(() => {
  const p = restore.value.lastFile;
  if (!p) return "";
  return p.split(/[\\/]/).pop() ?? p;
});

const activeFilePercent = computed(() => {
  const { copiedBytes, totalBytes } = restore.value;
  if (totalBytes <= 0) return 0;
  return Math.min(100, Math.round((copiedBytes / totalBytes) * 100));
});

/** Whole-job percentage: completed files plus the fraction of the one in flight. */
const overallPercent = computed(() => {
  const { current, total, copiedBytes, totalBytes } = restore.value;
  if (total <= 0) return 0;
  const inFlight = totalBytes > 0 ? Math.min(1, copiedBytes / totalBytes) : 0;
  return Math.min(100, Math.round(((current + inFlight) / total) * 100));
});

export function beginRestore(opts: {
  uuid: string;
  label: string;
  total: number;
  client?: string;
}): void {
  restore.value = {
    ...emptyState(),
    active: true,
    uuid: opts.uuid,
    label: opts.label,
    total: opts.total,
    client: opts.client ?? "",
  };
}

/** Clears everything, including the finished-run prompt. */
export function resetRestore(): void {
  restore.value = emptyState();
}

/** Keeps the run visible but retires the "open restored folder" prompt. */
export function dismissRestoreResult(): void {
  restore.value.finishedAt = null;
  restore.value.folders = [];
  restore.value.cancelled = false;
}

/** Asks the backend to stop after the file in flight; the terminal event still arrives. */
export function cancelRestore(): void {
  const s = restore.value;
  if (!s.active || s.cancelling) return;
  s.cancelling = true;
  IPCRouter.getInstance().send(
    "backend",
    "action",
    JSON.stringify({ type: "cancelRestoreBackups", uuid: s.uuid }),
  );
}

const validFolder = (p: unknown): p is string => typeof p === "string" && p !== "" && p !== "/" && p !== "\\";

const actionHandler = (raw: string) => {
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (!msg || typeof msg.type !== "string") return;

  if (msg.type === "restoreBackupsProgress") {
    const p = msg.progress || {};
    const s = restore.value;
    // A daemon-triggered restore can report without the UI having started one.
    s.active = true;
    s.current = Math.max(s.current, Math.max(0, (p.fileIndex ?? 1) - 1));
    if (p.totalFiles) s.total = Math.max(s.total, p.totalFiles);
    s.lastFile = p.file ?? s.lastFile;
    s.copiedBytes = p.copiedBytes ?? 0;
    s.totalBytes = p.totalBytes ?? 0;
  } else if (msg.type === "restoreBackupsResult") {
    // Backend sends the payload as `result`; older builds used `value`.
    const r = msg.result ?? msg.value ?? {};
    const s = restore.value;
    s.current++;
    s.lastFile = r.file ?? s.lastFile;
    s.copiedBytes = 0;
    s.totalBytes = 0;
    if (r.error) {
      s.errors++;
      console.error(`Error restoring ${r.file}: ${r.error}`);
    }
  } else if (msg.type === "restoreCompleted") {
    const s = restore.value;
    const reported: string[] = Array.isArray(msg.allFolders) ? msg.allFolders.filter(validFolder) : [];
    s.folders = reported.length
      ? reported
      : validFolder(msg.folder)
        ? [msg.folder]
        : validFolder(s.client)
          ? [s.client]
          : [];
    s.active = false;
    s.cancelling = false;
    s.cancelled = !!msg.cancelled;
    s.finishedAt = Date.now();
    if (s.total === 0) s.total = s.current;
  }
};

let listening = false;

function ensureListening(): void {
  if (listening) return;
  listening = true;
  IPCRouter.getInstance().addEventListener("action", actionHandler);
}

export function useRestoreProgress() {
  ensureListening();
  return {
    restore,
    isRestoring,
    activeFileName,
    activeFilePercent,
    overallPercent,
    beginRestore,
    resetRestore,
    dismissRestoreResult,
    cancelRestore,
  };
}
