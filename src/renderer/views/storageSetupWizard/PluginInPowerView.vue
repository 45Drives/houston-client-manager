<template>
  <CardContainer>
    <template #header>
      <p class="text-header text-center text-3xl">
        Plugin Power
      </p>
    </template>
    <div class="flex flex-col justify-center items-center h-full">
      <div class="w-9/12 grid grid-cols-4 gap-x-6 gap-y-2 items-center">
       
        <!-- Step 2 -->
        <p class="col-span-3 text-left text-2xl">
          Take the supplied power cord and plug it into the back of the server power port.
          Then, plug the other end of the power cord into a wall outlet.
          <br>
          <br>
          <b>NOTE:</b> You can also use a UPS (Uninterruptible Power Supply) for power-backup in the case of a power outage.
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
