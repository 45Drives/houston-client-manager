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

    <div class="flex flex-col h-full justify-center items-center">
      <p class="w-9/12 text-center text-2xl">
        Select a backup from the list to view. You may be prompted for password.
      </p>

      <br />

      <div class="overflow-hidden w-full">
        <div class="bg-well p-4 rounded-lg border border-default max-h-[50vh] overflow-y-auto">
          <BackUpListView ref="backUpListRef" class="p-5 justify-center text-2xl"
            @backUpTaskSelected="handleBackUpTaskSelected" />

        </div>
      </div>

      <p class="w-9/12 text-center text-2xl mt-2">
        If your backup is not showing make sure you set it up correctly by going back and creating a backup plan.
      </p>

      <br />

      <p class="text-center text-2xl">
        Select one or more backup tasks to continue or delete. When ready, click <b>NEXT</b>>.
      </p>


    </div>

    <!-- Buttons -->
    <template #footer>
      <div class="button-group-row w-full justify-end">

        <div class="button-group-row w-full justify-between">
          <button @click="proceedToPreviousStep" class="btn btn-secondary w-40 h-20">
            Back
          </button>

          <button @click="deleteSelectedTasks" class="btn btn-danger w-40 h-20"
            :disabled="selectedBackUpTasks.length === 0">
            Cancel Selected Tasks
          </button>

          <button @click="proceedToNextStep" class="btn btn-primary w-40 h-20"
            :disabled="selectedBackUpTasks.length === 0">
            Next
          </button>
        </div>

      </div>
    </template>

  </CardContainer>
</template>

<script setup lang="ts">
import { BackUpTask } from '@45drives/houston-common-lib';
import CardContainer from '../../components/CardContainer.vue';
import { useWizardSteps, DynamicBrandingLogo, confirm, useEnterToAdvance } from '@45drives/houston-common-ui';
import BackUpListView from './BackUpListView.vue';
import GlobalSetupWizardMenu from '../../components/GlobalSetupWizardMenu.vue';
import { inject, ref } from 'vue';
import { divisionCodeInjectionKey } from '../../keys/injection-keys';
const division = inject(divisionCodeInjectionKey);

const selectedBackUpTasks = ref<BackUpTask[]>([]);
const handleBackUpTaskSelected = (tasks: BackUpTask[]) => {
  selectedBackUpTasks.value = tasks;
};

const backUpListRef = ref();

const deleteSelectedTasks = () => {
  // console.log("[Parent] 🗑️ deleteSelectedTasks triggered");

  if (backUpListRef.value?.deleteSelectedTasks) {
    // console.log("[Parent] Calling child deleteSelectedTasks...");
    backUpListRef.value.deleteSelectedTasks();
  } else {
    console.warn("[Parent] backUpListRef or child method is undefined");
  }
};



const { completeCurrentStep, unCompleteCurrentStep, prevStep } = useWizardSteps("backup");

const proceedToNextStep = async () => {
  if (selectedBackUpTasks.value.length < 1) {
    throw new Error("Select at least one backup task to proceed");
  }

  unCompleteCurrentStep();
  completeCurrentStep(true, selectedBackUpTasks.value);
};

const proceedToPreviousStep = async () => {
  prevStep();
};

useEnterToAdvance(
  () => {
    if (selectedBackUpTasks.value.length > 0) {
      proceedToNextStep(); // Enter
    }
  },
  300,
  () => {
    if (selectedBackUpTasks.value.length > 0) {
      proceedToNextStep(); // → Arrow
    }
  },
  () => {
    proceedToPreviousStep(); // ← Arrow
  }
);
</script>

<style scoped></style>
