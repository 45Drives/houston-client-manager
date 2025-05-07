<!-- <template>
  <CardContainer>
    <template #header>
      <div class="relative flex items-center justify-center h-18">
        <div class="absolute left-0 bg-white p-1 px-4 rounded-lg">
          <DynamicBrandingLogo :division="division" />
        </div>
        <p class="text-3xl font-semibold text-center">
          Server Credentials
        </p>
      </div>
    </template>

    <div class="flex flex-col h-full justify-center items-center text-default">
      <div>
        <p class=" text-lg">
          Please provide your server, username and password for the backup you want to access.
        </p>
      </div>

      <div class="flex flex-row justify-between">
        <div>
          <HoustonServerListView class="w-1/3 px-5 justify-center text-2xl" @serverSelected="handleServerSelected" />
        </div>
        <div class="flex flex-col gap-4 mt-4 text-default">
          <label for="username" class="font-semibold ">Username:</label>
          <input v-model="restoreBackUpData.username" type="text" id="username"
            class="p-2 input-textlike rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter your username" />

          <label for="password" class="font-semibold ">Password:</label>
          <input v-model="restoreBackUpData.password" type="password" id="password"
            class="p-2 input-textlike rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter your password" />
        </div>
      </div>
    </div>
    <template #footer>
      <div class="button-group-row w-full justify-end">
        <div class="button-group-row w-full justify-between">

          <button @click="proceedToPreviousStep" class="btn btn-secondary w-40 h-20">
            Back
          </button>

          <button :disabled="isButtonDisabled" @click="proceedToNextStep" class="btn btn-secondary w-40 h-20">
            Next
          </button>

        </div>
      </div>
    </template>

  </CardContainer>
</template> -->
<template>
  <CardContainer>
    <!-- Header -->
    <template #header>
      <div class="relative flex items-center justify-center h-18">
        <div class="absolute left-0 bg-white p-1 px-4 rounded-lg">
          <DynamicBrandingLogo :division="division" />
        </div>
        <p class="text-3xl font-semibold text-center">
          Server Credentials
        </p>
      </div>
    </template>

    <!-- Main Content -->
    <div class="flex flex-col gap-8 px-8 py-6 text-default">
      <!-- Instruction -->
      <p class="text-lg text-center">
        Please provide your server, username and password for the backup you want to access.
      </p>

      <!-- Credential Form Layout -->
      <div class="flex flex-col lg:flex-row gap-10 w-full justify-center items-start">
        <!-- Server Selection -->
        <div class="w-full lg:w-2/5">
          <HoustonServerListView class="w-full text-xl" :filterOutStorageSetupComplete="false" @serverSelected="handleServerSelected" />
        </div>

        <!-- Username & Password -->
        <div class="flex flex-col gap-6 w-full lg:w-2/5">
          <div>
            <label for="username" class="block mb-1 font-medium text-lg">Username</label>
            <input v-model="restoreBackUpData.username" type="text" id="username"
              class="input-textlike p-3 border border-default rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your username" />
          </div>
          <div>
            <label for="password" class="block mb-1 font-medium text-lg">Password</label>
            <input v-model="restoreBackUpData.password" type="password" id="password"
              class="input-textlike p-3 border border-default rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your password" />
          </div>
        </div>
      </div>
    </div>

    <!-- Footer Buttons -->
    <template #footer>
      <div class="button-group-row w-full justify-end">
        <div class="button-group-row w-full justify-between">

          <button @click="proceedToPreviousStep" class="btn btn-secondary w-40 h-20">
            Back
          </button>

          <button :disabled="isButtonDisabled" @click="proceedToNextStep" class="btn btn-secondary w-40 h-20">
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
import { useWizardSteps, DynamicBrandingLogo } from '@45drives/houston-common-ui';
import { divisionCodeInjectionKey, restoreBackUpSetupDataKey } from '../../keys/injection-keys';
import HoustonServerListView from '../../components/HoustonServerListView.vue';
import { Server } from '../../types';

const division = inject(divisionCodeInjectionKey);
const restoreBackUpData = inject(restoreBackUpSetupDataKey)!;
const { prevStep, nextStep, wizardData } = useWizardSteps("restore-backup");

const openingBackup = ref(false);

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

</script>

<style scoped>
/* Tailwind is utility-based, so no custom CSS is needed here */
</style>
