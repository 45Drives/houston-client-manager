<template>
  <CardContainer>
    <template #header>
      <div class="relative flex items-center justify-center h-18  w-full">
        <div class="absolute left-0 bg-white p-1 px-4 rounded-lg">
          <DynamicBrandingLogo :division="division" />
        </div>
        <p class="text-3xl font-semibold text-center">
          Unboxing
        </p>
        <div class="absolute right-0 top-1/2 -translate-y-1/2">
          <GlobalSetupWizardMenu />
        </div>
      </div>
    </template>

    <div class="flex flex-col justify-center items-center h-full">
      <div class="w-9/12 grid grid-cols-4 gap-x-6 gap-y-2 items-center">
        <!-- Step 1 -->
        <p class="col-span-3 text-left text-2xl">
          <b>Let’s set up the storage server and drives.</b><br />
          If you purchased drives from us, they will have arrived in a separate, securely packaged box.
          If you're using your own drives, we recommend <b>ensuring they all have the same capacity</b> to optimize
          usable storage.
          <CommanderToolTip
            :message="`Beware of using mixed drive sizes! The smallest one determines how much storage you will be able to use.\nExample: If you have three 20TB drives and one 4TB drive, your pool of storage will only be equal to four 4TB drives, or 12TB of storage. (16TB raw total minus one drive for redundancy)`" />

          <br />
          <br />

          Take each drive and place it into the server securely. You should feel when it is inserted correctly.

          <br />
          <br />
          <b>NOTE:</b> The storage bays are caddiless for 3.5” Drives.<br />
          2.5” Drives can be used, however caddies are required.
          <CommanderToolTip
            :message="`Get some caddies here at <a href='https://store.45homelab.com/products/11' target='_blank' class='text-link'>45HomeLab Store</a>, or 3D print your own with our <a href='https://www.printables.com/model/583544-45drives-ssd-caddies' target='_blank' class='text-link'>Printables</a> files!`" />
        </p>
        <img class="h-fit" src="../../assets/unboxInsertDrives.png" alt="Insert Drives" />

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
