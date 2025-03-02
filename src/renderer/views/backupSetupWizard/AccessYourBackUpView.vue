<template>
  <CardContainer>
    <template #header>
      <p class="text-header text-center text-3xl">
        Access Your Backups
      </p>
    </template>

    <div class="flex flex-col h-full justify-center items-center">
      <p class="w-9/12 text-center text-2xl">
        Select a backup from the list to view. You may need to log in—use the username and password from the initial setup.
      </p>

      <br />

      <p class="w-9/12 text-center text-2xl">
        If your backup is not showing make sure you set it up correctly by going back and creating a backup plan.
        <!-- <CommanderToolTip
          :message="``" /> -->
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

        <button @click="proceedToNextStep" class="btn btn-secondary w-40 h-20">
          Next
        </button>
      </div>

      </div>
    </template>

  </CardContainer>
</template>

<script setup lang="ts">
import CardContainer from '../../components/CardContainer.vue';
import { useWizardSteps } from '../../components/wizard';

const { completeCurrentStep, prevStep } = useWizardSteps("backup");

const proceedToNextStep = async () => {
  completeCurrentStep();
};
const proceedToPreviousStep = async () => {
  prevStep();
};

</script>

<style scoped></style>
