<template>
  <CardContainer>
    <template #header>
      <p class="text-header text-center text-3xl">
        Access Your Backup
      </p>
    </template>

    <div class="flex flex-col h-full justify-center items-center text-default">
      <!-- Header with instructions -->
      <div>
        <p class=" text-lg">
          Please provide your username and password to access the backup folder on the server at
          <strong class="text-blue-600">{{ backupTask.target }}</strong>
        </p>
        <p class=" text-lg mt-2">
          We will automatically open the backup folder once you provide your credentials.
        </p>
      </div>

      <!-- Username and Password input fields -->
      <div class="flex flex-col gap-4 mt-4 text-default">
        <label for="username" class="font-semibold ">Username:</label>
        <input v-model="username" type="text" id="username"
          class="p-2 input-textlike rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter your username" />

        <label for="password" class="font-semibold ">Password:</label>
        <input v-model="password" type="password" id="password"
          class="p-2 input-textlike rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter your password" />
      </div>

      <!-- "Open" button -->
      <div class="mt-4">
        <button @click="handleOpen" :disabled="isButtonDisabled"
          class="w-full p-3 btn btn-secondary font-semibold rounded-md  disabled:cursor-not-allowed">
          Open
        </button>
      </div>
    </div>

    <!-- Buttons -->
    <template #footer>
      <div class="button-group-row w-full justify-end">
        <div class="button-group-row w-full justify-between">
          <button @click="proceedToPreviousStep" class="btn btn-secondary w-40 h-20">
            Back
          </button>

        </div>

      </div>
    </template>

  </CardContainer>
</template>

<script setup lang="ts">
import CardContainer from '../../components/CardContainer.vue';
import { ref, computed, watch } from 'vue';
import { useWizardSteps } from '../../components/wizard';
import { IPCRouter } from '@45drives/houston-common-lib';

const { completeCurrentStep, prevStep, wizardData } = useWizardSteps("backup");

const backupTask = computed(() => wizardData.value);  // if wizardData is a ref// Reactive variables for username and password
const username = ref('');
const password = ref('');

// Check if the "Open" button should be disabled
const isButtonDisabled = computed(() => !username.value || !password.value);

// Method to handle the "Open" button action
const handleOpen = () => {
  if (username.value && password.value) {
    // Trigger your backend logic for opening the server (you will handle the action)
    // Pass username, password, and backupTask.target (URL) to your backend code
    // For example: openBackupServer(username.value, password.value, props.backupTask.target);
    console.log('Attempting to open server with:', {
      username: username.value,
      password: password.value,
      target: backupTask.value?.target,
    });

    const [host, share] = backupTask.value?.target.split(":");

    console.log("Host:", host);  // Output: "hl4-test.local"
    console.log("Share:", share); // Output: "backups"

    IPCRouter.getInstance().send('backend', 'mountSambaClient',
      {
        smb_host: host,
        smb_share: share,
        smb_user: username.value,
        smb_pass: password.value,
      }
    );
  }
};

const proceedToPreviousStep = async () => {
  prevStep();
};

</script>

<style scoped>
/* Tailwind is utility-based, so no custom CSS is needed here */
</style>
