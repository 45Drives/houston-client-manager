<template>
  <CardContainer>
    <template #header>
      <p class="text-header text-center text-3xl">
        SETTING UP YOUR HARDWARE
      </p>
    </template>
    <div class="flex flex-col justify-center items-center h-full">
      <div class="w-9/12 grid grid-cols-4 gap-x-6 gap-y-2 items-center">
        <!-- Step 1 -->
        <p class="col-span-3 text-left text-2xl">
          <b>Let’s set up the storage server and drives.</b><br />
          1. If you purchased drives from us, they will have arrived in a separate, securely packaged box.
          If you're using your own drives, we recommend ensuring they all have the same capacity to optimize usable
          storage.
          <CommanderToolTip
            :message="`Beware of using mixed drive sizes! The smallest one determines how much storage you will be able to use.`" />
          <br />
          <b>NOTE:</b> The storage bays are caddiless for 3.5” Drives.
          2.5” Drives can be used, however caddies are required.
          <CommanderToolTip
            :message="`Get some caddies here at <a href='https://store.45homelab.com/products/11' target='_blank' class='text-link'>45HomeLab Store</a>, or 3D print your own with our <a href='https://www.printables.com/model/583544-45drives-ssd-caddies' target='_blank' class='text-link'>Printables</a> files!`" />
        </p>
        <img class="h-fit" src="../assets/unboxInsertDrives.png" alt="Insert Drives" />

        <!-- Step 2 -->
        <p class="col-span-3 text-left text-2xl">
          2. Take the supplied power cord and plug it into the back of the server power port.
          Then, plug the other end of the power cord into a wall outlet.
          <CommanderToolTip
            :message="`You can also use a UPS (Uninterruptible Power Supply) for power-backup in the case of a power outage.`" />
        </p>
        <img class="h-fit" src="../assets/plugPower.png" alt="Plug Power" />

        <!-- Step 3 -->
        <p class="col-span-3 text-left text-2xl">
          3. Take the supplied ethernet cable and plug it into the back of the server.
          Then, plug it into either a router or network switch.
          <br />
          <b>NOTE:</b> This is a Network Attached Server (NAS), not a Direct Attached Server (DAS).
          Connecting the server directly to a computer will not work.
          <CommanderToolTip
            :message="`A NAS connects to a network, not directly to a computer. It needs a network connection to function properly.`" />
        </p>
        <img class="h-fit" src="../assets/plugEthernet.png" alt="Plug Ethernet" />

        <!-- Step 4 -->
        <p class="col-span-3 text-left text-2xl">
          4. Press the Power button to turn on your storage server!
        </p>
        <img class="h-fit" src="../assets/pressPower.png" alt="Press Power" />
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
import { CommanderToolTip } from '../components/commander';

const { completeCurrentStep, prevStep } = useWizardSteps();

const goBackStep = async () => {
  prevStep();
};

const proceedToNextStep = async () => {
  completeCurrentStep();
};


</script>

<style scoped></style>
