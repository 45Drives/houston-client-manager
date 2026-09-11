import { computed, ref, watch } from "vue";
import { IPCRouter } from "@45drives/houston-common-lib";

/**
 * Backup progress lives at module scope, not in a view.
 *
 * It used to be component state in ManageBackupsView with the IPC listener bound in
 * onMounted/onBeforeUnmount, so navigating away tore the listener down and dropped every
 * update until the next poll rebuilt a percent-less "In progress…" entry. Keeping it here
 * means a run started on one screen keeps accumulating while the user is on another.
 */

export interface TaskProgress {
  name: string;
  percent: number | null;
  message: string;
  /** Used to tell a live run apart from one that stopped reporting below 100%. */
  updatedAt: number;
}

const isRunningNow = ref(false);
const runningTaskIds = ref<string[]>([]);
const runningTaskNames = ref<string[]>([]);
const taskProgressMap = ref<Record<string, TaskProgress>>({});

const runningTaskCount = computed(() => Object.keys(taskProgressMap.value).length);

/** Views own the task list, so they supply the uuid → display name lookup. */
let resolveTaskName: (uuid: string) => string | undefined = () => undefined;

export function setTaskNameResolver(fn: (uuid: string) => string | undefined): void {
  resolveTaskName = fn;
}

function nameFor(uuid: string, existing?: TaskProgress): string {
  return existing?.name || resolveTaskName(uuid) || uuid.slice(0, 8);
}

export function stopRunningUi(): void {
  isRunningNow.value = false;
  runningTaskIds.value = [];
  runningTaskNames.value = [];
  taskProgressMap.value = {};
}

export function removeFinishedTask(uuid: string): void {
  delete taskProgressMap.value[uuid];
  runningTaskIds.value = runningTaskIds.value.filter((id) => id !== uuid);
  if (Object.keys(taskProgressMap.value).length === 0) {
    stopRunningUi();
  }
}

/** A progress update newer than this proves the run is alive, whatever the status probe says. */
const PROGRESS_LIVE_MS = 10_000;

export function hasLiveProgress(uuid: string): boolean {
  const entry = taskProgressMap.value[uuid];
  return !!entry && Date.now() - entry.updatedAt < PROGRESS_LIVE_MS;
}

/**
 * Drop runs whose destination is no longer reachable.
 *
 * The backend simply stops sending progress when a server drops off the network, so
 * without this the last frame it managed to send ("Running — 6%") stays on screen
 * indefinitely and the task looks alive long after the connection died.
 *
 * A task still pushing progress is exempt: the reachability probe and the transfer race
 * each other, and letting a stale "offline" verdict evict a live entry made the strip
 * alternate between a real percentage and the indeterminate "In progress…" row that the
 * next reconcile put back.
 */
export function clearUnreachableTasks(uuids: string[]): void {
  for (const uuid of uuids) {
    if (hasLiveProgress(uuid)) continue;
    if (taskProgressMap.value[uuid] || runningTaskIds.value.includes(uuid)) {
      removeFinishedTask(uuid);
    }
  }
}

export function beginTasks(
  tasks: { uuid: string; name?: string; description?: string; source?: string }[]
): void {
  isRunningNow.value = true;
  runningTaskIds.value = tasks.map((t) => t.uuid);
  runningTaskNames.value = tasks.map((t) => (t.description || "").trim());
  for (const t of tasks) {
    const name =
      t.name || t.description || t.source?.split("/").pop() || t.uuid.slice(0, 8);
    taskProgressMap.value[t.uuid] = { name, percent: null, message: "Starting…", updatedAt: Date.now() };
  }
}

/** Only terminal phrasings: "disabled"/"Running" notifications name a task that is still live. */
const TERMINAL_TASK_NOTIFICATION =
  /Backup task "(.+?)" (?:cancelled|was not running|completed|failed)/i;

export function maybeClearFromNotification(message: string): void {
  if (!isRunningNow.value) return;
  const m = message.match(TERMINAL_TASK_NOTIFICATION);
  if (!m) return;

  const name = m[1].trim();
  const matchUuid =
    Object.entries(taskProgressMap.value).find(([, info]) => info.name === name)?.[0] ??
    runningTaskIds.value.find((id, i) => runningTaskNames.value[i] === name);

  if (matchUuid) removeFinishedTask(matchUuid);

  IPCRouter.getInstance().send(
    "backend",
    "action",
    JSON.stringify({ type: "fetchBackupEvents" })
  );
}

/** A run whose progress has gone this long without changing is no longer reporting. */
const PROGRESS_STALE_MS = 30_000;

/** Reconcile against the backup_start-without-backup_end set reported by the backend. */
export function syncRunningUuids(currentRunning: string[]): void {
  const now = Date.now();
  for (const uuid of Object.keys(taskProgressMap.value)) {
    const entry = taskProgressMap.value[uuid];
    if (!entry || currentRunning.includes(uuid)) continue;
    // A run that ends short of 100% — an incremental no-op stops at 0% — never triggers the
    // completion path, so a percent alone cannot be taken as proof the task is still alive.
    if (entry.percent == null || now - entry.updatedAt > PROGRESS_STALE_MS) {
      removeFinishedTask(uuid);
    }
  }

  for (const uuid of currentRunning) {
    if (!runningTaskIds.value.includes(uuid)) {
      runningTaskIds.value.push(uuid);
    }
    if (!taskProgressMap.value[uuid]) {
      taskProgressMap.value[uuid] = {
        name: nameFor(uuid),
        percent: null,
        message: "In progress…",
        updatedAt: now,
      };
    }
  }

  if (currentRunning.length > 0) {
    isRunningNow.value = true;
  }
}

const progressHandler = (data: {
  taskUuid: string;
  percent: number | null;
  message?: string;
}) => {
  if (!runningTaskIds.value.includes(data.taskUuid)) {
    // Progress can arrive for a task we did not start, e.g. one the daemon triggered.
    runningTaskIds.value.push(data.taskUuid);
    isRunningNow.value = true;
  }

  const existing = taskProgressMap.value[data.taskUuid];
  // Two sources report a run the app started — the task script's progress file and the
  // spawned process's stdout — and only some of their frames carry a percentage. Blanking
  // the percent on a message-only frame is what dropped the bar back to the indeterminate
  // animation between updates. beginTasks() clears it explicitly when a new run starts.
  const percent = data.percent ?? existing?.percent ?? null;

  taskProgressMap.value[data.taskUuid] = {
    name: nameFor(data.taskUuid, existing),
    percent,
    message: data.message ?? "",
    updatedAt: Date.now(),
  };

  if (data.percent === 100) {
    setTimeout(() => removeFinishedTask(data.taskUuid), 3000);
  }
};

let listening = false;

/**
 * Reconciliation used to live in ManageBackupsView's own listener, so a run that ended
 * while the user was on another screen kept its entry — and the menu badge with it —
 * until they navigated back. Terminal notifications arrive on a separate Electron channel
 * and are forwarded here by AppShell.
 */
const actionHandler = (raw: string) => {
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (msg?.type === "sendBackupEvents" && "runningUuids" in msg) {
    syncRunningUuids(Array.isArray(msg.runningUuids) ? msg.runningUuids : []);
  } else if (msg?.type === "backupRunEnded" && msg.uuid) {
    removeFinishedTask(msg.uuid);
  }
};

/** Nothing polls for events outside the dashboard and Backup Manager, so a live run does. */
const RECONCILE_INTERVAL_MS = 15_000;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;

function startReconcilePolling(): void {
  if (reconcileTimer) return;
  reconcileTimer = setInterval(() => {
    if (!isRunningNow.value) {
      clearInterval(reconcileTimer!);
      reconcileTimer = null;
      return;
    }
    IPCRouter.getInstance().send(
      "backend",
      "action",
      JSON.stringify({ type: "fetchBackupEvents" })
    );
  }, RECONCILE_INTERVAL_MS);
}

function ensureListening(): void {
  if (listening) return;
  listening = true;
  const router = IPCRouter.getInstance();
  router.addEventListener("backupProgress", progressHandler);
  router.addEventListener("action", actionHandler);
  watch(isRunningNow, (running) => {
    if (running) startReconcilePolling();
  });
}

export function useBackupProgress() {
  ensureListening();
  return {
    isRunningNow,
    runningTaskIds,
    runningTaskNames,
    taskProgressMap,
    runningTaskCount,
    beginTasks,
    stopRunningUi,
    removeFinishedTask,
    maybeClearFromNotification,
    syncRunningUuids,
    clearUnreachableTasks,
    setTaskNameResolver,
  };
}
