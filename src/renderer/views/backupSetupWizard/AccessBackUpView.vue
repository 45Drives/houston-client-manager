<template>
  <CardContainer>
    <template #header>
      <div class="relative flex items-center justify-center h-18  w-full">
        <div class="absolute left-0 p-1 px-4 rounded-lg">
          <DynamicBrandingLogo :division="division" />
        </div>
        <p class="text-3xl font-semibold text-center">
          Review Your Backups
        </p>
        <div class="absolute right-0 top-1/2 -translate-y-1/2">
          <GlobalSetupWizardMenu />
        </div>
      </div>
    </template>

    <div class="flex flex-col h-full justify-center items-center text-default">
      <!-- Header with instructions -->
      <div>
        <p class="text-lg">
          Please provide your username and password to access the backup folders on the server:
        </p>
        <ul class="mt-2 list-disc list-inside text-blue-600">
          <li v-for="task in backupTasks" :key="task.uuid">
            {{ task.target }}
          </li>
        </ul>
        <p class="text-lg mt-2">
          The share will be mounted once, and all relevant folders will be opened.
        </p>
      </div>

      <!-- Username and Password input fields -->
      <div class="flex flex-col gap-4 mt-4 text-default">
        <label for="username" class="font-semibold ">Username:</label>
        <input v-model="username" v-enter-next type="text" id="username"
          class="p-2 input-textlike rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter your username" />

        <label for="password" class="font-semibold ">Password:</label>
        <input v-model="password" v-enter-next type="password" id="password"
          class="p-2 input-textlike rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter your password" />
      </div>

      <!-- "Open" button -->
      <div class="mt-4 flex flex-row ">
        <button @click="handleOpen" :disabled="isButtonDisabled"
          class="w-full p-3 btn btn-secondary font-semibold rounded-md  disabled:cursor-not-allowed">
          Open
        </button>

        <LoadingSpinner v-if="openingBackup" />
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
import GlobalSetupWizardMenu from '../../components/GlobalSetupWizardMenu.vue';
import { ref, computed, inject, watch } from 'vue';
import { useWizardSteps, DynamicBrandingLogo, useEnterToAdvance, useAutoFocus } from '@45drives/houston-common-ui';
import { BackUpTask, IPCRouter } from '@45drives/houston-common-lib';
import { divisionCodeInjectionKey } from '../../keys/injection-keys';
useAutoFocus();
const division = inject(divisionCodeInjectionKey);
const { prevStep, wizardData } = useWizardSteps("backup");

const backupTasks = computed(() => wizardData as BackUpTask[]);

const username = ref('');
const password = ref('');
const openingBackup = ref(false);

// Check if the "Open" button should be disabled
const isButtonDisabled = computed(() => !username.value || !password.value || openingBackup.value);

// Method to handle the "Open" button action
let smbMountListener: ((data: any) => void) | null = null;

const handleOpen = () => {
  if (!username.value || !password.value || backupTasks.value.length === 0) return;

  // Remove previous listener if exists
  if (smbMountListener) {
    IPCRouter.getInstance().removeEventListener("action", smbMountListener);
  }

  smbMountListener = (data) => {
    try {
      const response = JSON.parse(data);
      if (response.action === "mountSmbResult") {
        openingBackup.value = false;
        smbMountListener = null;

        const baseMountPath = `/mnt/${share}`;
        for (const task of backupTasks.value) {
          const relative = task.target.split(":")[1].split("/").slice(1).join("/");
          const fullPath = `${baseMountPath}/${relative}`;

          IPCRouter.getInstance().send("backend", "action", JSON.stringify({
            type: "openFolder",
            path: fullPath
          }));
        }
      }
    } catch (e) {
      console.error("Failed to parse SMB mount result:", e);
      openingBackup.value = false;
    }
  };

  IPCRouter.getInstance().addEventListener("action", smbMountListener);

  // Proceed with mount
  const [host, fullPath] = backupTasks.value[0].target.split(":");
  const share = fullPath.split("/")[0];

  IPCRouter.getInstance().send("backend", "mountSambaClient", {
    smb_host: host,
    smb_share: share,
    smb_user: username.value,
    smb_pass: password.value
  });

  openingBackup.value = true;
};

const proceedToPreviousStep = async () => {
  prevStep();
};

useEnterToAdvance(
  () => {
    if (!isButtonDisabled.value) {
      handleOpen(); // Enter triggers "Open"
    }
  },
  300,        // debounce
  () => { },   // Disable ArrowRight
  () => {
    proceedToPreviousStep(); // ← triggers Back
  }
);
</script>

<style scoped>

</style>
