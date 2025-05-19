<template>
  <CardContainer>
    <!-- Header -->
    <template #header>
      <div class="relative flex items-center justify-center h-18  w-full">
        <div class="absolute left-0 p-1 px-4 rounded-lg">
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

    <!-- Main Content -->
    <div class="flex flex-col gap-8 px-8 py-6 text-default text-center items-center">
      <!-- Instruction -->
      <p class="text-lg text-center">
        Please provide your server, username and password for the backup you want to access.
      </p>

      <!-- Credential Form Layout -->
      <div class="flex flex-col lg:flex-row gap-10 w-full justify-center items-center">
        <!-- Server Selection -->
        <div class="w-full lg:w-2/5">
          <HoustonServerListView class="w-full text-xl" :filterOutStorageSetupComplete="false"
            @serverSelected="handleServerSelected" />
        </div>

        <!-- Username & Password -->
        <form @submit.prevent="proceedToNextStep" class="flex flex-col gap-4 mt-4 text-default">
          <div class="grid relative grid-cols-[200px_1fr] items-center">
            <label for="username" class="block mb-1 font-medium text-lg">Username</label>
            <input v-model="restoreBackUpData.username" v-enter-next type="text" id="username"
              class="input-textlike p-3 border border-default rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your username" />
          </div>
          <div class="grid relative grid-cols-[200px_1fr] items-center">
            <label for="password" class="font-semibold ">Password:</label>
            <input v-model="restoreBackUpData.password" v-enter-next :type="showPassword ? 'text' : 'password'"
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
    </div>

    <!-- Footer Buttons -->
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
import { useWizardSteps, DynamicBrandingLogo, useAutoFocus, useEnterToAdvance } from '@45drives/houston-common-ui';
import { divisionCodeInjectionKey, restoreBackUpSetupDataKey } from '../../keys/injection-keys';
import HoustonServerListView from '../../components/HoustonServerListView.vue';
import { Server } from '../../types';
import GlobalSetupWizardMenu from '../../components/GlobalSetupWizardMenu.vue';
useAutoFocus();
const division = inject(divisionCodeInjectionKey);
const restoreBackUpData = inject(restoreBackUpSetupDataKey)!;
const { prevStep, nextStep, wizardData } = useWizardSteps("restore-backup");

const openingBackup = ref(false);
const showPassword = ref(false);
const togglePassword = () => {
  showPassword.value = !showPassword.value;
};

// Check if the "Open" button should be disabled
const isButtonDisabled = computed(() => !restoreBackUpData?.username || !restoreBackUpData?.password || !restoreBackUpData.server || openingBackup.value);

// Method to handle the "Open" button action
const proceedToNextStep = () => {
  nextStep();
};

const proceedToPreviousStep = async () => {
  prevStep();
};

const handleServerSelected = async (server: Server | null) => {
  restoreBackUpData.server = server;
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
