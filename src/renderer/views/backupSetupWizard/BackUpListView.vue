<template>
  <div class="flex flex-col">


    <div class="">
      <div class="grid gap-2" :class="{
        'grid-cols-1': backUpTasks.length <= 2,
        'md:grid-cols-2': backUpTasks.length >= 3,
        'lg:grid-cols-3': backUpTasks.length >= 5
      }">

        <!-- Backup Card -->
        <div v-for="task in backUpTasks" :key="task.uuid"
          class="relative border-4 rounded-lg shadow-sm p-2 space-y-2 cursor-pointer items-center bg-default"
          :class="[selectedBackUps.some(t => t.uuid === task.uuid) ? 'border-primary' : 'border-default']"
          @click="toggleSelection(task)">

          <input type="checkbox" class="input-checkbox absolute top-2 left-2 z-10"
            :checked="selectedBackUps.some(t => t.uuid === task.uuid)" @change.stop="toggleSelection(task)" />

          <div class="space-y-2 text-default">
            <div>
              <div class="text-label">Folder</div>
              <div class="px-2 py-1 text-sm truncate" :title="task.source">
                {{ task.source }}
              </div>
            </div>

            <div>
              <div class="text-label" :title="task.target">Backup Location</div>
              <div class="px-2 py-1 text-sm truncate" :title="`${task.host}:${task.share}`">
                {{ task.host}}:{{task.share }}
              </div>
              <div class="px-2 py-1 text-sm truncate" :title="task.target">
                {{ task.target }}
              </div>
            </div>

            <div class="text-xs font-medium" :class="{
              'text-success': task.status === 'online',
              'text-warning': task.status === 'missing_folder',
              'text-error': task.status && task.status !== 'online' && task.status !== 'missing_folder'
            }">
              Status: <span>{{ getTaskStatusText(task) }}</span>
            </div>

            <div class="text-feedback font-semibold pt-2">
              Backup will happen
              {{ formatFrequency(task.schedule.repeatFrequency) }}
              at
              {{ task.schedule?.startDate ? task.schedule.startDate.toLocaleTimeString([], { hour: '2-digit', minute:
              '2-digit' }) : 'Invalid Time' }}
              starting
              {{ task.schedule?.startDate ? task.schedule.startDate.toDateString() : "Invalid date" }}
            </div>
          </div>
          <div class="flex justify-between items-center pt-2">
            <button class="btn btn-secondary text-sm relative" @click.stop="editSchedule(task)">
              <!-- Edit Schedule -->
              <PencilIcon class="w-6 h-6 text-white" />
            </button>
            <button @click.stop="backupNow(task)" class="btn btn-primary text-base">
              Backup Now
            </button>
            <button @click.stop="deleteThisTask(task)" class="btn btn-danger text-sm">
              <!-- Remove Task -->
              <TrashIcon class="w-6 h-6 text-white" />
            </button>
          </div>
        </div>
        <!-- <div v-if="backUpTasks.length == 0" class="spinner"></div> -->
        <div v-if="backUpTasks.length < 1">
          No Tasks Found
        </div>
      </div>
    </div>
  </div>

  <Modal :show="showCalendar" class="-mt-10" @clickOutside="">
    <div class="w-full max-w-xl mx-auto">
      <SimpleCalendar title="Edit Backup Schedule" :taskSchedule="selectedTaskSchedule"
        @close="handleCalendarClose(false)" @save="handleCalendarClose(true)"
        class="border-2 border-default rounded-md w-full" />
    </div>
  </Modal>
  <CredentialsModal ref="credsModalRef" />
</template>


<script setup lang="ts">
import { inject, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { BackUpTask, IPCRouter, unwrap } from '@45drives/houston-common-lib';
import { Modal, confirm } from '@45drives/houston-common-ui';
import CredentialsModal from "../../components/CredentialsModal.vue";
import { formatFrequency } from "./utils";
import { SimpleCalendar } from "../../components/calendar";
import { PencilIcon, TrashIcon } from '@heroicons/vue/24/outline';
import { thisOsInjectionKey } from '../../keys/injection-keys';
const backUpTasks = ref<BackUpTask[]>([]);
const selectedBackUps = ref<BackUpTask[]>([]);
const thisOs = inject(thisOsInjectionKey);

const credsModalRef = ref<InstanceType<typeof CredentialsModal> | null>(null);

const selectedTaskSchedule = ref<any>();
const showCalendar = ref(false);
let resolveCalendarPromise: ((value: boolean) => void) | null = null;

function toggleCalendarComponent() {
  showCalendar.value = true;

  return new Promise<boolean>((resolve) => {
    resolveCalendarPromise = resolve;
  });
}

function handleCalendarClose(saved: boolean) {
  showCalendar.value = false;
  if (resolveCalendarPromise) {
    resolveCalendarPromise(saved);
    resolveCalendarPromise = null;
  }
}

watch(backUpTasks, () => {
  const buttons = document.querySelectorAll('.btn');
  buttons.forEach(button => {
    button.addEventListener('click', () => {
      buttons.forEach(btn => btn.classList.remove('selected'));
      button.classList.add('selected');
    });
  });
})

function isScheduledButNotRunYet(task: BackUpTask): boolean {
  return ( new Date(task.schedule.startDate).getTime() > Date.now() );
}

const getTaskStatusText = (task: BackUpTask): string => {
  switch (task.status) {
    case 'online':
      return 'Available (Online)';
    case 'missing_folder':
      if (isScheduledButNotRunYet(task)) {
        return "Scheduled But Hasn't Run Yet"
      } else {
        return "Unavailable (Folder Missing) — has backup run yet?";
      }
    case 'offline_unreachable':
      return "Unavailable (Host Unreachable)";
    case 'offline_invalid_credentials':
      return "Unavailable (Invalid Credentials)";
    case 'offline_insufficient_permissions':
      return "Unavailable (Insufficient Permissions)";
    case 'offline_connection_error':
      return "Unavailable (Connection Error)";
    case 'checking':
    default:
      return "Checking status...";
  }
};



// Define event emitter
const emit = defineEmits<{
  (event: 'backUpTaskSelected', tasks: BackUpTask[]): void;
}>();


const toggleSelection = (task: BackUpTask) => {
  const index = selectedBackUps.value.findIndex(t => t.uuid === task.uuid);

  if (index !== -1) {
    selectedBackUps.value.splice(index, 1);
  } else {
    console.log('task selected:', task);
    selectedBackUps.value.push(task);
  }

  emit('backUpTaskSelected', [...selectedBackUps.value]);
};

onActivated(fetchBackupTasks); // Runs when the component is displayed again

async function editSchedule(selectedBackUp: BackUpTask) {
  // Set the selected schedule for editing
  selectedTaskSchedule.value = reactive({
    repeatFrequency: selectedBackUp.schedule.repeatFrequency,
    startDate: new Date(selectedBackUp.schedule.startDate),
  });

  // Wait for Vue to update before showing the modal
  await nextTick();

  // Open the calendar modal
  const scheduleConfirmed = await toggleCalendarComponent();

  // If the user saves, update the task schedule
  if (scheduleConfirmed && selectedBackUp) {
    selectedBackUp.schedule.repeatFrequency = selectedTaskSchedule.value.repeatFrequency;
    selectedBackUp.schedule.startDate = selectedTaskSchedule.value.startDate;

    // const isLinux = thisOs?.value === 'rocky' || thisOs?.value === 'debian';

    // if (!isLinux) {
    //   const credentials = await credsModalRef.value?.open();
    //   if (!credentials) return;

    //   IPCRouter.getInstance().send("backend", "action", JSON.stringify({
    //     type: "updateBackUpTask",
    //     task: selectedBackUp,
    //     username: credentials.username,
    //     password: credentials.password
    //   }));
    // } else {
      IPCRouter.getInstance().send("backend", "action", JSON.stringify({
        type: "updateBackUpTask",
        task: selectedBackUp, 
        username: "",
        password: ""
      }));
    // }
  }
}

function waitForNextMessage(type: string): Promise < any > {
  return new Promise((resolve) => {
    const handler = (raw: string) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === type) {
          IPCRouter.getInstance().removeEventListener('action', handler);
          resolve(msg);
        }
      } catch (e) {
        console.warn("Failed to parse IPC message in waitForNextMessage", raw);
      }
    };

    IPCRouter.getInstance().addEventListener('action', handler);
  });
}

let isHandlingNextClick = false;

const deleteThisTask = async (task: BackUpTask) => {
  // console.log("[Child] 🔥 deleteThisTask executing");

  // console.log("[Child] Selected for deletion:", task);
  if (isHandlingNextClick) return; // ⛔ prevent reentry
  isHandlingNextClick = true;

  try {
    const confirmed = await unwrap(confirm({
      header: "Delete Backup Task?",
      body: `Are you sure you want to delete the backup task from "${task.source}" to "${task.target}"? This action cannot be undone.`,
      dangerous: true,
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel"
    }));

    if (!confirmed) return;

    // Remove from selectedBackUps
    selectedBackUps.value = selectedBackUps.value.filter(t => t.uuid !== task.uuid);

    // Emit updated selection to parent
    emit('backUpTaskSelected', [...selectedBackUps.value]);

    pollingSuspended = true;

    // Send deletion
    IPCRouter.getInstance().send("backend", "action", JSON.stringify({
      type: "removeBackUpTask",
      task
    }));

    // ✅ Wait for updated tasks from backend
    const result = await waitForNextMessage("sendBackupTasks");

    result.tasks.forEach((task: BackUpTask) => {
      if (task.schedule?.startDate) {
        task.schedule.startDate = new Date(task.schedule.startDate);
      }
    });

    backUpTasks.value = result.tasks;
    pollingSuspended = false;

  } finally {
    // 🔓 Reallow clicks after dialog
    isHandlingNextClick = false;
  }

};

const deleteSelectedTasks = async () => {
  if (isHandlingNextClick) return; // ⛔ prevent reentry
  isHandlingNextClick = true;

  try {
    const count = selectedBackUps.value.length;
    if (count === 0) return;

    const cleanTasks = selectedBackUps.value.map(task => ({ ...task }));

    const confirmed = await unwrap(confirm({
      header: `Delete Selected Backup Task${count > 1 ? 's' : ''}?`,
      body: `Are you sure you want to delete ${count} selected backup task${count > 1 ? 's' : ''}? This action cannot be undone.`,
      dangerous: true,
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel"
    }));

    if (!confirmed) return;

    pollingSuspended = true;

    // Immediately clear selection in UI
    selectedBackUps.value = [];
    emit('backUpTaskSelected', []);

    // Send deletion
    if (count === 1) {
      IPCRouter.getInstance().send("backend", "action", JSON.stringify({
        type: "removeBackUpTask",
        task: cleanTasks[0]
      }));
    } else {
      IPCRouter.getInstance().send("backend", "action", JSON.stringify({
        type: "removeMultipleBackUpTasks",
        tasks: cleanTasks
      }));
    }

    // ✅ Wait for updated tasks from backend
    const result = await waitForNextMessage("sendBackupTasks");

    result.tasks.forEach((task: BackUpTask) => {
      if (task.schedule?.startDate) {
        task.schedule.startDate = new Date(task.schedule.startDate);
      }
    });

    backUpTasks.value = result.tasks;
    pollingSuspended = false;

  } finally {
    // 🔓 Reallow clicks after dialog
    isHandlingNextClick = false;
  }
};


function backupNow(task: BackUpTask) {
  pollingSuspended = true;

  IPCRouter.getInstance().send("backend", "action", JSON.stringify({
    type: "runBackUpTaskNow",
    task
  }));

  shortPollingUntil = Date.now() + 30000;

  setTimeout(() => {
    pollingSuspended = false;
  }, 8000); // delay resuming status check

}


function fetchBackupTasks() {
  IPCRouter.getInstance().send('backend', 'action', 'requestBackUpTasks');
}

IPCRouter.getInstance().addEventListener('action', (raw: string) => {
  const message = JSON.parse(raw);
  if (message.type === 'backUpStatusesUpdated') {
    const updated = message.tasks as BackUpTask[];
    backUpTasks.value = updated.map(task => ({
      ...task,
      schedule: { ...task.schedule, startDate: new Date(task.schedule.startDate) }
    }));
  }
});

let pollingInterval: ReturnType<typeof setInterval>;

onMounted(() => {
  IPCRouter.getInstance().addEventListener('action', (raw: string) => {
    try {
      const msg = JSON.parse(raw);

      switch (msg.type) {
        case 'sendBackupTasks':
          // console.log("📥 Received backup tasks:", msg.tasks);
          msg.tasks.forEach((task: BackUpTask) => {
            if (task.schedule?.startDate) {
              task.schedule.startDate = new Date(task.schedule.startDate);
            }
          });
          backUpTasks.value = msg.tasks;
          break;

        case 'backUpStatusesUpdated':
          // console.log("📦 Statuses updated:", msg.tasks);
          msg.tasks.forEach((updated: BackUpTask) => {
            const index = backUpTasks.value.findIndex(t => t.uuid === updated.uuid);
            if (index !== -1) {
              backUpTasks.value[index].status = updated.status;
            }
          });
          break;

        default:
          break;
      }
    } catch (e) {
      console.warn("❌ Failed to parse IPC action message:", raw);
    }
  });

  // 🔄 Initial fetch
  fetchBackupTasks();
  console.log("found backuptasks:", backUpTasks.value);

  // ⏲️ Start polling every 15 seconds
  pollingInterval = setInterval(() => {
    if (!pollingSuspended) {
      pollStatuses();
    }
  }, getPollingInterval());
});

let shortPollingUntil = 0;

function getPollingInterval(): number {
  const now = Date.now();
  return now < shortPollingUntil ? 5000 : 15000; // 5s when short-polling, else 15s
}

onUnmounted(() => {
  clearInterval(pollingInterval);
});

onDeactivated(() => {
  clearInterval(pollingInterval);
});

let pollingSuspended = false;

function pollStatuses() {
  if (pollingSuspended || backUpTasks.value.length === 0) return;

  IPCRouter.getInstance().send('backend', 'action', JSON.stringify({
    type: 'checkBackUpStatuses',
    tasks: backUpTasks.value.map(task => ({ ...task })) // plain copies
  }));
}


defineExpose({
  deleteSelectedTasks
});


</script>

<style scoped></style>
