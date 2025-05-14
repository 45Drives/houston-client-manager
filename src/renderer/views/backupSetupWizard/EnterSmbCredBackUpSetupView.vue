<template>
  <CardContainer>
    <template #header>
      <div class="relative flex items-center justify-center h-24">
        <div class="absolute left-0 bg-white p-1 px-4 rounded-lg">
          <DynamicBrandingLogo :division="division" />
        </div>
        <p class="text-3xl font-semibold text-center">
          Server Credentials
        </p>
        <div class="absolute right-0 top-1/2 -translate-y-1/2">
          <GlobalSetupWizardMenu />
        </div>
      </div>
    </template>

    <div class="flex flex-col h-full justify-center items-center text-default">
      <!-- Header with instructions -->
      <div>
        <p class=" text-lg">
          Please provide your username and password to use for the backup
        </p>
      </div>

      <!-- Username and Password input fields -->
      <form @submit.prevent="proceedToNextStep" class="flex flex-col gap-4 mt-4 text-default">
        <label for="username" class="font-semibold ">Username:</label>
        <input v-enter-next v-model="backUpSetupConfig.username" type="text" id="username"
          class="p-2 input-textlike rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter your username" />

        <label for="password" class="font-semibold ">Password:</label>
        <input v-enter-next v-model="backUpSetupConfig.password" type="password" id="password"
          class="p-2 input-textlike rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter your password" />
          
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
import { useWizardSteps, DynamicBrandingLogo, useAutoFocus, useEnterToAdvance } from '@45drives/houston-common-ui';
import { backUpSetupConfigKey, divisionCodeInjectionKey } from '../../keys/injection-keys';
import GlobalSetupWizardMenu from '../../components/GlobalSetupWizardMenu.vue';
useAutoFocus();
const division = inject(divisionCodeInjectionKey);
const { prevStep, nextStep, wizardData } = useWizardSteps("backup");
const backUpSetupConfig = inject(backUpSetupConfigKey)!;

const openingBackup = ref(false);

// Check if the "Open" button should be disabled
const isButtonDisabled = computed(() => !backUpSetupConfig?.username || !backUpSetupConfig?.password || openingBackup.value);

// Method to handle the "Open" button action
const proceedToNextStep = () => {
  if (backUpSetupConfig.username && backUpSetupConfig.password) {
    // Trigger your backend logic for opening the server (you will handle the action)
    // Pass username, password, and backupTask.target (URL) to your backend code
    // For example: openBackupServer(username.value, password.value, props.backupTask.target);
    console.log('Attempting to open server with:', {
      username: backUpSetupConfig.username,
      password: backUpSetupConfig.password,
      target: backUpSetupConfig.backUpTasks[0].target,
    });

    console.log("Target:", backUpSetupConfig.backUpTasks[0].target);

    let [host, share] = backUpSetupConfig.backUpTasks[0].target.split(":");
    share = share.split("/")[0]

    console.log("Host:", host);  // Output: "hl4-test.local"
    console.log("Share:", share); // Output: "backups"

    nextStep();
  }
};

const proceedToPreviousStep = async () => {
  prevStep();
};

useEnterToAdvance(
  () => {
    proceedToNextStep(); // Enter
  },
  200, // debounce time for Enter
  () => {
    proceedToNextStep(); // ArrowRight
  },
  () => {
    proceedToPreviousStep(); // ArrowLeft
  }
);
</script>

<style scoped>
/* Tailwind is utility-based, so no custom CSS is needed here */
</style>
