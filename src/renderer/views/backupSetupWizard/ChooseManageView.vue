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
        <div
          class="text-center absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-7xl font-bold text-45d opacity-50 rotate-[-20deg] pointer-events-none">
          COMING SOON!
        </div>

        <template #header>
          <button disabled @click="startCustomSetup" class="btn btn-secondary w-full h-40 text-6xl">
            Access Your Backups
          </button>
        </template>

        <div class="text-muted">
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
import { useWizardSteps } from '../../components/wizard';

const { completeCurrentStep } = useWizardSteps();

const startCreateBackupSchedualSetup = () => {
  completeCurrentStep();
};

const startCustomSetup = () => {
};

const proceedToPreviousStep = () => {
  useWizardSteps().prevStep();
};

</script>
