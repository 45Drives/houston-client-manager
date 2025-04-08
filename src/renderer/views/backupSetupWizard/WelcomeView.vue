<template>
  <CardContainer>
    <template #header>
      <div class="relative flex items-center justify-center h-24">
        <div class="absolute left-0">
          <DynamicBrandingLogo />
        </div>
        <p class="text-header text-2xl font-semibold text-center">
          Welcome to the 45Drives Back Up Setup Wizard!
        </p>
      </div>
    </template>

    <div class="flex flex-col h-full justify-center items-center">

      <p class="w-9/12 text-center text-2xl">
        Your data is precious—protect it with the power of backups! A backup ensures your files are safe from accidents, failures, and digital mischief. Set up your protection now and keep your data secure, always.
      </p>

      <br />

      <p class="w-9/12 text-center text-2xl">
        We will set up automated backups with your chosen folders and schedule when they should happen. Back up tasks will be added to your system so you don’t have to worry.
      </p>

      <br />

      <p class="w-9/12 text-center text-2xl">
        This setup wizard will guide you through the steps to get your backups setup quickly.
      </p>

      <br />

      <p class="w-9/12 text-center text-2xl">
        Anywhere you see this icon: &nbsp;
        <CommanderToolTip
          :message="`Welcome to the 45Drives Setup Wizard! \n I'm the Houston Commander, and I'm here to show you some tips, tricks and information. 
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
        <button @click="proceedToNextStep" class="btn btn-secondary w-40 h-20">
          Next
        </button>
      </div>
    </template>

  </CardContainer>
</template>

<script setup lang="ts">
import CardContainer from '../../components/CardContainer.vue';
import { CommanderToolTip } from '../../components/commander';
import { useWizardSteps, DynamicBrandingLogo } from '@45drives/houston-common-ui';

const { completeCurrentStep } = useWizardSteps("backup");

const proceedToNextStep = async () => {
  completeCurrentStep();
};

</script>

<style scoped></style>
