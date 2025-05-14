<template>
  <CardContainer>
    <template #header>
      <div class="relative flex items-center justify-center h-18  w-full">
 <div class="absolute left-0 p-1 px-4 rounded-lg">
          <DynamicBrandingLogo :division="division" />
        </div>
        <p class="text-3xl font-semibold text-center">
          Plug in Ethernet
        </p>
        <div class="absolute right-0 top-1/2 -translate-y-1/2">
          <GlobalSetupWizardMenu />
        </div>
      </div>
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

        <button @click="proceedToNextStep" class="btn btn-primary w-40 h-20">
          Next
        </button>
      </div>
    </template>
  </CardContainer>
</template>

<script setup lang="ts">
import CardContainer from '../../components/CardContainer.vue';
import { useWizardSteps, DynamicBrandingLogo, useEnterToAdvance } from '@45drives/houston-common-ui';
import { CommanderToolTip } from '../../components/commander';
import GlobalSetupWizardMenu from '../../components/GlobalSetupWizardMenu.vue';
import { divisionCodeInjectionKey } from '../../keys/injection-keys';
import { inject } from 'vue';

const division = inject(divisionCodeInjectionKey);

const { completeCurrentStep, prevStep } = useWizardSteps("setup");

const goBackStep = async () => {
  prevStep();
};

const proceedToNextStep = async () => {
  completeCurrentStep();
};

useEnterToAdvance(
  async () => {
    await proceedToNextStep(); // Enter
  },
  200, // debounce time for Enter
  async () => {
    await proceedToNextStep(); // ArrowRight
  },
  async () => {
    await goBackStep(); // ArrowLeft
  }
);

</script>

<style scoped></style>
