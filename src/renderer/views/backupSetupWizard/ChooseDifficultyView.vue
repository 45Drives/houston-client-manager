<template>
  <CardContainer class="overflow-y-auto min-h-0">

    <div class="grid grid-cols-2 gap-10 text-2xl w-9/12 mx-auto">
      <CardContainer class="col-span-1 bg-accent border-default rounded-md">
        <template #header>
          <button @click="startCreateBackupSchedualSetup" class="btn btn-secondary w-full h-40 text-6xl">
            SIMPLE
          </button>
        </template>
        <div>
          <p>
            Quick and effortless method to setup your backup plan 45Drives Best Practice. Select <b>SIMPLE</b> to choose from our preset intervals and we
            will configure the backup plan for you.
          </p>
        </div>

      </CardContainer>

      <CardContainer class="relative col-span-1 bg-accent border-default rounded-md overflow-hidden">


        <template #header>
          <button @click="startCustomSetup" class="btn btn-secondary w-full h-40 text-6xl">
            CUSTOM
          </button>
        </template>

        <div>
          <p>
            Full control and flexibility? Select <b>CUSTOM</b> and you’ll have the option to fine-tune your backup start time and frequency.
          </p>
        </div>
      </CardContainer>
    </div>

    <template #footer>
      <div class="button-group-row justify-left">
        <button @click="proceedToPreviousStep" class="btn btn-secondary h-20 w-40">Back</button>
      </div>
    </template>
  </CardContainer>
</template>

<script setup lang="ts">
import CardContainer from '../../components/CardContainer.vue';
import { CommanderToolTip } from '../../components/commander';
import { useWizardSteps, useEnterToAdvance } from '@45drives/houston-common-ui';
import { useHeader } from '../../composables/useHeader'
useHeader('Choose Your Backup Schedule Type')
const { completeCurrentStep, prevStep } = useWizardSteps("backup-new");

const startCreateBackupSchedualSetup = () => {
  completeCurrentStep(true, { planType: "simple" });
};

const startCustomSetup = () => {
  completeCurrentStep(true, { planType: "custom" });

};

const proceedToPreviousStep = () => {
  prevStep();
};

useEnterToAdvance(
  () => { },     // Disable Enter
  0,            // No debounce needed if Enter does nothing
  () => { },     // Disable ArrowRight
  () => {
    proceedToPreviousStep(); // Enable only ArrowLeft
  }
);
</script>
