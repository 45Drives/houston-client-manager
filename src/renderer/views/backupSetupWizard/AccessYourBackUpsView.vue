<template>
  <CardContainer>
    <template #header>
      <div class="relative flex items-center justify-center h-24">
        <div class="absolute left-0">
          <DynamicBrandingLogo />
        </div>
        <p class="text-header text-2xl font-semibold text-center">
          Access Your Backups
        </p>
      </div>
    </template>

    <div class="flex flex-col h-full justify-center items-center">
      <p class="w-9/12 text-center text-2xl">
        Select a backup from the list to view. You may be prompted for password.
      </p>

      <br />

      <BackUpListView class=" p-5 justify-center text-2xl" @backUpTaskSelected="handleBackUpTaskSelected" />

      <p class="w-9/12 text-center text-2xl">
        If your backup is not showing make sure you set it up correctly by going back and creating a backup plan.
      </p>

      <br />

      <p class="text-center text-2xl">
        Once you have one of the boxes checked, click <b>NEXT</b>.
      </p>

    </div>

    <!-- Buttons -->
    <template #footer>
      <div class="button-group-row w-full justify-end">

        <div class="button-group-row w-full justify-between">
          <button @click="proceedToPreviousStep" class="btn btn-secondary w-40 h-20">
            Back
          </button>

          <button @click="proceedToNextStep" class="btn btn-secondary w-40 h-20"
            :class="[(!selectedBackUpTask ? 'disabled' : '')]" :disabled="!selectedBackUpTask">
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
import { useWizardSteps, DynamicBrandingLogo } from '@45drives/houston-common-ui';
import BackUpListView from './BackUpListView.vue';
import { ref } from 'vue';

const selectedBackUpTask = ref<BackUpTask | null>(null);
const handleBackUpTaskSelected = (backUpTask: BackUpTask | null) => {
  selectedBackUpTask.value = backUpTask;
}

const { completeCurrentStep, prevStep } = useWizardSteps("backup");

const proceedToNextStep = async () => {
  if (selectedBackUpTask.value) {
    console.log('selectedBackupTask:', selectedBackUpTask.value);
    completeCurrentStep(true, selectedBackUpTask.value);
  } else {
    throw new Error("Should have selected a Back Up to access")
  }
};
const proceedToPreviousStep = async () => {
  prevStep();
};

</script>

<style scoped></style>
