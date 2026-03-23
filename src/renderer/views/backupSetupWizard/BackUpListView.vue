<template>
  <div class="flex flex-col gap-3 p-3">
    <!-- Toolbar: actions + refresh -->
    <div class="flex flex-wrap items-center gap-2">
      <!-- Action buttons (visible when tasks selected) -->
      <template v-if="selectedBackUps.length > 0">
        <span class="text-sm text-muted mr-1">{{ selectedBackUps.length }} selected</span>

        <button class="btn btn-primary text-sm h-fit flex items-center gap-1.5"
          :disabled="isRunningNow" @click="$emit('run')">
          <PlayIcon class="w-4 h-4" />
          <template v-if="!isRunningNow">Run Now</template>
          <template v-else>Running…</template>
        </button>

        <button class="btn btn-secondary text-sm h-fit flex items-center gap-1.5"
          :disabled="selectedBackUps.length < 1" @click="$emit('view')">
          <EyeIcon24 class="w-4 h-4" />
          View
        </button>

        <button class="btn btn-secondary text-sm h-fit flex items-center gap-1.5"
          :disabled="selectedBackUps.length !== 1" @click="$emit('edit')">
          <PencilSquareIcon class="w-4 h-4" />
          Edit
        </button>

        <button class="btn btn-secondary text-sm h-fit flex items-center gap-1.5"
          :disabled="selectedBackUps.length < 1" @click="$emit('viewLog')">
          <DocumentTextIcon class="w-4 h-4" />
          Logs
        </button>

        <button class="btn btn-danger text-sm h-fit flex items-center gap-1.5"
          @click="$emit('delete')">
          <TrashIcon class="w-4 h-4" />
          Delete
        </button>
      </template>

      <div class="flex-1" />

      <button class="btn btn-secondary text-sm h-8 flex items-center gap-1.5" @click.stop="fetchBackupTasks">
        <ArrowPathIcon class="w-4 h-4" />
        Refresh
      </button>
    </div>

    <!-- Loading / Empty States -->
    <div v-if="isLoading" class="w-full h-[200px] flex justify-center items-center">
      <div class="spinner" />
    </div>
    <div v-else-if="backUpTasks.length === 0" class="flex flex-col items-center justify-center text-center py-12 gap-3">
      <CircleStackIcon class="w-12 h-12 text-muted opacity-30" />
      <span class="text-muted text-lg">No backup tasks found</span>
      <p class="text-sm text-muted">Click <b>New Backup</b> above to create your first backup task.</p>
    </div>

    <!-- Table -->
    <div v-else class="overflow-x-auto rounded-md">
      <table ref="tableRef" class="min-w-full text-sm text-left table-fixed  border border-default rounded-md" style="table-layout: fixed;">
        <thead class="sticky top-0 bg-secondary">
          <tr class="border-b border-default">
            <th class="px-3 py-2 relative" :style="{ width: colWidths[0] + 'px' }">
              <input type="checkbox" class="input-checkbox" :checked="allSelected" @change="toggleSelectAll"
                :aria-checked="allSelected" />
              <div class="col-resize-handle" @mousedown.prevent="startResize($event, 0)"></div>
            </th>
            <th class="px-3 py-2 relative" :style="{ width: colWidths[1] + 'px' }">
              Name
              <div class="col-resize-handle" @mousedown.prevent="startResize($event, 1)"></div>
            </th>
            <th class="px-3 py-2 relative" :style="{ width: colWidths[2] + 'px' }">
              Samba User
              <div class="col-resize-handle" @mousedown.prevent="startResize($event, 2)"></div>
            </th>
            <th class="px-3 py-2 relative" :style="{ width: colWidths[3] + 'px' }">
              Source
              <div class="col-resize-handle" @mousedown.prevent="startResize($event, 3)"></div>
            </th>
            <th class="px-3 py-2 relative" :style="{ width: colWidths[4] + 'px' }">
              Destination
              <div class="col-resize-handle" @mousedown.prevent="startResize($event, 4)"></div>
            </th>
            <th class="px-3 py-2 relative" :style="{ width: colWidths[5] + 'px' }">
              Frequency
              <div class="col-resize-handle" @mousedown.prevent="startResize($event, 5)"></div>
            </th>
            <th class="px-3 py-2 relative" :style="{ width: colWidths[6] + 'px' }">
              Status
              <div class="col-resize-handle" @mousedown.prevent="startResize($event, 6)"></div>
            </th>
            <th class="px-3 py-2 relative" :style="{ width: colWidths[7] + 'px' }">
              Last Run at
              <div class="col-resize-handle" @mousedown.prevent="startResize($event, 7)"></div>
            </th>
            <th class="px-3 py-2 relative" :style="{ width: colWidths[8] + 'px' }">
              Next Run at
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="task in backUpTasks" :key="task.uuid" :class="rowClass(task)" :aria-selected="isSelected(task)"
            tabindex="0" @click="toggleSelection(task)">
            <td class="px-3 py-2">
              <input type="checkbox" class="input-checkbox" :checked="isSelected(task)"
                @change.stop="toggleSelection(task)" :aria-checked="isSelected(task)" />
            </td>
            <td class="px-3 py-2 truncate" :title="taskDisplayName(task)">{{ taskDisplayName(task) }}</td>
            <td class="px-3 py-2" :title="task.smb_user">{{ task.smb_user }}</td>
            <td class="px-3 py-2 truncate" :title="sourceText(task)">{{ sourceText(task) }}</td>
            <td class="px-3 py-2 truncate" :title="fullDestPath(task)">{{ destinationText(task) }}</td>
            <td class="px-3 py-2 capitalize">{{ formatFrequency(task.schedule?.repeatFrequency) }}</td>
            <td class="px-3 py-2">
              <span class="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full"
                :class="taskStatusClass(task)">
                <span class="w-1.5 h-1.5 rounded-full" :class="taskStatusDotClass(task)" />
                {{ taskStatusLabel(task) }}
              </span>
            </td>
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

    <!-- Edit Backup Task Modal -->
    <Modal :show="showEditModal" @clickOutside="">
      <div class="w-full max-w-2xl mx-auto bg-default border-2 border-default rounded-lg p-6 shadow-xl">
        <h2 class="text-xl font-semibold mb-4">Edit Backup Task</h2>

        <div v-if="editTask" class="space-y-4">
          <!-- Name -->
          <div class="flex items-center gap-3">
            <label class="w-[140px] font-semibold text-sm shrink-0">Backup Name</label>
            <input v-model="editTask.name" type="text"
              class="input-textlike flex-1 rounded-lg px-3 py-2 border border-default"
              placeholder="Enter a name for this backup" />
          </div>

          <!-- Source folder -->
          <div class="flex items-center gap-3">
            <label class="w-[140px] font-semibold text-sm shrink-0">Source Folder</label>
            <input :value="editTask.source" disabled
              class="bg-well flex-1 rounded-lg px-3 py-2 border border-default text-muted" />
            <button class="btn btn-secondary text-sm h-9 px-3" @click="changeEditSource">Browse…</button>
          </div>

          <!-- Schedule mode toggle -->
          <div class="flex items-center gap-3">
            <label class="w-[140px] font-semibold text-sm shrink-0">Schedule Type</label>
            <div class="inline-flex rounded-lg border border-default overflow-hidden">
              <button class="px-4 py-2 text-sm font-medium transition-colors"
                :class="editScheduleMode === 'interval' ? 'bg-primary text-primary-foreground' : 'bg-well hover:bg-accent text-default'"
                @click="editScheduleMode = 'interval'">Simple</button>
              <button class="px-4 py-2 text-sm font-medium border-l border-default transition-colors"
                :class="editScheduleMode === 'custom' ? 'bg-primary text-primary-foreground' : 'bg-well hover:bg-accent text-default'"
                @click="editScheduleMode = 'custom'">Custom</button>
            </div>
          </div>

          <!-- Simple interval -->
          <div v-if="editScheduleMode === 'interval'" class="flex items-center gap-3">
            <label class="w-[140px] font-semibold text-sm shrink-0">
              Backup Interval
              <span v-if="editFrequency !== 'hour'" class="font-normal text-muted text-xs block">Starts at 12:00 AM</span>
            </label>
            <select v-model="editFrequency"
              class="bg-default h-[2.5rem] text-default rounded-lg px-4 flex-1 border border-default">
              <option value="hour">Hourly</option>
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
            </select>
          </div>

          <!-- Custom schedule -->
          <div v-if="editScheduleMode === 'custom'" class="flex items-center gap-3">
            <label class="w-[140px] font-semibold text-sm shrink-0">Custom Schedule</label>
            <button class="btn btn-secondary text-sm h-9 flex items-center gap-1.5 px-3"
              @click="openEditCalendar">
              <CalendarIcon class="w-4 h-4" />
              Set Schedule
            </button>
            <span v-if="editTask.schedule" class="text-sm text-muted">
              {{ formatFrequency(editTask.schedule.repeatFrequency) }} starting
              {{ new Date(editTask.schedule.startDate).toLocaleDateString() }}
            </span>
          </div>

          <!-- Credentials -->
          <div class="border-t border-default pt-4 mt-4">
            <p class="text-sm text-muted mb-3">Leave blank to keep existing credentials.</p>
            <div class="flex items-center gap-3 mb-3">
              <label class="w-[140px] font-semibold text-sm shrink-0">SMB Username</label>
              <input v-model="editUsername" type="text"
                class="input-textlike flex-1 rounded-lg px-3 py-2 border border-default"
                :placeholder="editTask.smb_user || 'Username'" />
            </div>
            <div class="flex items-center gap-3">
              <label class="w-[140px] font-semibold text-sm shrink-0">SMB Password</label>
              <div class="flex-1 relative">
                <input v-model="editPassword" :type="showEditPassword ? 'text' : 'password'"
                  class="input-textlike w-full rounded-lg px-3 py-2 border border-default pr-10"
                  placeholder="Password" />
                <button type="button" @click="showEditPassword = !showEditPassword"
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-muted">
                  <EyeIcon v-if="!showEditPassword" class="w-4 h-4" />
                  <EyeSlashIcon v-else class="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Buttons -->
        <div class="flex justify-end gap-2 mt-6">
          <button class="btn btn-secondary w-fit" @click="cancelEdit">Cancel</button>
          <button class="btn btn-primary w-fit" @click="saveEdit">Save Changes</button>
        </div>
      </div>
    </Modal>

    <!-- Calendar Modal — rendered after edit modal so it stacks on top when both open -->
    <Modal :show="showCalendar" class="-mt-10" @clickOutside="">
      <div class="w-full max-w-xl mx-auto">
        <SimpleCalendar v-if="selectedTaskSchedule" title="Edit Backup Schedule" :taskSchedule="selectedTaskSchedule"
          @close="handleCalendarClose(false)" @save="handleCalendarClose(true)"
          class="border-2 border-default rounded-md w-full" />
      </div>
    </Modal>

    <CredentialsModal ref="credsModalRef" />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onActivated, onMounted, onUnmounted, reactive, ref } from 'vue';
import { BackUpTask, IPCRouter, unwrap, type TaskSchedule } from '@45drives/houston-common-lib';
import { Modal, confirm } from '@45drives/houston-common-ui';
import CredentialsModal from "../../components/CredentialsModal.vue";
import { formatFrequency } from "./utils";
import { SimpleCalendar } from "../../components/calendar";
import { thisOsInjectionKey } from '../../keys/injection-keys';
import { ArrowPathIcon, PlusIcon, CalendarIcon, PlayIcon, EyeIcon as EyeIcon24, PencilSquareIcon, DocumentTextIcon, TrashIcon } from '@heroicons/vue/24/outline';
import { EyeIcon, EyeSlashIcon } from '@heroicons/vue/20/solid';
import { CircleStackIcon } from '@heroicons/vue/24/outline';
import { useRouter } from 'vue-router';

const props = defineProps<{
  selectedCount: number;
  isRunningNow: boolean;
  runningTaskIds: string[];
}>();

const router = useRouter();
const emit = defineEmits<{
  (event: 'backUpTaskSelected', tasks: BackUpTask[]): void;
  (event: 'run'): void;
  (event: 'view'): void;
  (event: 'edit'): void;
  (event: 'viewLog'): void;
  (event: 'delete'): void;
}>();

const backUpTasks = ref<BackUpTask[]>([]);
const selectedBackUps = ref<BackUpTask[]>([]);
const isLoading = ref(true);
const thisOs = inject(thisOsInjectionKey);

const credsModalRef = ref<InstanceType<typeof CredentialsModal> | null>(null);

const selectedTaskSchedule = ref<TaskSchedule | undefined>();
const showCalendar = ref(false);
let resolveCalendarPromise: ((value: boolean) => void) | null = null;

// --- Resizable columns ---
const tableRef = ref<HTMLTableElement | null>(null);
const colWidths = ref<number[]>([40, 140, 100, 160, 160, 90, 100, 150, 150]);
let resizingCol = -1;
let resizeStartX = 0;
let resizeStartW = 0;

function startResize(e: MouseEvent, colIndex: number) {
  resizingCol = colIndex;
  resizeStartX = e.clientX;
  resizeStartW = colWidths.value[colIndex];
  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', onResizeEnd);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}
function onResizeMove(e: MouseEvent) {
  if (resizingCol < 0) return;
  const diff = e.clientX - resizeStartX;
  colWidths.value[resizingCol] = Math.max(40, resizeStartW + diff);
}
function onResizeEnd() {
  resizingCol = -1;
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

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
  return [
    'border-b bg-accent border-default cursor-pointer select-none transition-colors',
    isSelected(task) ? 'row-selected' : 'row-hover'
  ];
}

function toggleSelection(task: BackUpTask) {
  const i = selectedBackUps.value.findIndex(t => t.uuid === task.uuid);
  if (i !== -1) selectedBackUps.value.splice(i, 1); else selectedBackUps.value.push(task);
  emit('backUpTaskSelected', [...selectedBackUps.value]);
}

function trimLeadingSlash(p?: string) { return (p || '').replace(/^\/+/, ''); }

function destinationText(task: BackUpTask) {
  // Destination is Host+Share+Folder minus the ID segment if present
  const base = `${task.host ?? ''}${task.share ? `:${task.share}` : ''}`;
  // let folder = trimLeadingSlash(task.target || '');
  // if (folder.endsWith(task.uuid)) {
  //   folder = folder.slice(0, -task.uuid.length).replace(/\/?$/, '').replace(/\/$/, '');
  // }
  // return `${base}${folder ? '/' + folder : ''}` || '-';
  return base;
}

function fullDestPath(task: BackUpTask) {
  // Destination is Host+Share+Folder minus the ID segment if present
  const base = `${task.host ?? ''}${task.share ? `:${task.share}` : ''}`;
  let folder = trimLeadingSlash(task.target || '');
  if (folder.endsWith(task.uuid)) {
    folder = folder.slice(0, -task.uuid.length).replace(/\/?$/, '').replace(/\/$/, '');
  }
  return `${base}${folder ? '/' + folder : ''}` || '-';
}

function sourceText(task: BackUpTask) {
  const base = `${task.host ?? ''}${task.share ? `:${task.share}` : ''}`;
  const folder = trimLeadingSlash(task.source || '');
  return `${base}${folder ? '/' + folder : ''}` || '-';
}

function taskDisplayName(task: BackUpTask): string {
  if (task.name) return task.name;
  // Fall back to folder name from source
  const src = task.source || '';
  const folderName = src.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop();
  return folderName || task.uuid.slice(0, 8);
}

function formatDateTime(dt?: Date | string | number | null) {
  if (!dt) return '—';
  const d = dt instanceof Date ? dt : new Date(dt);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString([], {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function getLastRunAt(task: BackUpTask): Date | null {
  const t = task as unknown as Record<string, unknown>;
  const cand = t.lastRunAt ?? t.lastRun ?? null;
  return cand ? new Date(cand as string | number) : null;
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

// ── Task status helpers ─────────────────────────────────────────────────────
// Track UUIDs that the backend reported as "still running" (backup_start without backup_end)
const eventRunningUuids = ref<string[]>([]);
// Track last known event status per UUID
const lastEventStatus = ref<Record<string, string>>({});

function taskStatus(task: BackUpTask): 'running' | 'failed' | 'online' | 'offline' | 'idle' {
  // Check if currently running (from props OR event log detection)
  if (props.runningTaskIds.includes(task.uuid) || eventRunningUuids.value.includes(task.uuid)) {
    return 'running';
  }
  // Check last event log status
  const evStatus = lastEventStatus.value[task.uuid];
  if (evStatus === 'failure') return 'failed';
  // Check SMB connectivity status
  if (task.status === 'online') return 'online';
  if (task.status?.startsWith('offline') || task.status === 'missing_folder') return 'offline';
  return 'idle';
}

function taskStatusLabel(task: BackUpTask): string {
  switch (taskStatus(task)) {
    case 'running': return 'Running';
    case 'failed': return 'Failed';
    case 'online': return 'Online';
    case 'offline': return 'Offline';
    default: return 'Idle';
  }
}

function taskStatusClass(task: BackUpTask): string {
  switch (taskStatus(task)) {
    case 'running': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
    case 'failed': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
    case 'online': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300';
    case 'offline': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300';
    default: return 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400';
  }
}

function taskStatusDotClass(task: BackUpTask): string {
  switch (taskStatus(task)) {
    case 'running': return 'bg-blue-500 animate-pulse';
    case 'failed': return 'bg-red-500';
    case 'online': return 'bg-green-500';
    case 'offline': return 'bg-yellow-500';
    default: return 'bg-neutral-400';
  }
}

// Exposed hooks for parent actions
// -- Edit modal state --
const showEditModal = ref(false);
const editTask = ref<BackUpTask | null>(null);
const editScheduleMode = ref<'interval' | 'custom'>('interval');
const editFrequency = ref<'hour' | 'day' | 'week' | 'month'>('day');
const editUsername = ref('');
const editPassword = ref('');
const showEditPassword = ref(false);

async function editSelectedSchedules() {
  if (selectedBackUps.value.length !== 1) return;
  const task = selectedBackUps.value[0];
  editTask.value = JSON.parse(JSON.stringify(task));
  editTask.value!.schedule.startDate = new Date(task.schedule.startDate);
  editScheduleMode.value = 'interval';
  editFrequency.value = task.schedule.repeatFrequency;
  editUsername.value = '';
  editPassword.value = '';
  showEditPassword.value = false;
  showEditModal.value = true;
}

async function changeEditSource() {
  if (!window.electron?.selectFolder) return;
  const folderPath = await window.electron.selectFolder();
  if (folderPath && editTask.value) {
    editTask.value.source = folderPath;
    // Update name if it was auto-derived from old source
    if (!editTask.value.name) {
      editTask.value.name = folderPath.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || '';
    }
  }
}

async function openEditCalendar() {
  if (!editTask.value) return;
  selectedTaskSchedule.value = reactive({
    repeatFrequency: editTask.value.schedule.repeatFrequency,
    startDate: new Date(editTask.value.schedule.startDate),
  });
  await nextTick();
  const confirmed = await toggleCalendarComponent();
  if (confirmed && editTask.value) {
    editTask.value.schedule.repeatFrequency = selectedTaskSchedule.value!.repeatFrequency;
    editTask.value.schedule.startDate = selectedTaskSchedule.value!.startDate;
  }
}

function cancelEdit() {
  showEditModal.value = false;
  editTask.value = null;
}

function saveEdit() {
  if (!editTask.value) return;

  // Apply simple interval schedule if in interval mode
  if (editScheduleMode.value === 'interval') {
    editTask.value.schedule.repeatFrequency = editFrequency.value;
    const now = new Date();
    const nextDate = new Date(now);
    switch (editFrequency.value) {
      case 'hour':
        nextDate.setMinutes(0, 0, 0);
        nextDate.setHours(now.getHours() + 1);
        break;
      case 'day':
        nextDate.setHours(0, 0, 0, 0);
        if (now >= nextDate) nextDate.setDate(nextDate.getDate() + 1);
        break;
      case 'week':
        nextDate.setHours(0, 0, 0, 0);
        nextDate.setDate(now.getDate() + 7);
        break;
      case 'month':
        nextDate.setHours(0, 0, 0, 0);
        nextDate.setMonth(now.getMonth() + 1);
        break;
    }
    editTask.value.schedule.startDate = nextDate;
  }

  // Update the local task in the list
  const idx = backUpTasks.value.findIndex(t => t.uuid === editTask.value!.uuid);
  if (idx !== -1) {
    backUpTasks.value[idx] = { ...backUpTasks.value[idx], ...editTask.value };
  }

  // Send update to backend
  IPCRouter.getInstance().send("backend", "action", JSON.stringify({
    type: "updateBackUpTask",
    task: editTask.value,
    username: editUsername.value,
    password: editPassword.value
  }));

  showEditModal.value = false;
  editTask.value = null;

  // Update selection to reflect changes
  selectedBackUps.value = [];
  emit('backUpTaskSelected', []);
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
  // isLoading.value = false;
}

function fetchBackupEvents() {
  IPCRouter.getInstance().send('backend', 'action', JSON.stringify({ type: 'fetchBackupEvents' }));
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
        msg.tasks.forEach((t: BackUpTask) => {
          if (t.schedule?.startDate) t.schedule.startDate = new Date(t.schedule.startDate);
        });
        backUpTasks.value = msg.tasks;
        fetchBackupEvents();                   // <-- pull the NDJSON after tasks arrive
        isLoading.value = false;
      } else if (msg.type === 'backUpStatusesUpdated') {
        msg.tasks.forEach((updated: BackUpTask) => {
          const i = backUpTasks.value.findIndex(t => t.uuid === updated.uuid);
          if (i !== -1) backUpTasks.value[i].status = updated.status;
        });
        // Also refresh events to pick up any new Last Run timestamps
        fetchBackupEvents();
      } else if (msg.type === 'sendBackupEvents') {
        const latest: Record<string, Date> = {};
        const statuses: Record<string, string> = {};
        for (const ev of (msg.events ?? [])) {
          if (ev?.uuid && ev?.timestamp) {
            const ts = new Date(ev.timestamp);
            if (!Number.isNaN(ts.getTime())) {
              const prev = latest[ev.uuid];
              if (!prev || ts > prev) {
                latest[ev.uuid] = ts;
                statuses[ev.uuid] = ev.status ?? '';
              }
            }
          }
        }
        lastEventStatus.value = statuses;
        // Track running tasks from event log (backup_start without backup_end)
        if (Array.isArray(msg.runningUuids)) {
          eventRunningUuids.value = msg.runningUuids;
        }
        // merge into tasks
        backUpTasks.value = backUpTasks.value.map(t =>
          latest[t.uuid] ? { ...t, lastRunAt: latest[t.uuid] } : t
        );
      }
    } catch (e) { console.warn(' Failed to parse IPC action message:', raw); }
  };
  IPCRouter.getInstance().addEventListener('action', ipcActionHandler);
  fetchBackupTasks();
  pollingInterval = setInterval(() => { if (!pollingSuspended) pollStatuses(); }, getPollingInterval());
});

onActivated(() => { fetchBackupTasks(); });

onUnmounted(() => {
  if (ipcActionHandler) IPCRouter.getInstance().removeEventListener('action', ipcActionHandler);
  clearInterval(pollingInterval);
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);
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

function getTaskName(uuid: string): string | undefined {
  const task = backUpTasks.value.find(t => t.uuid === uuid);
  return task ? taskDisplayName(task) : undefined;
}

// expose to parent
defineExpose({ deleteSelectedTasks, editSelectedSchedules, runSelectedNow, getTaskName });
</script>

<style scoped>
.spinner {
  border: 4px solid rgba(128, 128, 128, 0.2);
  border-left-color: currentColor;
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

.col-resize-handle {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  user-select: none;
  z-index: 1;
}

.col-resize-handle:hover {
  background: rgba(128, 128, 128, 0.3);
}
</style>
