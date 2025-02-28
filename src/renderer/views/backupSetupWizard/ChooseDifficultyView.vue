<template>
  <CardContainer class="">
    <template #header>
      <div class="flex flex-row justify-center text-center items-center text-3xl">
        Choose Your Setup Option &nbsp;
        <CommanderToolTip :message="`Choose how your storage server will be setup and configured.`" :width="600" />
      </div>
    </template>

    <div class="grid grid-cols-2 gap-10 text-2xl w-9/12 mx-auto">
      <CardContainer class="col-span-1 bg-accent border-default rounded-md">
        <template #header>
          <button @click="startCreateBackupSchedualSetup" class="btn btn-secondary w-full h-40 text-6xl">
            Simple
          </button>
        </template>
        <div>
          <p>
            Quick and effortless method to setup your backup plan 45Drives Best Practice. Select <b>SIMPLE</b> and we will configure the good backup plan. 
          </p>
        </div>

      </CardContainer>

      <CardContainer class="relative col-span-1 bg-accent border-default rounded-md overflow-hidden">
        <div
          class="text-center absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-7xl font-bold text-45d opacity-50 rotate-[-20deg] pointer-events-none">
          CUSTOM
        </div>

        <template #header>
          <button disabled @click="startCustomSetup" class="btn btn-secondary w-full h-40 text-6xl">
            CUSTOM
          </button>
        </template>

        <div class="text-muted">
          <p>
            Full control and flexibility? Select <b>CUSTOM</b> and you’ll have the options to choose your configuration details such as time files
          </p>
        </div>


      </CardContainer>
    </div>

    <template #footer>
      <div class="button-group-row justify-left">
        <button @click="proceedToPreviousStep" class="btn btn-primary h-20 w-40">Back</button>
      </div>
    </template>
  </CardContainer>
</template>

<script setup lang="ts">
import CardContainer from '../../components/CardContainer.vue';
import { CommanderToolTip } from '../../components/commander';
import { useWizardSteps } from '../../components/wizard';

const { completeCurrentStep, prevStep } = useWizardSteps();

const startCreateBackupSchedualSetup = () => {
  completeCurrentStep();
};

const startCustomSetup = () => {
};

const proceedToPreviousStep = () => {
  prevStep();
};

</script>
