<template>
  <CardContainer class="overflow-y-auto min-h-0">

    <div class="flex flex-col h-full justify-center items-center text-default">
      <!-- Username and Password input fields -->
      <form @submit.prevent="proceedToNextStep" class="flex flex-col gap-4 mt-4 text-default">
        <div class="grid relative grid-cols-[200px_1fr] items-center">
          <label for="username" class="font-semibold ">Username:</label>
          <input v-enter-next v-model="backUpSetupConfig.username" type="text" id="username"
            class="p-2 input-textlike rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter your username" />
        </div>
        <div class="grid relative grid-cols-[200px_1fr] items-center">
          <label for="password" class="font-semibold ">Password:</label>
          <input v-model="backUpSetupConfig.password" v-enter-next :type="showPassword ? 'text' : 'password'"
            id="password"
            class="bg-default p-2 input-textlike rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter your password" />
          <button type="button" @click="togglePassword"
            class="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted">
            <EyeIcon v-if="!showPassword" class="w-5 h-5" />
            <EyeSlashIcon v-if="showPassword" class="w-5 h-5" />
          </button>
        </div>
        <button type="submit" class="hidden">Submit</button>
      </form>
    </div>

    <!-- Buttons -->
    <template #footer>
      <div class="button-group-row w-full justify-end">
        <div class="button-group-row w-full justify-between">

          <button @click="proceedToPreviousStep" class="btn btn-secondary w-40 h-20">
            Back
          </button>

          <button :disabled="isButtonDisabled" @click="proceedToNextStep" class="btn btn-primary w-40 h-20">
            Next
          </button>

        </div>
      </div>
    </template>

  </CardContainer>
</template>

<script setup lang="ts">

import CardContainer from '../../components/CardContainer.vue';
import { ref, computed, inject } from 'vue';
import { EyeIcon, EyeSlashIcon } from "@heroicons/vue/20/solid";
import { useWizardSteps, useAutoFocus, useEnterToAdvance } from '@45drives/houston-common-ui';
import { backUpSetupConfigKey } from '../../keys/injection-keys';
import { useHeader } from '../../composables/useHeader'
useHeader('Server Credentials')

useAutoFocus();

const { prevStep, nextStep, wizardData } = useWizardSteps("backup-new");
const backUpSetupConfig = inject(backUpSetupConfigKey)!;

const openingBackup = ref(false);
const showPassword = ref(false);
const togglePassword = () => {
  showPassword.value = !showPassword.value;
};

// Check if the "Open" button should be disabled
const isButtonDisabled = computed(() => !backUpSetupConfig?.username || !backUpSetupConfig?.password || openingBackup.value);

// Method to handle the "Open" button action
const proceedToNextStep = () => {
  if (backUpSetupConfig.username && backUpSetupConfig.password) {
    // Trigger your backend logic for opening the server (you will handle the action)
    // Pass username, password, and backupTask.target (URL) to your backend code
    // For example: openBackupServer(username.value, password.value, props.backupTask.target);
    // console.debug('Attempting to open server with:', {
    //   username: backUpSetupConfig.username,
    //   password: backUpSetupConfig.password,
    //   target: backUpSetupConfig.backUpTasks[0].target,
    // });

    // console.debug("Target:", backUpSetupConfig.backUpTasks[0].target);

    let [host, share] = backUpSetupConfig.backUpTasks[0].target.split(":");
    share = share.split("/")[0]

    // console.debug("Host:", host);  // Output: "hl4-test.local"
    // console.debug("Share:", share); // Output: "backups"

    nextStep();
  }
};

const proceedToPreviousStep = async () => {
  prevStep();
};

useEnterToAdvance(
  () => {
    if (!isButtonDisabled) {
      proceedToNextStep(); // Enter
    }
  },
  200, // debounce time for Enter
  () => {
    if (!isButtonDisabled) {
      proceedToNextStep(); // ArrowRight
    }
  },
  () => {
    proceedToPreviousStep(); // ArrowLeft
  }
);
</script>

<style scoped>
/* Tailwind is utility-based, so no custom CSS is needed here */
</style>
