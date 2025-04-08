<template>
  <CardContainer>
    <template #header>
      <p class="text-header text-center text-3xl">
        Plug in Ethernet
      </p>
    </template>
    <div class="flex flex-col justify-center items-center h-full">
      <div class="w-9/12 grid grid-cols-4 gap-x-6 gap-y-2 items-center">


        <!-- Step 3 -->
        <p class="col-span-3 text-left text-2xl">
          Take the supplied ethernet cable and plug it into the back of the server.
          Then, plug it into either a router or network switch.
          <br />
          <br />
          <b>NOTE:</b> This is a Network Attached Server (NAS), not a Direct Attached Server (DAS).
          Connecting the server directly to a computer will not work.
          <CommanderToolTip
            :message="`A NAS connects to a network, not directly to a computer. It needs a network connection to function properly.`" />
        </p>
        <img class="h-fit" src="../../assets/plugEthernet.png" alt="Plug Ethernet" />

      </div>
    </div>

    <!-- Buttons -->
    <template #footer>
      <div class="button-group-row w-full justify-between">
        <button @click="goBackStep" class="btn btn-secondary w-40 h-20">
          Back
        </button>

        <button @click="proceedToNextStep" class="btn btn-secondary w-40 h-20">
          Next
        </button>
      </div>
    </template>
  </CardContainer>
</template>

<script setup lang="ts">
import CardContainer from '../../components/CardContainer.vue';
import { useWizardSteps } from '@45drives/houston-common-ui';
import { CommanderToolTip } from '../../components/commander';

const { completeCurrentStep, prevStep } = useWizardSteps("setup");

const goBackStep = async () => {
  prevStep();
};

const proceedToNextStep = async () => {
  completeCurrentStep();
};


</script>

<style scoped></style>
