<template>
  <div class="flex flex-col">
    <div class="font-bold text-center border-b-2">
      Back Ups
    </div>

    <div v-if="backUpTasks.length == 0" class="spinner"></div>

    <div class="flex flex-col space-y-1 p-2">
      <label
      v-for="backUpTask in backUpTasks"
      :key="backUpTask.source + backUpTask.target"
      class="flex items-center space-x-2 p-2"
    >
      <input
        type="checkbox"
        :checked="selectedBackUp?.source === backUpTask.source && selectedBackUp?.target === backUpTask.target"
        @change="handleSelection(backUpTask)"
        class="form-checkbox h-5 w-5 text-blue-600"
      />
      <span>{{ backUpTask.source }} - {{ backUpTask.target }}</span>
    </label>

    </div>
  </div>

</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { BackUpSetupConfigGlobal } from './BackUpSetupConfigGlobal';
import { BackUpTask } from '@45drives/houston-common-lib';

const backUpTasks = ref<BackUpTask[]>(BackUpSetupConfigGlobal.getInstance().backUpTasks);
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
  if (selectedBackUp.value?.source === backUpTask.source && selectedBackUp.value?.target === backUpTask.target) {
    selectedBackUp.value = null;
    emit('backUpTaskSelected', null);
  } else {
    selectedBackUp.value = backUpTask;
    emit('backUpTaskSelected', backUpTask);
  }
};

</script>

<style scoped></style>
