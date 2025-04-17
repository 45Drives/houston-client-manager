<template>
  <div class="flex flex-col">
    <div class="font-bold text-center border-b-2">
      Back Ups
    </div>

    <div v-if="backUpTasks.length == 0" class="spinner"></div>

    <div class="flex flex-col space-y-1 p-2 overflow-y-auto">
      <label v-for="backUpTask in backUpTasks" :key="backUpTask.source + backUpTask.target"
        class="flex items-center space-x-2 p-2 border">
        <input type="checkbox"
          :checked="selectedBackUp?.source === backUpTask.source && selectedBackUp?.target === backUpTask.target"
          @change="handleSelection(backUpTask)" class="form-checkbox h-5 w-5 text-blue-600" />
          <div>

            <div class="flex flex-row">

              <span>Folder:</span>
              <div class="space-y-2 border rounded-lg border-gray-500 p-2">{{ backUpTask.source }}</div>
              <span>Backup Location:</span>
              <div class="space-y-2 border rounded-lg border-gray-500 p-2">{{ backUpTask.target }}</div>
            </div>

            <text class="text-default font-semibold text-left px-4">{{ `Backup will happen
              ${formatFrequency(backUpTask.schedule.repeatFrequency)} at ${backUpTask.schedule.startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} starting
              ${backUpTask.schedule.startDate.toDateString()}`}}
            </text>
          </div>
        <button @click="deleteTask(backUpTask)" class="ml-2 px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600">
          Remove Task
        </button>
      </label>

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
