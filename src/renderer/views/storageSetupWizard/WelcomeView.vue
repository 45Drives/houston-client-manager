<template>
  <CardContainer>
    <template #header>
      <p class="text-header text-center text-3xl">
        Welcome to the 45Drives Setup Wizard!
      </p>
    </template>

    <div class="flex flex-col h-full justify-center items-center">

      <p class="w-9/12 text-center text-2xl">
        With countless storage drive layout options, balancing capacity, performance, and redundancy can feel like a
        juggling act. Drawing from our years of experience configuring enterprise storage servers, we’ve identified best
        practices for optimizing drive layouts based on the quantity of drives you decide to install in this server.
      </p>

      <br />

      <p class="w-9/12 text-center text-2xl">
        This setup wizard will guide you through the steps to get your storage server up and running quickly.
      </p>

      <br />

      <p class="w-9/12 text-center text-2xl">
        Our goal is to ensure a smooth setup you can start using your storage server as network attached storage (NAS)
        device with confidence.
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
import { useWizardSteps } from '../../components/wizard';

const { completeCurrentStep } = useWizardSteps();

const proceedToNextStep = async () => {
  completeCurrentStep();
};

</script>

<style scoped></style>
