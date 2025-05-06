<template>
  <div class="flex flex-col">
    <!-- <div class="text-header text-center border-b border-default mb-2">
      Back Ups
    </div> -->

    <div v-if="backUpTasks.length == 0" class="spinner"></div>

    <!-- Scrollable Task Grid -->
    <div class="overflow-y-auto bg-well p-2 rounded-lg border border-default">
      <div class="grid gap-2" :class="{
        'grid-cols-1': backUpTasks.length <= 2,
        'md:grid-cols-2': backUpTasks.length >= 3,
        'lg:grid-cols-3': backUpTasks.length >= 5
      }">

        <!-- Backup Card -->
        <div v-for="task in backUpTasks" :key="task.source + task.target"
          class="relative border border-default rounded-lg shadow-sm p-2 space-y-2 cursor-pointer items-center"
          @click="handleSelection(task)"
          :class="[(selectedBackUp?.source === task.source && selectedBackUp?.target === task.target ? 'btn-secondary' : 'bg-default')]">
          <input type="checkbox" class="input-checkbox absolute top-2 left-2"
            :checked="selectedBackUp?.source === task.source && selectedBackUp?.target === task.target"
            @change.stop="handleSelection(task)" />
          <div class="space-y-2 text-default">
            <div>
              <div class="text-label">Folder</div>
              <div class="px-2 py-1 text-sm truncate" :title="task.source">
                {{ task.source }}
              </div>
            </div>

            <div>
              <div class="text-label" :title="task.target">Backup Location</div>
              <div class="px-2 py-1 text-sm truncate"
                :title="`${deconstructFullTarget(task.target)?.smbHost}:${deconstructFullTarget(task.target)?.smbShare}`">
                {{ deconstructFullTarget(task.target)?.smbHost}}:{{deconstructFullTarget(task.target)?.smbShare }}
              </div>
              <div class="px-2 py-1 text-sm truncate" :title="deconstructFullTarget(task.target)?.targetPath">
                {{ deconstructFullTarget(task.target)?.targetPath }}
              </div>
            </div>

            <div class="text-feedback font-semibold pt-2">
              Backup will happen
              {{ formatFrequency(task.schedule.repeatFrequency) }}
              at
              {{ task.schedule.startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}
              starting
              {{ task.schedule.startDate.toDateString() }}
            </div>
          </div>
          <div class="flex justify-between items-center pt-2">
            <button class="btn btn-primary text-sm relative" @click.stop="editSchedule(task)">
              Edit Schedule
            </button>
            <button @click.stop="deleteTask(task)" class="btn btn-danger text-sm">
              Remove Task
            </button>
          </div>
        </div>

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
</template>


<script setup lang="ts">
import { nextTick, onActivated, reactive, ref, watch } from 'vue';
import { BackUpTask, IPCRouter, unwrap } from '@45drives/houston-common-lib';
import { Modal, confirm } from '@45drives/houston-common-ui';
import { formatFrequency, deconstructFullTarget } from "./utils";
import { SimpleCalendar } from "../../components/calendar";
const backUpTasks = ref<BackUpTask[]>([]);

const selectedBackUp = ref<BackUpTask | null>(null);
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

// Define event emitter
const emit = defineEmits<{
  (event: 'backUpTaskSelected', backUpTask: BackUpTask | null): void;
}>();

// Emit event when a backUpTask is selected
const handleSelection = (backUpTask: BackUpTask) => {
  if (selectedBackUp.value?.source === backUpTask.source && selectedBackUp.value?.target === backUpTask.target) {
    selectedBackUp.value = null;
    emit('backUpTaskSelected', null);
  } else {
    selectedBackUp.value = backUpTask;
    // console.log("selectedBackUp.value: " + selectedBackUp.value.target)
    emit('backUpTaskSelected', backUpTask);
  }
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

    console.log("Updating backup task with schedule:", selectedBackUp);
    IPCRouter.getInstance().send("backend", "action", JSON.stringify({
      type: "updateBackUpTask",
      task: selectedBackUp
    }));
  }
}

const deleteTask = async (task: BackUpTask) => {
  // const confirmed = await unwrap(confirm({
  //   header: "Delete Backup Task?",
  //   body: `Are you sure you want to delete the backup task from "${task.source}" to "${task.target}"? This action cannot be undone.`,
  //   dangerous: true,
  //   confirmButtonText: "Delete",
  // }));
  const confirmed = window.confirm(`Are you sure you want to delete the backup task from \n"${task.source}" to \n"${task.target}"? \nThis action cannot be undone.`);

  if (!confirmed) return;

  if (selectedBackUp.value == task) {
    selectedBackUp.value = null;
    emit('backUpTaskSelected', null);
  }
  backUpTasks.value = backUpTasks.value.filter(t => t.source !== task.source || t.target !== task.target);
  IPCRouter.getInstance().send("backend", 'action', JSON.stringify(
    {
      type: "removeBackUpTask",
      task: task
    }
  ))
};

function fetchBackupTasks() {
  IPCRouter.getInstance().send('backend', 'action', 'requestBackUpTasks');
  IPCRouter.getInstance().addEventListener('sendBackupTasks', (backUpTasks2) => {
    console.log("tasks from backend:", backUpTasks2);
    backUpTasks2.forEach(backUpTask => {
      backUpTask.schedule.startDate = new Date(backUpTask.schedule.startDate);
    })
    backUpTasks.value = backUpTasks2;
  });
}




</script>

<style scoped></style>
