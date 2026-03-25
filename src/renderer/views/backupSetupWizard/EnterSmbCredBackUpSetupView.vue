<template>
  <CardContainer class="overflow-y-auto min-h-0">

    <div class="flex flex-col h-full justify-center items-center text-default">
      <div class="w-full max-w-lg space-y-5">
        <!-- Header -->
        <div class="text-center space-y-2">
          <LockClosedIcon class="w-8 h-8 mx-auto text-muted" />
          <h2 class="text-xl font-semibold">Server Credentials</h2>
          <p class="text-sm text-muted">
            Enter the SMB credentials for the backup destination server.
            These are used to authenticate file transfers to the network share.
          </p>
        </div>

        <!-- Server info pill -->
        <div v-if="targetDisplay" class="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700/40 border border-neutral-200 dark:border-neutral-700 text-sm">
          <ServerIcon class="w-4 h-4 text-muted shrink-0" />
          <span class="text-muted">Destination:</span>
          <span :title="targetDisplay" class="font-medium text-default truncate">{{ targetDisplay }}</span>
        </div>

        <!-- Username and Password input fields -->
        <form @submit.prevent="proceedToNextStep" class="flex flex-col gap-4 text-default">
          <div class="grid relative grid-cols-[200px_1fr] items-center">
            <label for="username" class="font-semibold">Username:</label>
            <input v-enter-next v-model="backUpSetupConfig.username" type="text" id="username"
              class="p-2 input-textlike rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your username" />
          </div>
          <div class="grid relative grid-cols-[200px_1fr] items-center">
            <label for="password" class="font-semibold">Password:</label>
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

        <p class="text-xs text-muted text-center">
          Credentials are stored locally and only used to mount the network share during backups.
        </p>
      </div>
    </div>

    <!-- Buttons -->
    <template #footer>
      <div class="button-group-row w-full justify-between">

        <button @click="proceedToPreviousStep" class="btn btn-secondary h-fit">
          Back
        </button>

        <button :disabled="isButtonDisabled" @click="proceedToNextStep" class="btn btn-primary h-fit">
          Next
        </button>

      </div>
    </template>

  </CardContainer>
</template>

<script setup lang="ts">

import { CardContainer } from '@45drives/houston-common-ui'
import { ref, computed, inject } from 'vue';
import { EyeIcon, EyeSlashIcon } from "@heroicons/vue/20/solid";
import { LockClosedIcon, ServerIcon } from "@heroicons/vue/24/outline";
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

const targetDisplay = computed(() => {
  const target = backUpSetupConfig?.backUpTasks?.[0]?.target;
  if (!target) return '';
  return target;
});

// Check if the "Open" button should be disabled
const isButtonDisabled = computed(() => !backUpSetupConfig?.username || !backUpSetupConfig?.password || openingBackup.value);

// Method to handle the "Open" button action
const proceedToNextStep = () => {
  if (backUpSetupConfig.username && backUpSetupConfig.password) {
    // Trigger backend logic for opening the server
    // Pass username, password, and backupTask.target (URL) to backend
    // For example: openBackupServer(username.value, password.value, props.backupTask.target);
    //   username: backUpSetupConfig.username,
    //   password: backUpSetupConfig.password,
    //   target: backUpSetupConfig.backUpTasks[0].target,
    // });


    let [host, share] = backUpSetupConfig.backUpTasks[0].target.split(":");
    share = share.split("/")[0]


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
