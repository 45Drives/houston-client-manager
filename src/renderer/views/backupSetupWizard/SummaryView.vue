<template>
  <CardContainer>
    <template #header class="!text-center">
      <div class="relative flex items-center justify-center h-18  w-full">
        <div class="absolute left-0 bg-white p-1 px-4 rounded-lg">
          <DynamicBrandingLogo :division="division" />
        </div>
        <p class="text-3xl font-semibold text-center">
          Summary
        </p>
        <div class="absolute right-0 top-1/2 -translate-y-1/2">
          <GlobalSetupWizardMenu />
        </div>
      </div>
    </template>

    <div class="w-9/12 mx-auto text-center">
      <p class="mb-6 text-2xl">
        You're almost finished! A summary of information can be found below. <br />
        If everything looks accurate, click <span class="font-bold">Next</span> to set up your backups. <br />
        If you'd like to make changes, click <span class="font-bold">Back.</span>
      </p>

      <div class="flex flex-col space-y-4 mt-[5rem]">
        <div class="flex items-center">
          <text class="text-default font-semibold text-left">Back Up Location</text>
          <CommanderToolTip :message="`This is the designated backup storage location you configured earlier.`" />
          <text class="text-default font-semibold text-left px-4">{{ backUpSetupConfig?.backUpTasks[0]?.target }}</text>
        </div>
      </div>

      <!-- Folder Selection -->
      <div class="flex flex-col space-y-4 mt-[2rem]">
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


    <!-- Buttons -->
    <template #footer>
      <div class="button-group-row justify-between">
        <button @click="proceedToPreviousStep" class="btn btn-primary h-20 w-40">Back</button>
        <button @click="handleNextClick" class="absolute btn right-[1rem] btn-primary h-20 w-40">Next</button>
      </div>
    </template>

  </CardContainer>
</template>

<script setup lang="ts">
import { CardContainer, CommanderToolTip, confirm, useEnterToAdvance } from "@45drives/houston-common-ui";
import { inject, ref } from "vue";
import { useWizardSteps, DynamicBrandingLogo } from '@45drives/houston-common-ui';
import { backUpSetupConfigKey, divisionCodeInjectionKey } from "../../keys/injection-keys";
import { formatFrequency } from "./utils";
import GlobalSetupWizardMenu from '../../components/GlobalSetupWizardMenu.vue';
const division = inject(divisionCodeInjectionKey);
const { completeCurrentStep, prevStep } = useWizardSteps("backup");

const backUpSetupConfig = inject(backUpSetupConfigKey);

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
