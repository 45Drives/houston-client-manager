<template>
  <CardContainer class="">
    <template #header>
      <div class="relative flex items-center justify-center h-24">
          <div class="absolute left-0 bg-white p-1 px-4 rounded-lg">
          <DynamicBrandingLogo :division="division" />
        </div>
        <p class="text-header text-2xl font-semibold text-center">
          Choose Your Setup Option &nbsp;
        <CommanderToolTip :message="`Choose how your storage server will be setup and configured.`" :width="600" />
        </p>
      </div>
    </template>

    <div class="grid grid-cols-2 gap-10 text-2xl w-9/12 mx-auto">
      <CardContainer class="col-span-1 bg-accent border-default rounded-md">
        <template #header>
          <button @click="startCreateBackupSchedualSetup" class="btn btn-secondary w-full h-40 text-6xl">
            SIMPLE
          </button>
        </template>
        <div>
          <p>
            Quick and effortless method to setup your backup plan 45Drives Best Practice. Select <b>SIMPLE</b> and we will configure the backup plan for you. 
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
            Full control and flexibility? Select <b>CUSTOM</b> and you’ll have the options to choose your configuration details such as what time to run the backup.
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
import { useWizardSteps, DynamicBrandingLogo } from '@45drives/houston-common-ui';
import { divisionCodeInjectionKey } from '../../keys/injection-keys';
import { inject } from 'vue';
const division = inject(divisionCodeInjectionKey);
const { completeCurrentStep, prevStep } = useWizardSteps("backup");

const startCreateBackupSchedualSetup = () => {
  completeCurrentStep(true, { choice: "simple" });
};

const startCustomSetup = () => {
  completeCurrentStep(true, { choice: "custom" });

};

const proceedToPreviousStep = () => {
  prevStep();
};

</script>
