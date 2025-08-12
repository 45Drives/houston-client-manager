<template>
  <CardContainer class="overflow-y-auto min-h-0">
    
    <div class="w-9/12 mx-auto text-center">
      <p class="mb-6 text-2xl">
        You're almost finished! A summary of information can be found below. <br />
        If everything looks accurate, click <span class="font-bold">Next</span> to set up your backups. <br />
        If you'd like to make changes, click <span class="font-bold">Back.</span>
      </p>
      <p v-if="(thisOs === 'rocky' || thisOs === 'debian') && isFirstBackupRun"
        class="p-2 bg-red-500/50 font-bold rounded-md">
        Note: On Linux, if this is your first time creating a backup, you will be prompted to enter sudo/admin
        credentials.<br /> This is expected, and is only done on the first backup creation in order to configure the
        network share location.
      </p>
      <p v-if="(thisOs === 'mac')" class="p-2 bg-red-500/50 font-bold rounded-md">
        <strong>Note:</strong> On macOS, if this is your first time creating a backup, you need to grant
        <code>cron</code> <em>Full Disk Access</em> so it can read files from all folders.
        <br />
        To do this, go to:
        <strong>System Settings → Privacy & Security → Full Disk Access</strong> and enable access for
        <code>cron</code>.
      </p>
      <div class="flex flex-col space-y-4 mt-[5rem]">
        <div class="flex items-center">
          <text class="text-default font-semibold text-left mr-2">Back Up Location</text>
          <CommanderToolTip :message="`This is the designated backup storage location you configured earlier.`" />
          <text class="text-default font-semibold text-left px-4">{{ `${actualHost}:${actualShare}` }}</text>
        </div>
      </div>

      <!-- Folder Selection -->
      <div class="flex flex-col space-y-4 mt-[2rem]">
        <div v-if="backUpSetupConfig?.backUpTasks.length! > 0"
          class="overflow-y-auto max-h-[40vh] space-y-4">
          <div v-for="(task, index) in backUpSetupConfig?.backUpTasks" :key="index" class="flex items-center">
            <div class="text-start w-[50%]">
              <text class="text-default font-semibold text-left">Folder:</text>

              <text class="text-default font-semibold text-left px-4">{{ task.source }}</text>
            </div>
            <div class="text-start w-[50%] flex items-center">
              <text class="text-default font-semibold text-left">When:</text>
              <text class="text-default font-semibold text-left px-4">{{ `Backup
                will run
                ${formatFrequency(task.schedule.repeatFrequency)} starting on
                ${task.schedule.startDate.toDateString()} at ${task.schedule.startDate.toLocaleTimeString([], {
                hour:
                  '2-digit', minute: '2-digit' })}`}}</text>

            </div>
          </div>
        </div>
      </div>

    </div>


    <!-- Buttons -->
    <template #footer>
      <div class="button-group-row justify-between">
        <button @click="proceedToPreviousStep" class="btn btn-primary h-20 w-40">Back</button>
        <button @click="handleNextClick" class="btn btn-primary h-20 w-40">Next</button>
      </div>
    </template>

  </CardContainer>
</template>

<script setup lang="ts">
import { CardContainer, CommanderToolTip, confirm, useEnterToAdvance } from "@45drives/houston-common-ui";
import { inject, onMounted, ref } from "vue";
import { useWizardSteps} from '@45drives/houston-common-ui';
import { backUpSetupConfigKey, thisOsInjectionKey } from "../../keys/injection-keys";
import { formatFrequency } from "./utils";
import { useHeader } from '../../composables/useHeader'
useHeader('Summary')

const thisOs = inject(thisOsInjectionKey);

const isFirstBackupRun = ref(false);

const { completeCurrentStep, prevStep } = useWizardSteps("backup");

const backUpSetupConfig = inject(backUpSetupConfigKey);

const actualHost = ref('');
const actualShare = ref('');

onMounted(async () => {
  // console.debug("backUpSetupConfig:", backUpSetupConfig);

  const target = backUpSetupConfig?.backUpTasks?.[0]?.target;
  // console.debug("Target for isFirstBackupRun check:", target);
  if (!target) return;

  const [host, path] = target.split(":");
  const share = path.split("/")[0];
  actualHost.value = host;
  actualShare.value = share;
  const result = await window.electron.isFirstRunNeeded(host, share);
  // console.debug("First run result:", result);

  isFirstBackupRun.value = result;
});


const proceedToNextStep = async () => {
  completeCurrentStep();
};

const proceedToPreviousStep = () => {
  prevStep();
};

const handleNextClick = async () => {
  proceedToNextStep();

};

useEnterToAdvance(
  async () => {
    await handleNextClick(); // Enter
  },
  200, // debounce time for Enter
  async () => {
    await handleNextClick(); // ArrowRight
  },
  async () => {
    await proceedToPreviousStep(); // ArrowLeft
  }
);
</script>
