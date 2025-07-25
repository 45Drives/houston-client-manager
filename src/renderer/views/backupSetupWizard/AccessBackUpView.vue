<template>
  <CardContainer class="overflow-y-auto min-h-0">
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

        <ul class="mt-2 list-disc list-inside text-blue-600">
          <li v-for="task in backupTasks" :key="task.uuid">
            {{ task.host }}:{{ task.share }}{{thisOs == 'win' ? '\\\\' : ''}}{{ task.target }}
          </li>
        </ul>
        <p class="text-lg mt-2">
          The share will be mounted once, and all relevant folders will be opened.
        </p>
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
import { EyeIcon, EyeSlashIcon } from "@heroicons/vue/20/solid";
import { useWizardSteps, DynamicBrandingLogo, useEnterToAdvance, useAutoFocus } from '@45drives/houston-common-ui';
import { BackUpTask, IPCRouter } from '@45drives/houston-common-lib';
import { divisionCodeInjectionKey, thisOsInjectionKey } from '../../keys/injection-keys';
useAutoFocus();
const division = inject(divisionCodeInjectionKey);
const { prevStep, wizardData } = useWizardSteps("backup");
const thisOs = inject(thisOsInjectionKey);
const backupTasks = computed(() => wizardData as BackUpTask[]);

const username = ref('');
const password = ref('');
const openingBackup = ref(false);
const showPassword = ref(false);
const togglePassword = () => {
  showPassword.value = !showPassword.value;
};

// Check if the "Open" button should be disabled
const isButtonDisabled = computed(() => openingBackup.value);

// Method to handle the "Open" button action
let smbMountListener: ((data: any) => void) | null = null;

const handleOpen = () => {
  if (backupTasks.value.length === 0) return;

  openingBackup.value = true;

  const sharesMounted: Set<string> = new Set();
  let remainingShares = new Set(backupTasks.value.map(task => `${task.host}:${task.share}`));

  smbMountListener = (data) => {
    openingBackup.value = false;
    try {
      const response = JSON.parse(data);
      if (response.action !== 'mountSmbResult') return;

      let info: any = typeof response.result === 'string'
        ? JSON.parse(response.result)
        : response.result;

      const mountPoint = info.MountPoint ?? (info.DriveLetter ? `${info.DriveLetter}:\\` : null);
      if (!mountPoint) {
        console.warn("No valid mount point found in result");
        // Still mark this share as "processed" to prevent infinite wait
        remainingShares.delete(`${info.smb_server}:${info.smb_share}`);
        if (remainingShares.size === 0) {
          openingBackup.value = false;
          smbMountListener = null;
        }
        return;
      }

      const shareName = mountPoint.split(/[\\/]/).filter(Boolean).pop() ?? info.smb_share;
      const mountedShare = `${info.smb_server}:${shareName}`;

      sharesMounted.add(mountedShare);
      remainingShares.delete(mountedShare);

      if (remainingShares.size === 0) {
        openingBackup.value = false;
        smbMountListener = null;

        for (const task of backupTasks.value) {
          const normalizedTarget = task.target.startsWith('/') ? task.target : `/${task.target}`;

          const mountPath =
            thisOs?.value === 'win'
              ? `${info.DriveLetter}:\\${task.target}`
              : thisOs?.value === 'mac'
                ? `/Volumes/${task.share}${normalizedTarget}`
                : `/mnt/houston-mounts/${task.share}${normalizedTarget}`;

          IPCRouter.getInstance().send('backend', 'action', JSON.stringify({
            type: 'openFolder',
            path: mountPath
          }));
        }
      }
      if (smbMountListener) {
        IPCRouter.getInstance().removeEventListener("action", smbMountListener);
      }
    } catch (e) {
      console.error('Failed to parse SMB mount result:', e);
      openingBackup.value = false;
    }
  };

  IPCRouter.getInstance().addEventListener("action", smbMountListener);

  // Initiate mount requests for each unique share
  const uniqueShares = new Set(backupTasks.value.map(task => `${task.host}:${task.share}`));

  for (const entry of uniqueShares) {
    const [host, share] = entry.split(":");
    IPCRouter.getInstance().send("backend", "mountSambaClient", {
      smb_host: host,
      smb_share: share,
      smb_user: username.value,
      smb_pass: password.value
    });
  }
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
  200,        // debounce
  () => { },   // Disable ArrowRight
  () => {
    proceedToPreviousStep(); // ← triggers Back
  }
);
</script>

<style scoped>

</style>
