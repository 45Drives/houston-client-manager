<template>
  <CardContainer class="overflow-y-auto min-h-0">
    <template #header>
      <div class="relative flex items-center justify-center h-18  w-full">
        <div class="absolute left-0 p-1 px-4 rounded-lg">
         <DynamicBrandingLogo :division="division" :height="(division === 'studio' ? 16 : 12)"/>

        </div>
        <p class="text-3xl font-semibold text-center">
          Plugin Power
        </p>
        <div class="absolute right-0 top-1/2 -translate-y-1/2">
          <GlobalSetupWizardMenu />
        </div>
      </div>
    </template>
    <div class="flex flex-col justify-center items-center h-full">
      <div class="w-9/12 grid grid-cols-4 gap-x-6 gap-y-2 items-center">

        <!-- Step 2 -->
        <p class="col-span-3 text-left text-2xl">
          <!-- Take the supplied power cord and plug it into the back of the server power port.
          Then, plug the other end of the power cord into a wall outlet. -->
          Take the supplied power cord and plug it into the power port on the back of the server. Then, connect the
          other end to a wall outlet — or, for better protection, to a UPS (Uninterruptible Power Supply).
          <br>
          <br>
          <b>NOTE:</b>
          <!-- You can also use a UPS (Uninterruptible Power Supply) for power-backup in the case of a power outage. -->
          Using a UPS helps protect your server from sudden shutdowns caused by power loss or fluctuations. For best
          results, plug the server into a battery-backed UPS outlet, and plug the UPS into the wall.
          <!-- <CommanderToolTip
            :message="`An Uninterruptible Power Supply (UPS) keeps your server running during power outages or fluctuations. It provides temporary power to prevent unexpected shutdowns, allowing time for safe shutdown or switch to backup power — protecting data integrity and hardware.`" /> -->
          <CommanderToolTip
            :message="`A UPS (Uninterruptible Power Supply) keeps your server running during power outages or surges. It gives you time to shut down safely or switch to another power source — protecting your data and hardware.
            - To use a UPS, connect the server's power cable to a battery-backed outlet on the UPS.
            - Then, plug the UPS into the wall. Some UPS models can also connect to your server via USB or Ethernet to trigger safe shutdown automatically.`" />
        </p>
        <img class="h-fit" src="../../assets/plugPower.png" alt="Plug Power" />

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
import { CardContainer, useWizardSteps, DynamicBrandingLogo, useEnterToAdvance } from '@45drives/houston-common-ui';
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
