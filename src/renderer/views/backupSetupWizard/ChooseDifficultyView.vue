<template>
  <CardContainer class="overflow-y-auto min-h-0">
    <template #header>
      <div class="relative flex items-center justify-center h-18  w-full">
        <div class="absolute left-0 p-1 px-4 rounded-lg">
          <DynamicBrandingLogo :division="division" />
        </div>
        <p class="text-3xl font-semibold text-center">
          Choose Your Backup Type
        </p>
        <div class="absolute right-0 top-1/2 -translate-y-1/2">
          <GlobalSetupWizardMenu />
        </div>
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
            Quick and effortless method to setup your backup plan 45Drives Best Practice. Select <b>SIMPLE</b> and we
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
            Full control and flexibility? Select <b>CUSTOM</b> and you’ll have the options to choose your configuration
            details such as what time to run the backup.
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
import { useWizardSteps, DynamicBrandingLogo, useEnterToAdvance } from '@45drives/houston-common-ui';
import { divisionCodeInjectionKey } from '../../keys/injection-keys';
import { inject } from 'vue';
import GlobalSetupWizardMenu from '../../components/GlobalSetupWizardMenu.vue';
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

useEnterToAdvance(
  () => { },     // Disable Enter
  0,            // No debounce needed if Enter does nothing
  () => { },     // Disable ArrowRight
  () => {
    proceedToPreviousStep(); // Enable only ArrowLeft
  }
);
</script>
