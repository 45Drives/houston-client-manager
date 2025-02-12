<template>
  <CardContainer>
    <template #header>
      <p class="text-header text-center text-3xl">
        SETTING UP YOUR HARDWARE
      </p>
    </template>

    <div class="flex flex-col items-center justify-center w-full">

      <div class="w-9/12">
        <div class="flex flex-row">
          <p class="w-3/4 text-left text-2xl ">
            1. Let’s set up the storage server and drives. If you purchased drives from us, they will have arrived in a
            separate, securely packaged box. If you're using your own drives, we recommend ensuring they all have the
            same
            capacity to optimize usable storage. 2.The storage bays are caddiless for 3.5” Drives. 2.5” Drives can be
            used,
            however caddies are required.
          </p>
          <div class="w-1/4 p-2 flex">
            <img class="" src="assets/unboxInsertDrives.png" alt="Bad" />
          </div>
        </div>

        <br />

        <div class="flex flex-row">
          <p class="w-3/4 text-left text-2xl ">
            2. Take the supplied power cord and plug it to the back of the server power port. Then, plug the other end
            of
            the power cord into a wall outlet.
          </p>
          <div class="w-1/4 p-2">

            <img class="" src="assets/plugPower.png" alt="Bad" />
          </div>
        </div>

        <br />

        <div class="flex flex-row">
          <p class="w-3/4 text-left text-2xl ">
            3. Take the supplied ethernet cable and plug it to the back of the server power port. Then, plug it to
            either a
            router or network switch. Note, this is a Network Attached Server (NAS), not a Direct Attached Server (DAS).
            Connecting the server directly to a computer will not work.
          </p>
          <div class="w-1/4 p-2">

            <img class="" src="assets/plugEthernet.png" alt="Bad" />
          </div>
        </div>

        <br />

        <div class="flex flex-row">
          <p class="w-3/4 text-left text-2xl ">
            4. Press the Power button to turn on your storage server!
          </p>
          <div class="w-1/4 p-2">
            <img class="" src="assets/pressPower.png" alt="Bad" />
          </div>
        </div>
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
import CardContainer from '../components/CardContainer.vue';
import { useWizardSteps } from '../components/wizard';


const { completeCurrentStep, prevStep } = useWizardSteps();

const goBackStep = async () => {
  prevStep();
};

const proceedToNextStep = async () => {
  completeCurrentStep();
};


</script>

<style scoped></style>
