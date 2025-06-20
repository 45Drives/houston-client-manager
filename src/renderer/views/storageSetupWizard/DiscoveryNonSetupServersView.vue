<template>
  <CardContainer>
    <template #header>
      <div class="relative flex items-center justify-center h-18  w-full">
        <div class="absolute left-0 p-1 px-4 rounded-lg">
          <DynamicBrandingLogo :division="division" />
        </div>
        <p class="text-3xl font-semibold text-center">
          Discovered 45Drives Storage Server
        </p>
        <div class="absolute right-0 top-1/2 -translate-y-1/2">
          <GlobalSetupWizardMenu />
        </div>
      </div>
    </template>

    <div class="flex flex-col h-fit justify-center items-center text-left">
      <p class="w-9/12 text-xl">
        You may have multiple 45Drives servers on your network that require setup.
      </p>
      <p class="w-9/12 text-xl mt-2">
        This setup wizard is designed to setup one server at a time. Click the box next to the server you would like to
        setup first.
      </p>
      <p class="w-9/12 text-xl mt-2">
        When you are finished setting the selected server up, simply re-run this program to start setting
        up the remaining server(s).
      </p>

      <div class="overflow-hidden w-full">
        <div class="max-h-[50vh] overflow-y-auto">
          <!-- <HoustonServerListView class="w-1/3 px-5 justify-center text-xl" :filterOutStorageSetupComplete="true"
            @serverSelected="handleServerSelected" /> -->
          <HoustonServerListView class="w-1/3 px-5 justify-center text-xl" :filterOutStorageSetupComplete="false"
            :selectedServer="selectedServer" @serverSelected="handleServerSelected" />
        </div>
      </div>


      <br />

      <!-- <p class="w-9/12 text-xl">
        If your storage server is not appearing in the list above, please return to the Hardware Setup and ensure
        all
        steps were completed correctly.
        <a href="#" @click.prevent="onRestartSetup" class="text-blue-600 hover:underline">Start Over</a>
        Or, if you know the IP of an existing server you wish to manually add and re-initialize, enter it here: (and the
        login credentials to connect, if so)
      </p> -->
      <p class="w-9/12 text-xl text-center">
        If your storage server is not appearing in the list above, please return to the Hardware Setup and ensure
        all steps were completed correctly.<br />
        <a href="#" @click.prevent="onRestartSetup" class="text-blue-600 hover:underline">Start Over</a>
      </p>

      <div class="bg-well p-2 rounded-md mt-2">
        <p class="w-full text-xl">
          Or, if you know the IP of an existing server you wish to manually add and re-initialize, enter it here along
          with root/admin login credentials.
        </p>
        <p class="w-full text-md mt-2 italic text-center">
          Your credentials will only be used once to copy a secure SSH key and install required tools on the server if
          needed. This make take a few minutes if nothing at all is installed.
          <br />
          This will setup <b>ZFS</b>, <b>Samba</b>, <b>Cockpit</b>, and the <b>45Drives Setup Module</b>.
        </p>

        <div class="w-full flex flex-row items-center justify-center gap-6 mt-1">
          <!-- IP -->
          <div class="w-64">
            <input v-model="manualIp" type="text" placeholder="192.168.1.123" tabindex="1"
              class="input-textlike border px-4 py-1 rounded text-xl w-full" />
          </div>

          <!-- Username -->
          <div class="w-64">
            <input v-model="manualUsername" type="text" placeholder="root" tabindex="2"
              class="input-textlike border px-4 py-1 rounded text-xl w-full" />
          </div>

          <!-- Password -->
          <div class="w-64 relative">
            <input v-model="manualPassword" v-enter-next :type="showPassword ? 'text' : 'password'" id="password"
              tabindex="3" class="input-textlike border px-4 py-1 rounded text-xl w-full" placeholder="••••••••" />
            <button type="button" @click="togglePassword"
              class="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted">
              <EyeIcon v-if="!showPassword" class="w-5 h-5" />
              <EyeSlashIcon v-if="showPassword" class="w-5 h-5" />
            </button>
          </div>

          <!-- Add Server -->
          <button @click="addManualIp" :disabled="!canAdd" class="btn btn-primary px-6 py-1 text-xl whitespace-nowrap">
            Add Server
          </button>
        </div>

        <p v-if="statusMessage" class="text-lg text-center mt-2">
          {{ statusMessage }}
        </p>
      </div>

      <div v-if="isInstalling" class="justify-self-center spinner"></div>
      <div v-else>
        <p class="text-center text-xl mt-1">
          Once you have one of the boxes checked, click <b>NEXT</b>.
        </p>
      </div>
    </div>

    <!-- Buttons -->
    <template #footer>
      <div class="button-group-row w-full justify-between">
        <button @click="goBackStep" class="btn btn-secondary w-40 h-20">
          Back
        </button>

        <!-- <button :disabled="selectedServer === null" @click="proceedToNextStep" class="btn btn-primary w-40 h-20">
          Next
        </button> -->
        <button class="btn btn-primary w-40 h-20 flex items-center justify-center"
          :disabled="!selectedServer || isInstalling" @click="proceedToNextStep">
          <template v-if="isInstalling">
            Installing…
          </template>
          <template v-else>
            Next
          </template>
        </button>
      </div>
    </template>
  </CardContainer>
</template>

<script setup lang="ts">
import CardContainer from '../../components/CardContainer.vue';
import { useWizardSteps, DynamicBrandingLogo, useEnterToAdvance } from '@45drives/houston-common-ui';
import { IPCRouter } from '@45drives/houston-common-lib';
import HoustonServerListView from '../../components/HoustonServerListView.vue'
import { EyeIcon, EyeSlashIcon } from "@heroicons/vue/20/solid";
import { Server } from '../../types';
import { computed, ref } from 'vue';
import GlobalSetupWizardMenu from '../../components/GlobalSetupWizardMenu.vue';
import { divisionCodeInjectionKey } from '../../keys/injection-keys';
import { inject } from 'vue';

const division = inject(divisionCodeInjectionKey);
const showPassword = ref(false);
const togglePassword = () => {
  showPassword.value = !showPassword.value;
};
const statusMessage = ref('');
const isInstalling = ref(false)

const { completeCurrentStep, unCompleteCurrentStep, prevStep, reset } = useWizardSteps("setup");
// const selectedServer = ref<Server | null>(null);

const selectedServer = ref<(Server & {
  username?: string;
  password?: string;
  manuallyAdded?: boolean;
}) | null>(null);

const manualIp = ref('');
const manuallyAddedIp = ref('');
const manualUsername = ref('');
const manualPassword = ref('');
const manualCredentials = ref<Record<string, { username: string; password: string }>>({});
const canAdd = computed(
  () =>
    manualIp.value !== '' &&
    manualUsername.value.trim() !== '' &&
    manualPassword.value.trim() !== '' &&
    !manualCredentials.value[manualIp.value]
);


interface InstallResult {
  success: boolean;
  error?: string;
}

const installModule = async (): Promise<InstallResult> => {
  isInstalling.value = true
  statusMessage.value = "Connecting to server, uploading SSH key and installing packages…"
  try {
    const result = await IPCRouter
      .getInstance()
      .invoke<InstallResult>('install-cockpit-module', {
        host: selectedServer.value!.ip,
        username: selectedServer.value!.username,
        password: selectedServer.value!.password
      })

    console.log("🚀 installModule result:", result)
    if (!result.success) {
      statusMessage.value = result.error || "Installation failed."
    } else {
      statusMessage.value = "Module installed and SSH key uploaded!"
    }
    return result
  } catch (err: any) {
    console.error("❌ Manual IP install failed:", err)
    statusMessage.value = "Could not connect or authenticate."
    return { success: false, error: err.message }
  } finally {
    isInstalling.value = false
  }
}


const addManualIp = async () => {
  const ip = manualIp.value.trim();

  if (!/^((25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/.test(ip)) {
    reportError(new Error("Please enter a valid IPv4 address."));
    return;
  }

  if (!manualUsername.value.trim() || !manualPassword.value.trim()) {
    reportError(new Error("Username and password are required."));
    return;
  }

  manuallyAddedIp.value = ip;

  const newSrv: Server = {
    ip,
    name: ip,
    lastSeen: Date.now(),
    status: "unknown",
    manuallyAdded: true
  };


  IPCRouter.getInstance().send('backend', 'action', JSON.stringify({
    type: 'addManualIP',
    ip: manualIp.value,
    manuallyAdded: true
  }));

  selectedServer.value = newSrv;
  selectedServer.value.username = manualUsername.value;
  selectedServer.value.password = manualPassword.value;
  manualIp.value = '';
  manualUsername.value = '';
  manualPassword.value = '';
};


const goBackStep = () => prevStep();

const proceedToNextStep = async () => {
  if (selectedServer.value?.manuallyAdded) {
    const result = await installModule()
    if (!result.success) {
      // stop here so we don’t advance
      return
    }
  }
  unCompleteCurrentStep()
  completeCurrentStep(true, selectedServer.value as Record<string, any>)
}

const onRestartSetup = () => reset();

const handleServerSelected = (server: Server | null) => {
  if (server && server.ip === manuallyAddedIp.value) {
    // Re-selecting the manually‐added server: restore its username/password
    selectedServer.value = {
      ...server,
      manuallyAdded: true,
      username: manualUsername.value,
      password: manualPassword.value,
    };
  } else {
    // selecting a normal server, or un-selecting (null)
    selectedServer.value = server;
  }
};

useEnterToAdvance(
  () => {
    if (selectedServer.value !== null) {
      proceedToNextStep();
    }
  },
  200, // debounce delay for Enter
  () => {
    if (selectedServer.value !== null) {
      proceedToNextStep(); // right arrow key → acts like "Next"
    }
  },
  () => {
    goBackStep(); // left arrow key ← acts like "Back"
  }
);


</script>

<style scoped>
.spinner {
  border: 4px solid rgba(0, 0, 0, 0.1);
  border-left-color: #2c3e50;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  animation: spin 1s linear infinite;
  margin: 20px;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}
</style>
