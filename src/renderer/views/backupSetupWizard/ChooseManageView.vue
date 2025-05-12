<template>
  <CardContainer class="">
    <template #header>
      <div class="relative flex items-center justify-center h-18  w-full">
        <div class="absolute left-0 bg-white p-1 px-4 rounded-lg">
          <DynamicBrandingLogo :division="division" />
        </div>
        <p class="text-3xl font-semibold text-center">
          Choose Your Setup Option &nbsp;
          <CommanderToolTip :message="`Choose how your storage server will be setup and configured.`" :width="600" />
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
            Create Backup Schedule
          </button>
        </template>

        <div>
          <p>
            Choose how often to safeguard your data—daily, weekly, or custom intervals. A well-timed backup ensures
            you're
            always prepared for the unexpected!
          </p>
        </div>

      </CardContainer>

      <CardContainer class="relative col-span-1 bg-accent border-default rounded-md overflow-hidden">

        <template #header>
          <button @click="startAccessBackupSetup" class="btn btn-secondary w-full h-40 text-6xl">
            Review Your Backups
          </button>
        </template>

        <div>
          <p>
            Take a look at backed-up data. Ensure everything is protected and up to date!
          </p>
        </div>

      </CardContainer>
    </div>

    <template #footer>

      <div class="button-group-row w-full justify-between">

        <button @click="proceedToPreviousStep" class="btn btn-secondary w-40 h-20">
          Back
        </button>
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
import GlobalSetupWizardMenu from '../../components/GlobalSetupWizardMenu.vue';
const division = inject(divisionCodeInjectionKey);
const { completeCurrentStep, prevStep } = useWizardSteps("backup");

const startCreateBackupSchedualSetup = () => {
  completeCurrentStep(true, { choice: "createBackup" });
};

const startAccessBackupSetup = () => {
  completeCurrentStep(true, { choice: "accessBackups" });
};

const proceedToPreviousStep = () => {
  prevStep();
};

</script>
