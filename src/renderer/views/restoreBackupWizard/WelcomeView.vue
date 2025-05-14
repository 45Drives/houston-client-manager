<template>
  <CardContainer>
    <template #header>
      <div class="relative flex items-center justify-center h-18  w-full">
        <div class="absolute left-0 bg-white p-1 px-4 rounded-lg">
          <DynamicBrandingLogo :division="division" />
        </div>
        <p class="text-3xl font-semibold text-center">
          Welcome to the 45Drives Backup Restore Wizard!
        </p>
        <div class="absolute right-0 top-1/2 -translate-y-1/2">
          <GlobalSetupWizardMenu />
        </div>
      </div>
    </template>

    <div class="flex flex-col h-full justify-center items-center">

      <p class="w-9/12 text-left text-2xl">
        Your data matters—let’s bring it back safely. The restore wizard will help you recover files from your existing
        backups.
      </p>

      <br />

      <p class="w-9/12 text-left text-2xl">
        Whether you’re recovering a single document or an entire system backup, this wizard will guide you through
        selecting the files and restoring them to the correct location.
      </p>

      <br />

      <p class="w-9/12 text-left text-2xl">
        You’ll be able to review backed-up files, choose which ones to restore, and let the system handle the rest.
      </p>

      <br />

      <p class="w-9/12 text-left text-2xl">
        Anywhere you see this icon: &nbsp;
        <CommanderToolTip :message="`Welcome to the 45Drives Restore Wizard! \n I'm the Houston Commander, and I’ll give you helpful tips as you go. 
          Click anywhere outside of these popups (or the X in the top-right corner) to close them.`" />
        &nbsp; Houston Commander has something helpful to say!
        Just hover over the icon to see a tip.
      </p>

      <br />

      <p class="w-9/12 text-center text-2xl">
        When you're ready, click <b>NEXT</b> to begin the restore process.
      </p>
    </div>

    <!-- Buttons -->
    <template #footer>
      <div class="button-group-row w-full justify-end">
        <button @click="proceedToNextStep" class="btn btn-primary w-40 h-20">
          Next
        </button>
      </div>
    </template>
  </CardContainer>
</template>

<script setup lang="ts">
import CardContainer from '../../components/CardContainer.vue';
import { CommanderToolTip } from '../../components/commander';
import GlobalSetupWizardMenu from '../../components/GlobalSetupWizardMenu.vue';
import { useWizardSteps, DynamicBrandingLogo, useEnterToAdvance } from '@45drives/houston-common-ui';
import { divisionCodeInjectionKey } from '../../keys/injection-keys';
import { inject } from 'vue';
const division = inject(divisionCodeInjectionKey);
const { completeCurrentStep } = useWizardSteps("restore-backup");

const proceedToNextStep = async () => {
  completeCurrentStep();
};

useEnterToAdvance(
  () => {
    proceedToNextStep(); // Enter
  },
  200, // debounce time for Enter
  () => {
    proceedToNextStep(); // ArrowRight
  }
);
</script>

<style scoped></style>
