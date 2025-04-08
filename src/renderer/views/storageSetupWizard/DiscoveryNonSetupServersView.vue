<template>
  <CardContainer>
    <template #header>
      <p class="text-header text-center text-3xl">
        Discovered 45Drives Storage Server
      </p>
    </template>

    <div class="flex flex-col h-fit justify-center items-center text-left">
      <p class="w-9/12 text-2xl">
        You may have multiple 45Drives servers on your network that require setup.
      </p>
      <br />
      <p class="w-9/12 text-2xl">
        This setup wizard is designed to setup one server at a time. Click the box next to the server you would like to
        setup first.
      </p>
      <br />
      <p class="w-9/12 text-2xl">
        When you are finished setting the selected server up, simply re-run this program to start setting
        up the remaining server(s).
      </p>

      <HoustonServerListView class="w-1/3 px-5 justify-center text-2xl" @serverSelected="handleServerSelected" />

      <br />

      <p class="w-9/12 text-2xl">
        If your storage server is not appearing in the list above, please return to the Hardware Setup and ensure all
        steps were completed correctly.
        <a href="#" @click.prevent="onRestartSetup" class="text-blue-600 hover:underline">Click Here</a>
      </p>

      <br />

      <p class="text-center text-2xl">
        Once you have one of the boxes checked, click <b>NEXT</b>.
      </p>

    </div>

    <!-- Buttons -->
    <template #footer>
      <div class="button-group-row w-full justify-between">
        <button @click="goBackStep" class="btn btn-secondary w-40 h-20">
          Back
        </button>

        <button :disabled="selectedServer === null" @click="proceedToNextStep" class="btn btn-secondary w-40 h-20">
          Next
        </button>
      </div>
    </template>
  </CardContainer>
</template>

<script setup lang="ts">
import CardContainer from '../../components/CardContainer.vue';
import { useWizardSteps } from '@45drives/houston-common-ui';
import HoustonServerListView from '../../components/HoustonServerListView.vue'
import { Server } from '../../types';
import { ref } from 'vue';

const { completeCurrentStep, unCompleteCurrentStep, prevStep, reset } = useWizardSteps("setup");
const selectedServer = ref<Server | null>(null);

const goBackStep = async () => {
  prevStep();
};

const proceedToNextStep = async () => {
  console.log("Next Button on Discovery clicked.")
  unCompleteCurrentStep()
  completeCurrentStep(true, selectedServer.value as Record<string, any>);
};

const onRestartSetup = async () => {
  reset();
}

const handleServerSelected = async (server: Server | null) => {
  selectedServer.value = server;
};

</script>

<style scoped></style>
