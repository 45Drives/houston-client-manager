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
        <button v-for="task in backUpTasks" :key="task.source + task.target"
          class="border border-default rounded-lg shadow-sm p-2 space-y-2 cursor-pointer" @click="handleSelection(task)"
          :class="[(selectedBackUp?.source === task.source && selectedBackUp?.target === task.target ? 'btn-secondary' : 'bg-default')]">
          <!-- Folder and Target -->
          <div class="space-y-2 text-default">
            <div>
              <div class="text-label">Folder</div>
              <div class="px-2 py-1 text-sm truncate" :title="task.source">
                {{ task.source }}
              </div>
            </div>

            <div>
              <div class="text-label">Backup Location</div>
              <div class="px-2 py-1 text-sm truncate" :title="task.target">
                {{ task.target }}
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


          <!-- Actions -->
          <div class="flex justify-between items-center pt-2">
            <input type="checkbox" class="input-checkbox"
              :checked="selectedBackUp?.source === task.source && selectedBackUp?.target === task.target"
              @change.stop="handleSelection(task)" />

            <button @click.stop="deleteTask(task)" class="btn btn-danger text-sm">
              Remove Task
            </button>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>


<script setup lang="ts">
import { onActivated, ref, watch } from 'vue';
import { BackUpTask, IPCRouter } from '@45drives/houston-common-lib';
import { formatFrequency } from "./utils";
const backUpTasks = ref<BackUpTask[]>([]);

const selectedBackUp = ref<BackUpTask | null>(null);


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
  (event: 'backUpTaskSelected', bacUupTask: BackUpTask | null): void;
}>();

// Emit event when a backUpTask is selected
const handleSelection = (backUpTask: BackUpTask) => {

  console.log("selectedBackUp.value" + selectedBackUp.value)

  if (selectedBackUp.value?.source === backUpTask.source && selectedBackUp.value?.target === backUpTask.target) {
    selectedBackUp.value = null;

    emit('backUpTaskSelected', null);
  } else {
    selectedBackUp.value = backUpTask;
    console.log("selectedBackUp.value" + selectedBackUp.value.target)
    emit('backUpTaskSelected', backUpTask);
  }
};
onActivated(fetchBackupTasks); // Runs when the component is displayed again


const deleteTask = (task: BackUpTask) => {
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

      console.log(backUpTask.schedule);

      backUpTask.schedule.startDate = new Date(backUpTask.schedule.startDate);
    })
    backUpTasks.value = backUpTasks2;
  });
}
</script>

<style scoped></style>
