<template>
  <CardContainer class="overflow-y-auto min-h-0">
    <template #header>
      <div class="relative flex items-center justify-center h-18  w-full">
        <div class="absolute left-0 p-1 px-4 rounded-lg">
         <DynamicBrandingLogo :division="division" :height="(division === 'studio' ? 16 : 12)"/>

        </div>
        <p class="text-3xl font-semibold text-center">
          Welcome to the 45Drives Backup Setup Wizard!
        </p>
        <div class="absolute right-0 top-1/2 -translate-y-1/2">
          <GlobalSetupWizardMenu />
        </div>
      </div>
    </template>

    <div class="flex flex-col h-full justify-center items-center">

      <p class="w-9/12 text-left text-2xl">
        Your data is precious—protect it with the power of backups! A backup ensures your files are safe from accidents,
        failures, and digital mischief. Set up your protection now and keep your data secure, always.
      </p>

      <br />

      <p class="w-9/12 text-left text-2xl">
        We will set up automated backups with your chosen folders and schedule when they should happen. Back up tasks
        will be added to your system so you don’t have to worry.
      </p>

      <br />

      <p class="w-9/12 text-left text-2xl">
        This setup wizard will guide you through the steps to get your backups setup quickly.
      </p>

      <br />

      <p class="w-9/12 text-left text-2xl">
        Anywhere you see this icon: &nbsp;
        <CommanderToolTip :message="`Welcome to the 45Drives Setup Wizard! \n I'm the Houston Commander, and I'm here to show you some tips, tricks and information. 
          Click anywhere outside of these popups (or the X in the top-right corner) to close them.`" />
        &nbsp; it means that your new friend Houston Commander has something to say!
        Simply hover your mouse cursor over the icon and you will see him pop up.
      </p>

      <br />

      <p class="w-9/12 text-center text-2xl">
        To get started, simply click <b>NEXT</b>
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
import { useWizardSteps, DynamicBrandingLogo, useEnterToAdvance } from '@45drives/houston-common-ui';
import { divisionCodeInjectionKey } from '../../keys/injection-keys';
import { inject } from 'vue';
import GlobalSetupWizardMenu from '../../components/GlobalSetupWizardMenu.vue';

const division = inject(divisionCodeInjectionKey);
const { completeCurrentStep } = useWizardSteps("backup");

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
