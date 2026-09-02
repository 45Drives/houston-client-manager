import { computed, ref } from "vue";
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

export function beginTasks(
  tasks: { uuid: string; name?: string; description?: string; source?: string }[]
): void {
  isRunningNow.value = true;
  runningTaskIds.value = tasks.map((t) => t.uuid);
  runningTaskNames.value = tasks.map((t) => (t.description || "").trim());
  for (const t of tasks) {
    const name =
      t.name || t.description || t.source?.split("/").pop() || t.uuid.slice(0, 8);
    taskProgressMap.value[t.uuid] = { name, percent: null, message: "Starting…" };
  }
}

export function maybeClearFromNotification(message: string): void {
  if (!isRunningNow.value) return;
  const m = message.match(/Backup task "(.+?)"/i);
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

/** Reconcile against the backup_start-without-backup_end set reported by the backend. */
export function syncRunningUuids(currentRunning: string[]): void {
  for (const uuid of Object.keys(taskProgressMap.value)) {
    // Only drop poll-detected entries; a Run Now task actively reporting a percent stays.
    const entry = taskProgressMap.value[uuid];
    if (entry && entry.percent == null && !currentRunning.includes(uuid)) {
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

  taskProgressMap.value[data.taskUuid] = {
    name: nameFor(data.taskUuid, taskProgressMap.value[data.taskUuid]),
    percent: data.percent,
    message: data.message ?? "",
  };

  if (data.percent === 100) {
    setTimeout(() => removeFinishedTask(data.taskUuid), 3000);
  }
};

let listening = false;

function ensureListening(): void {
  if (listening) return;
  listening = true;
  IPCRouter.getInstance().addEventListener("backupProgress", progressHandler);
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
    setTaskNameResolver,
  };
}
