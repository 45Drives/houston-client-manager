<template>
  <CardContainer class="">
    <template #header>
      <div class="flex flex-row justify-center text-center items-center text-3xl">
        Choose Where You Want to Store Back ups &nbsp;
        <CommanderToolTip :message="`Choose how your storage server will be setup and configured.`" :width="600" />
      </div>
    </template>

    <div class="grid grid-cols-2 gap-10 text-2xl w-9/12 mx-auto">
      <CardContainer class="col-span-1 bg-accent border-default rounded-md">

        <template #header>
          <button @click="startOnPremSetup" class="btn btn-secondary w-full h-40 text-6xl">
            On Prem
          </button>
        </template>

        <div>
          <br>
          <p>
            ✅ What It Is:
          </p>
          <p>
            A backup solution where your data is stored on your own servers, NAS, or external drives instead of the
            cloud.
          </p>
          <br>
          <p>
            🔹 Why Choose It?
          </p>
          Faster Recovery – Local backups restore quickly.
          More Control – No reliance on third-party cloud providers.
          Better Security – Data stays in-house, reducing external risks.
          No Ongoing Fees – One-time hardware cost, no monthly cloud charges.
          Regulatory Compliance – Meets industry rules for sensitive data.

        </div>

      </CardContainer>

      <CardContainer class="relative col-span-1 bg-accent border-default rounded-md overflow-hidden">

        <template #header>
          <button @click="startCloudSetup" class="btn btn-secondary w-full h-40 text-6xl">
            Cloud
          </button>
        </template>

        <div class="text-muted">
          <br>
          <p>
            ✅ What It Is:
          </p>
          <p>

            A backup solution where your data is stored on remote servers managed by a cloud provider, such as Google
            Drive,
            AWS, or Microsoft Azure.
          </p>
          <br>
          <p>
            🔹 Why Choose It?
          </p>
          <p>

            Easy Setup – No hardware to buy or maintain.
            Offsite Protection – Backups are stored remotely, protecting against local disasters.
            Scalable – Easily increase storage as your data grows.
            Automated Backups – Set it and forget it with scheduled, automatic backups.
            Access Anywhere – Restore data from any device with an internet connection.
          </p>
        </div>

      </CardContainer>
    </div>

    <template #footer>

      <div class="button-group-row w-full justify-between">

        <button @click="proceedToPreviousStep" class="btn btn-secondary w-40 h-20">
          Back
        </button>
      </div>

    </template>
    <MessageDialog ref="messageNoServersDialog" message="No servers detected. Ensure the plugin is powered and the network is connected for any servers you want to set up backups on." />
  </CardContainer>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import CardContainer from '../../components/CardContainer.vue';
import { CommanderToolTip } from '../../components/commander';
import { useWizardSteps } from '../../components/wizard';
import { Server } from '../../types';
import MessageDialog from '../../components/MessageDialog.vue';

const { completeCurrentStep, prevStep } = useWizardSteps("backup");
const servers = ref<Server[]>([]);

// Receive the discovered servers from the main process
window.electron.ipcRenderer.on('discovered-servers', (_event, discoveredServers: Server[]) => {
  servers.value = discoveredServers;
});

const messageNoServersDialog = ref<InstanceType<typeof MessageDialog> | null>(null);

const startOnPremSetup = () => {
  if (servers.value.length === 0) {
    messageNoServersDialog.value?.show();
  } else {
    completeCurrentStep(true, { choice: "onprem" });
  }
};

const startCloudSetup = () => {
  completeCurrentStep(true, { choice: "cloud" });
};

const proceedToPreviousStep = () => {
  prevStep(2);
};

</script>
