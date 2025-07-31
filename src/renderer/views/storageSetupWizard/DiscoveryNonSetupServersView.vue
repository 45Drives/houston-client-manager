<template>
  <CardContainer class="flex flex-col flex-grow h-full overflow-y-auto">
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

    <div class="flex-1 flex flex-col h-fit w-full justify-center items-center text-center py-6">
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

      <div class="overflow-hidden w-full -mt-2">
        <div class="max-h-[50vh] overflow-y-auto">
          <HoustonServerListView class="w-1/3 px-5 justify-center text-xl" :filterOutStorageSetupComplete="false"
            :key="serverListKey" :selectedServer="selectedServer" @serverSelected="handleServerSelected" />
        </div>
      </div>
      <br />
      <p class="w-9/12 text-xl text-center">
        If your storage server is not appearing in the list above, please return to the Hardware Setup and ensure
        all steps were completed correctly.
        <br />
        <a href="#" @click.prevent="onRestartSetup" class="text-blue-600 hover:underline">Start Over</a>
        <br>
        <b>Otherwise you can manually add a server by clicking below.</b>
      </p>
      <p class="text-center text-xl mt-1">
        Once you have one of the boxes checked, click <b>NEXT</b>.
      </p>

      <details class="w-9/12 mt-4 bg-well rounded-md p-2 shadow-sm group" v-bind:open="false">
        <summary
          class="text-xl text-left bg-default rounded-md p-1 font-semibold cursor-pointer outline-none focus:ring-2 focus:ring-yellow-500">
          Add a Server Manually
        </summary>

        <div class="mt-4">
          <p class="w-full text-xl mb-1">
            If you have an existing server you wish to connect to and re-initialize, enter it here along
            with root/admin login credentials.
          </p>
          <p class="w-full text-md italic text-center">
            Your credentials will only be used once to copy a secure SSH key and install required tools on the server if
            needed. This may take a few minutes if nothing is installed yet.
            <br />
            This will setup <b>ZFS</b>, <b>Samba</b>, <b>Cockpit</b>, and the <b>45Drives Setup Module</b>.
          </p>

          <div class="w-full flex flex-row items-center justify-center gap-6 mt-4">
            <div class="w-64">
              <input v-model="manualIp" type="text" placeholder="192.168.1.123" tabindex="1"
                class="input-textlike border px-4 py-1 rounded text-xl w-full" />
            </div>

            <div class="w-64">
              <input v-model="manualUsername" type="text" placeholder="root" tabindex="2" :class="[
                'input-textlike px-4 py-1 rounded text-xl w-full border',
                credsRequired && 'focus:ring-2 focus:ring-yellow-400 outline outline-2 outline-yellow-400'
              ]" />
            </div>

            <div class="w-64 relative">
              <input v-model="manualPassword" v-enter-next :type="showPassword ? 'text' : 'password'" id="password"
                tabindex="3" :class="[
                  'input-textlike px-4 py-1 rounded text-xl w-full border',
                  credsRequired && 'focus:ring-2 focus:ring-yellow-400 outline outline-2 outline-yellow-400'
                ]" placeholder="••••••••" />
              <button type="button" @click="togglePassword"
                class="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted">
                <EyeIcon v-if="!showPassword" class="w-5 h-5" />
                <EyeSlashIcon v-if="showPassword" class="w-5 h-5" />
              </button>
            </div>

            <div class="button-group-row">
              <button v-if="!selectedServer?.fallbackAdded" @click="addManualIp" :disabled="!canAddServer"
                class="btn btn-primary px-6 py-1 text-xl whitespace-nowrap">
                Add Server
              </button>
              <button v-else @click="saveServerCredentials(manualIp, manualUsername, manualPassword)"
                :disabled="!canUseCredentials" class="btn btn-primary px-2 py-1 text-xl whitespace-nowrap">
                Use Credentials
              </button>
              <button @click="onRescanServers" class="btn btn-secondary px-6 py-1 text-xl whitespace-nowrap">
                Rescan Servers
              </button>
            </div>
          </div>
        </div>

        <p v-if="statusMessage" class="text-lg text-center mt-2">
          {{ statusMessage }}
          <br />
          Troubleshooting steps:
          <CommanderToolTip :width="1450" :message="`Troubleshoot Steps!
        1.) Plugin monitor and keyboard into your server.
        2.) Login to the user you want to use. On fresh machines the user is <b>root</b> and password is <b>45Dr!ves</b>.
        3.) If using root make sure root login over SSH is enabled. nano /etc/ssh/sshd_config and look for PermitRootLogin yes
        4.) Check if the server has internet access. ping google.ca
        `" />
        </p>
        <div v-if="isInstalling" class="justify-self-center spinner"></div>
      </details>


    </div>

    <!-- Buttons -->
    <template #footer>
      <div class="button-group-row w-full justify-between">
        <button @click="goBackStep" class="btn btn-secondary w-40 h-20">
          Back
        </button>

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
import { CommanderToolTip } from '../../components/commander';

const division = inject(divisionCodeInjectionKey);
const showPassword = ref(false);
const togglePassword = () => {
  showPassword.value = !showPassword.value;
};
const statusMessage = ref('');
const isInstalling = ref(false)

const { completeCurrentStep, unCompleteCurrentStep, prevStep, reset } = useWizardSteps("setup");

const selectedServer = ref<(Server & {
  username?: string;
  password?: string;
  manuallyAdded?: boolean;
  fallbackAdded?: boolean;
}) | null>(null);

const manualIp = ref('');
const manuallyAddedIp = ref('');
const manualUsername = ref('');
const manualPassword = ref('');
const manualCredentials = ref<Record<string, { username: string; password: string }>>({});

const canAddServer = computed(() => {
  const ip = manualIp.value.trim();
  const username = manualUsername.value.trim();
  const password = manualPassword.value.trim();

  const ipValid = /^((25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/.test(ip);

  if (!ipValid) return false;

  // If IP is present and valid, username and password must also be present
  return !!username && !!password;
});

const canUseCredentials = computed(() => {
  return credsRequired.value &&
    !!manualUsername.value.trim() &&
    !!manualPassword.value.trim();
});

const credsRequired = computed(() => {
  const srv = selectedServer.value;
  if (!srv) return false;

  // Only show highlight if it's a fallback server OR a manually added one without saved creds
  const needsCreds = srv.fallbackAdded || srv.manuallyAdded;
  const hasCachedCreds = manualCredentials.value[srv.ip];

  return needsCreds && !hasCachedCreds;
});


function saveServerCredentials(ip: string, username: string, password: string) {
  manualCredentials.value[ip] = { username, password };
  // mark it so that proceedToNextStep() knows it needs an install
  if (selectedServer.value && selectedServer.value.ip === ip) {
    selectedServer.value.fallbackAdded = selectedServer.value.fallbackAdded ?? false;
    selectedServer.value.manuallyAdded = !selectedServer.value.fallbackAdded ? true : false;
  }
  manualIp.value = '';
  manualUsername.value = '';
  manualPassword.value = '';
}

const serverListKey = ref(0);

function onRescanServers() {
  // clear manual entries
  manuallyAddedIp.value = '';
  manualCredentials.value = {};
  // clear selection
  selectedServer.value = null;
  // bump key → remount HoustonServerListView
  serverListKey.value += 1;
  // tell backend to re-discover
  IPCRouter.getInstance().send(
    'backend',
    'action',
    JSON.stringify({ type: 'rescanServers' })
  );
}

interface InstallResult {
  success: boolean;
  error?: string;
  rebootRequired?: boolean;
}

const rebootFunction = inject<() => Promise<void>>('reboot-function')!;

const installModule = async (
  host: string,
  username: string,
  password: string
): Promise<InstallResult> => {
  isInstalling.value = true;
  statusMessage.value = "Connecting to server, uploading SSH key and installing packages… This may take several minutes.";

  try {
    const result = await IPCRouter
      .getInstance()
      .invoke<InstallResult>("install-cockpit-module", {
        host,
        username,
        password,
      });

    console.log("🚀 installModule result:", result);
    if (!result.success) {
      statusMessage.value = result.error || "Installation failed.";
    } else if (result.reboot) {
      statusMessage.value = "Setup installed. Server will reboot to finish enabling ZFS…";
      await rebootFunction();
    } else {
      statusMessage.value = "Modules installed and SSH key uploaded!";
    }
    return result;
  } catch (err: any) {
    console.error("❌ installModule failed:", err);
    statusMessage.value = "Could not connect or authenticate.";
    return { success: false, error: err.message };
  } finally {
    isInstalling.value = false;
  }
};

async function addManualIp() {
  const ip = manualIp.value.trim();
  
  if (!/^((25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/.test(ip)) {
      reportError(new Error("Please enter a valid IPv4 address."));
      return;
  }

  // fire off backend discovery for this IP
  IPCRouter.getInstance().send(
    'backend',
    'action',
    JSON.stringify({ type: 'addManualIP', ip, manuallyAdded: true })
  );

  // create a minimal Server object locally
  const srv: Server & { manuallyAdded: true; fallbackAdded: false } = {
    ip,
    name: ip,
    lastSeen: Date.now(),
    status: 'unknown',
    manuallyAdded: true,
    fallbackAdded: false,
  };

  // select it
  selectedServer.value = srv;

  // cache its creds immediately
  saveServerCredentials(ip, manualUsername.value, manualPassword.value);

  // clear the form
  manualIp.value = '';
  manualUsername.value = '';
  manualPassword.value = '';
}


const goBackStep = () => prevStep();

const proceedToNextStep = async () => {
  const srv = selectedServer.value!;
  // if this host needs installing, make sure we have creds
  if (srv.manuallyAdded || srv.fallbackAdded) {
    if (!manualCredentials.value[srv.ip] && (!manualPassword.value || !manualUsername.value)) {
      reportError(new Error("For IP-detected servers, username and password are required."));
      return;
    } else if (!manualCredentials.value[srv.ip] && (manualPassword.value || manualUsername.value)) {
      reportError(new Error("Click Use Credentials to associate them with the selected server IP."));
      return;
    }
  } 

  // now do your existing installModule flow, pulling creds from the cache:
  if (srv.manuallyAdded || srv.fallbackAdded) {
    const { username, password } = manualCredentials.value[srv.ip];
    const result = await installModule(srv.ip, username, password);
    if (!result.success) return;
  }

  unCompleteCurrentStep();
  completeCurrentStep(true, srv as Record<string, any>);
};

const onRestartSetup = () => reset();

const handleServerSelected = (server: Server | null) => {
  if (server && (server.manuallyAdded || server.fallbackAdded)) {
    // 1) Re-selecting a manual or fallback node:
    //    – keep its flags on selectedServer
    //    – show its IP in the box
    //    – restore creds if we have them, else clear username/password
    selectedServer.value = {
      ...server,
      manuallyAdded: server.manuallyAdded,
      fallbackAdded: server.fallbackAdded,
      username: manualUsername.value,
      password: manualPassword.value,
    };

    manualIp.value = server.ip;

    const cached = manualCredentials.value[server.ip];
    if (cached) {
      manualUsername.value = cached.username;
      manualPassword.value = cached.password;
    } else {
      manualUsername.value = '';
      manualPassword.value = '';
    }

  } else if (server) {
    // 2) Picking a plain discovered node:
    //    – just select it and wipe the form
    selectedServer.value = server;
    manualIp.value = '';
    manualUsername.value = '';
    manualPassword.value = '';
  } else {
    // 3) Deselecting
    selectedServer.value = null;
    manualIp.value = '';
    manualUsername.value = '';
    manualPassword.value = '';
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
  margin: 5px;
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
