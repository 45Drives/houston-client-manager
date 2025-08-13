<template>
  <div class="flex flex-col gap-3">
    <!-- Toolbar -->
    <div class="flex flex-row items-center justify-between font-bold">
      <div class="flex items-center justify-start">
        <button class="btn btn-primary text-sm mr-3" @click.stop="newBackupTask">
          <PlusIcon class="w-5 h-5 text-white" />
        </button>
        Schedule New Backup
      </div>
      <div class="flex items-center justify-end">
        Refresh Backup List
        <button class="btn btn-secondary text-sm ml-3" @click.stop="fetchBackupTasks">
          <ArrowPathIcon class="w-5 h-5 text-white" />
        </button>
      </div>
    </div>


    <!-- Loading / Empty States -->
    <div v-if="isLoading" class="w-full h-[200px] flex justify-center items-center">
      <div class="spinner" />
    </div>
    <div v-else-if="backUpTasks.length === 0" class="flex flex-col items-center text-center py-4">
      <span class="text-muted italic text-xl">No Tasks Found</span>
      <button @click.stop="newBackupTask" class="btn btn-primary px-5 w-80 h-20 mt-2 text-2xl font-bold">Schedule First Backup</button>
    </div>

    <!-- Table -->
    <div v-else class="overflow-x-auto">
      <table class="min-w-full text-sm">
        <thead class="text-left sticky top-0 bg-accent z-10">
          <tr class="border-b border-default">
            <th class="px-3 py-2 w-10">
              <input type="checkbox" class="input-checkbox" :checked="allSelected" @change="toggleSelectAll"
                :aria-checked="allSelected" />
            </th>
            <th class="px-3 py-2">ID</th>
            <th class="px-3 py-2">Type</th>
            <th class="px-3 py-2">Source</th>
            <th class="px-3 py-2">Destination</th>
            <th class="px-3 py-2">Frequency</th>
            <th class="px-3 py-2">Last Run at</th>
            <th class="px-3 py-2">Next Run at</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="task in backUpTasks" :key="task.uuid" class="border-b border-default cursor-pointer select-none"
            :class="rowClass(task)" @click="toggleSelection(task)">
            <td class="px-3 py-2">
              <input type="checkbox" class="input-checkbox" :checked="isSelected(task)"
                @change.stop="toggleSelection(task)" :aria-checked="isSelected(task)" />
            </td>
            <td class="px-3 py-2 font-mono text-xs truncate max-w-[16ch]" :title="task.uuid">{{ task.uuid }}</td>
            <td class="px-3 py-2">{{ taskType(task) }}</td>
            <td class="px-3 py-2 truncate" :title="sourceText(task)">{{ sourceText(task) }}</td>
            <td class="px-3 py-2 truncate" :title="destinationText(task)">{{ destinationText(task) }}</td>
            <td class="px-3 py-2 capitalize">{{ formatFrequency(task.schedule?.repeatFrequency) }}</td>
            <td class="px-3 py-2" :title="formatDateTime(getLastRunAt(task))">{{ formatDateTime(getLastRunAt(task)) }}
            </td>
            <td class="px-3 py-2"
              :title="formatDateTime(getNextBackupDate(task.schedule.startDate, task.schedule.repeatFrequency))">
              {{ formatDateTime(getNextBackupDate(task.schedule.startDate, task.schedule.repeatFrequency)) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Calendar Modal for editing a single task schedule -->
    <Modal :show="showCalendar" class="-mt-10" @clickOutside="">
      <div class="w-full max-w-xl mx-auto">
        <SimpleCalendar title="Edit Backup Schedule" :taskSchedule="selectedTaskSchedule"
          @close="handleCalendarClose(false)" @save="handleCalendarClose(true)"
          class="border-2 border-default rounded-md w-full" />
      </div>
    </Modal>
    <CredentialsModal ref="credsModalRef" />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onActivated, onMounted, onUnmounted, reactive, ref } from 'vue';
import { BackUpTask, IPCRouter, unwrap } from '@45drives/houston-common-lib';
import { Modal, confirm } from '@45drives/houston-common-ui';
import CredentialsModal from "../../components/CredentialsModal.vue";
import { formatFrequency } from "./utils";
import { SimpleCalendar } from "../../components/calendar";
import { thisOsInjectionKey } from '../../keys/injection-keys';
import { ArrowPathIcon, PlusIcon } from '@heroicons/vue/24/outline';
import { useRouter } from 'vue-router';

const router = useRouter();
const emit = defineEmits<{ (event: 'backUpTaskSelected', tasks: BackUpTask[]): void }>();

const backUpTasks = ref<BackUpTask[]>([]);
const selectedBackUps = ref<BackUpTask[]>([]);
const isLoading = ref(true);
const thisOs = inject(thisOsInjectionKey);

const credsModalRef = ref<InstanceType<typeof CredentialsModal> | null>(null);

const selectedTaskSchedule = ref<any>();
const showCalendar = ref(false);
let resolveCalendarPromise: ((value: boolean) => void) | null = null;

function isSelected(task: BackUpTask) {
  return selectedBackUps.value.some(t => t.uuid === task.uuid);
}

const allSelected = computed(() => backUpTasks.value.length > 0 && selectedBackUps.value.length === backUpTasks.value.length);

function toggleSelectAll() {
  if (allSelected.value) {
    selectedBackUps.value = [];
  } else {
    selectedBackUps.value = backUpTasks.value.map(t => ({ ...t }));
  }
  emit('backUpTaskSelected', [...selectedBackUps.value]);
}

function rowClass(task: BackUpTask) {
  return isSelected(task)
    ? 'bg-primary/10 border-primary'
    : 'bg-default hover:bg-well';
}

function toggleSelection(task: BackUpTask) {
  const i = selectedBackUps.value.findIndex(t => t.uuid === task.uuid);
  if (i !== -1) selectedBackUps.value.splice(i, 1); else selectedBackUps.value.push(task);
  emit('backUpTaskSelected', [...selectedBackUps.value]);
}

function taskType(task: BackUpTask) {
  // Heuristic: remote if host/share are set
  // return task.host && task.share ? 'Remote' : 'Local';
  return task.type! || 'N/A';
}

function trimLeadingSlash(p?: string) { return (p || '').replace(/^\/+/, ''); }

function destinationText(task: BackUpTask) {
  // Destination is Host+Share+Folder minus the ID segment if present
  const base = `${task.host ?? ''}${task.share ? `:${task.share}` : ''}`;
  let folder = trimLeadingSlash(task.target || '');
  if (folder.endsWith(task.uuid)) {
    folder = folder.slice(0, -task.uuid.length).replace(/\/?$/, '').replace(/\/$/, '');
  }
  return `${base}${folder ? '/' + folder : ''}` || '-';
}

function sourceText(task: BackUpTask) {
  if (taskType(task) === 'Local') return task.source || '-';
  const base = `${task.host ?? ''}${task.share ? `:${task.share}` : ''}`;
  const folder = trimLeadingSlash(task.source || '');
  return `${base}${folder ? '/' + folder : ''}` || '-';
}

function formatDateTime(dt?: Date | string | number | null) {
  if (!dt) return '—';
  const d = dt instanceof Date ? dt : new Date(dt);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString([], {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function getLastRunAt(task: any): Date | null {
  // Fallback across possible names your backend might use
  return task.lastRunAt || task.lastRun || task.lastRunTime || task.previousRunAt || null;
}

function getNextBackupDate(startDate: Date, repeatFrequency: string): Date {
  const now = new Date();
  let nextDate = new Date(startDate);
  while (nextDate <= now) {
    switch (repeatFrequency) {
      case 'hour': nextDate.setHours(nextDate.getHours() + 1); break;
      case 'day': nextDate.setDate(nextDate.getDate() + 1); break;
      case 'week': nextDate.setDate(nextDate.getDate() + 7); break;
      case 'month': nextDate.setMonth(nextDate.getMonth() + 1); break;
      default: break;
    }
  }
  return nextDate;
}

// Exposed hooks for parent actions
async function editSelectedSchedules() {
  if (selectedBackUps.value.length !== 1) return; // simple single-edit for now
  const selectedBackUp = selectedBackUps.value[0];
  selectedTaskSchedule.value = reactive({
    repeatFrequency: selectedBackUp.schedule.repeatFrequency,
    startDate: new Date(selectedBackUp.schedule.startDate),
  });
  await nextTick();
  const confirmed = await toggleCalendarComponent();
  if (confirmed) {
    selectedBackUp.schedule.repeatFrequency = selectedTaskSchedule.value.repeatFrequency;
    selectedBackUp.schedule.startDate = selectedTaskSchedule.value.startDate;
    IPCRouter.getInstance().send("backend", "action", JSON.stringify({
      type: "updateBackUpTask",
      task: selectedBackUp,
      username: "",
      password: ""
    }));
  }
}

function runSelectedNow() {
  selectedBackUps.value.forEach(task => {
    IPCRouter.getInstance().send('backend', 'action', JSON.stringify({ type: 'runBackUpTaskNow', task }));
  });
}

function cancelSelected() {
  // batch delete UI already exists in parent via deleteSelectedTasks()
}

function newBackupTask() {
  router.push({ path: '/backup/new' });
}

// Calendar helpers
function toggleCalendarComponent() {
  showCalendar.value = true;
  return new Promise<boolean>((resolve) => { resolveCalendarPromise = resolve; });
}
function handleCalendarClose(saved: boolean) {
  showCalendar.value = false;
  if (resolveCalendarPromise) { resolveCalendarPromise(saved); resolveCalendarPromise = null; }
}

// IPC + polling
function fetchBackupTasks() { 
  isLoading.value = true;
  IPCRouter.getInstance().send('backend', 'action', 'requestBackUpTasks'); 
  isLoading.value = false;
}

let ipcActionHandler: ((raw: string) => void) | null = null;
let pollingInterval: ReturnType<typeof setInterval>;
let pollingSuspended = false;
let shortPollingUntil = 0;
function getPollingInterval(): number { return Date.now() < shortPollingUntil ? 5000 : 15000; }
function pollStatuses() {
  if (pollingSuspended || backUpTasks.value.length === 0) return;
  IPCRouter.getInstance().send('backend', 'action', JSON.stringify({
    type: 'checkBackUpStatuses',
    tasks: backUpTasks.value.map(task => ({ ...task }))
  }));
}

onMounted(() => {
  ipcActionHandler = (raw: string) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'sendBackupTasks') {
        msg.tasks.forEach((task: BackUpTask) => {
          if (task.schedule?.startDate) task.schedule.startDate = new Date(task.schedule.startDate);
        });
        backUpTasks.value = msg.tasks;
        isLoading.value = false;
      } else if (msg.type === 'backUpStatusesUpdated') {
        msg.tasks.forEach((updated: BackUpTask) => {
          const i = backUpTasks.value.findIndex(t => t.uuid === updated.uuid);
          if (i !== -1) backUpTasks.value[i].status = updated.status;
        });
      }
    } catch (e) { console.warn('❌ Failed to parse IPC action message:', raw); }
  };
  IPCRouter.getInstance().addEventListener('action', ipcActionHandler);
  fetchBackupTasks();
  pollingInterval = setInterval(() => { if (!pollingSuspended) pollStatuses(); }, getPollingInterval());
});

onActivated(() => { fetchBackupTasks(); });

onUnmounted(() => {
  if (ipcActionHandler) IPCRouter.getInstance().removeEventListener('action', ipcActionHandler);
  clearInterval(pollingInterval);
});

// Deletions (used by parent)
let isHandlingNextClick = false;
async function waitForNextMessage(type: string): Promise<any> {
  return new Promise((resolve) => {
    const handler = (raw: string) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === type) {
          IPCRouter.getInstance().removeEventListener('action', handler);
          resolve(msg);
        }
      } catch { }
    };
    IPCRouter.getInstance().addEventListener('action', handler);
  });
}

async function deleteSelectedTasks() {
  if (isHandlingNextClick) return; isHandlingNextClick = true;
  try {
    const count = selectedBackUps.value.length; if (count === 0) return;
    const confirmed = await unwrap(confirm({
      header: `Delete Selected Backup Task${count > 1 ? 's' : ''}?`,
      body: `Are you sure you want to delete ${count} selected backup task${count > 1 ? 's' : ''}? This action cannot be undone.`,
      dangerous: true, confirmButtonText: 'Delete', cancelButtonText: 'Cancel'
    }));
    if (!confirmed) return;
    const cleanTasks = selectedBackUps.value.map(t => ({ ...t }));
    pollingSuspended = true;
    selectedBackUps.value = []; emit('backUpTaskSelected', []);
    IPCRouter.getInstance().send('backend', 'action', JSON.stringify(count === 1
      ? { type: 'removeBackUpTask', task: cleanTasks[0] }
      : { type: 'removeMultipleBackUpTasks', tasks: cleanTasks }
    ));
    const result = await waitForNextMessage('sendBackupTasks');
    result.tasks.forEach((task: BackUpTask) => { if (task.schedule?.startDate) task.schedule.startDate = new Date(task.schedule.startDate); });
    backUpTasks.value = result.tasks; pollingSuspended = false;
  } finally { isHandlingNextClick = false; }
}

// function backupNow(task: BackUpTask) {
//   pollingSuspended = true;
//   IPCRouter.getInstance().send('backend', 'action', JSON.stringify({ type: 'runBackUpTaskNow', task }));
//   shortPollingUntil = Date.now() + 30000; setTimeout(() => { pollingSuspended = false; }, 8000);
// }

// expose to parent
defineExpose({ deleteSelectedTasks, editSelectedSchedules, runSelectedNow });
</script>

<style scoped>
.spinner {
  border: 4px solid rgba(0, 0, 0, 0.1);
  border-left-color: #2c3e50;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  animation: spin 1s linear infinite;
  margin: 20px;
}

@keyframes spin {
  to {
    transform: rotate(360deg)
  }
}
</style>
