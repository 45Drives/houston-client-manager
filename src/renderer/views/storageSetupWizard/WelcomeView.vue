<template>
  <CardContainer>
    <template #header>
      <div class="relative flex items-center justify-center h-24">
        <div class="absolute left-0 bg-white p-1 px-4 rounded-lg">
          <DynamicBrandingLogo />
        </div>
        <p class="text-header text-2xl font-semibold text-center">
          Welcome to the 45Drives Setup Wizard!
        </p>
      </div>
    </template>

    <div class="flex flex-col h-full justify-center items-center space-y-6 text-left">
      <p class="w-9/12 text-2xl">
        With countless storage drive layout options, balancing capacity, performance, and redundancy can feel like a
        juggling act.
        Drawing from our years of experience configuring enterprise storage servers, we’ve identified best practices for
        optimizing drive layouts based on the quantity of drives you decide to install in this server.
      </p>

      <p class="w-9/12 text-2xl">
        This setup wizard will guide you through the steps to get your storage server up and running quickly.
      </p>

      <p class="w-9/12 text-2xl">
        Our goal is to ensure a smooth setup you can start using your storage server as network attached storage (NAS)
        device with confidence.
      </p>

      <p class="w-9/12 text-2xl">
        Anywhere you see this icon:
        &nbsp;
        <CommanderToolTip :message="`Welcome to the 45Drives Setup Wizard! \n I'm the Houston Commander, and I'm here to show you some tips, tricks and information. 
          Click anywhere outside of these popups (or the X in the top-right corner) to close them.`" />
        &nbsp;
        it means that your new friend Houston Commander has something to say!
        Simply hover your mouse cursor over the icon and you will see him pop up.
      </p>

      <p class="w-9/12 text-2xl text-center">
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

const { completeCurrentStep } = useWizardSteps("setup");

const proceedToNextStep = async () => {
  completeCurrentStep();
};

</script>

<style scoped></style>
