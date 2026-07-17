<template>
  <CardContainer class="overflow-y-auto min-h-0">

    <div class="flex flex-col h-full justify-center items-center text-default">
      <div class="w-full max-w-lg space-y-5">
        <!-- Header -->
        <div class="text-center space-y-2">
          <LockClosedIcon class="w-8 h-8 mx-auto text-muted" />
          <h2 class="text-xl font-semibold">Samba Login</h2>
          <p class="text-sm text-muted">
            Enter the Samba username and password for the backup share. If stored credentials are found, they'll be filled in automatically.
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

        <!-- Validation error -->
        <div v-if="validationError" class="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          <ExclamationCircleIcon class="w-4 h-4 shrink-0" />
          <span>{{ validationError }}</span>
        </div>

        <p class="text-xs text-muted text-center">
          Your login details are stored securely on this computer and only used to connect to the server during backups.
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
          <template v-if="isValidating">Validating…</template>
          <template v-else>Next</template>
        </button>

      </div>
    </template>

  </CardContainer>
</template>

<script setup lang="ts">

import { CardContainer } from '@45drives/houston-common-ui'
import { ref, computed, inject, onMounted } from 'vue';
import { EyeIcon, EyeSlashIcon } from "@heroicons/vue/20/solid";
import { LockClosedIcon, ServerIcon, ExclamationCircleIcon } from "@heroicons/vue/24/outline";
import { useWizardSteps, useAutoFocus, useEnterToAdvance } from '@45drives/houston-common-ui';
import { backUpSetupConfigKey } from '../../keys/injection-keys';
import { useHeader } from '../../composables/useHeader'
useHeader('Samba Login')

useAutoFocus();

const { prevStep, nextStep, wizardData } = useWizardSteps("backup-new");
const backUpSetupConfig = inject(backUpSetupConfigKey)!;

const openingBackup = ref(false);
const showPassword = ref(false);
const validationError = ref('');
const isValidating = ref(false);
const autoFilling = ref(false);
const togglePassword = () => {
  showPassword.value = !showPassword.value;
};

const targetDisplay = computed(() => {
  const target = backUpSetupConfig?.backUpTasks?.[0]?.target;
  if (!target) return '';
  return target;
});

// Try to auto-fill SMB credentials from the stored server entry
onMounted(async () => {
  if (backUpSetupConfig.username && backUpSetupConfig.password) return; // already filled

  const target = backUpSetupConfig?.backUpTasks?.[0]?.target;
  if (!target) return;

  const [host] = target.split(':');
  if (!host) return;

  autoFilling.value = true;
  try {
    const result = await window.electron.ipcRenderer.invoke('servers:get-smb-creds', { host });
    if (result?.found && result.username && result.password) {
      backUpSetupConfig.username = result.username;
      backUpSetupConfig.password = result.password;
    }
  } catch {
    // Couldn't auto-fill, user will enter manually
  } finally {
    autoFilling.value = false;
  }
});

// Check if the "Open" button should be disabled
const isButtonDisabled = computed(() => !backUpSetupConfig?.username || !backUpSetupConfig?.password || openingBackup.value || isValidating.value);

// Method to handle the "Open" button action
const proceedToNextStep = async () => {
  if (backUpSetupConfig.username && backUpSetupConfig.password) {
    validationError.value = '';
    isValidating.value = true;

    let [host, share] = backUpSetupConfig.backUpTasks[0].target.split(":");
    share = share.split("/")[0];

    try {
      const result = await window.electron.ipcRenderer.invoke('backup:validate-smb-credentials', {
        host,
        share,
        username: backUpSetupConfig.username,
        password: backUpSetupConfig.password,
      });

      if (!result.valid) {
        validationError.value = result.error || 'Invalid credentials. Please check your username and password.';
        isValidating.value = false;
        return;
      }
    } catch (err: any) {
      validationError.value = err?.message || 'Failed to validate credentials.';
      isValidating.value = false;
      return;
    }

    isValidating.value = false;
    nextStep();
  }
};

const proceedToPreviousStep = async () => {
  prevStep();
};

useEnterToAdvance(
  () => {
    if (!isButtonDisabled.value) {
      proceedToNextStep(); // Enter
    }
  },
  200, // debounce time for Enter
  () => {
    if (!isButtonDisabled.value) {
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
