<template>
  <CardContainer class="flex flex-col flex-grow h-full overflow-y-auto">
    <template #header>
      <div class="relative flex items-center justify-center h-18  w-full">
        <div class="absolute left-0 p-1 px-4 rounded-lg">
         <DynamicBrandingLogo :division="division" :height="(division === 'studio' ? 16 : 12)"/>

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
        When you are finished setting the selected server up, click "Setup More Servers" to restart this wizard and setup
        up the remaining server(s).
      </p>

      <div class="grid grid-cols-2 gap-6 text-xl w-9/12 mx-auto mt-6">
        <!-- LEFT: server selection + manual -->
        <CardContainer class="col-span-1 bg-accent border-default rounded-md text-left shadow-sm">
          <div class="flex flex-col gap-3">
            <span class="font-semibold text-2xl text-center">
              Select or Add a Server
            </span>

            <p class="text-base mb-0.5 -mt-1">
              Select a discovered 45Drives server, or enter its IP address manually if it does not appear in the list.
            </p>

            <div class="max-h-[32vh] overflow-y-auto -mt-2 -pt-2 pb-2 bg-well rounded-md">
              <HoustonServerListView class="w-full justify-center text-xl" :filterMode="'all'" :key="serverListKey"
                :selectedServer="selectedServer" @serverSelected="handleServerSelected" />
            </div>

            <div class="mt-2">
              <span class="block text-base mb-1 -mt-1 font-semibold">Add a Server Manually:</span>

              <div class="flex flex-row md:flex-row md:items-center gap-2 mt-2">
                <input v-model="manualIp" type="text" placeholder="192.168.1.123" tabindex="1"
                  class="input-textlike border px-4 py-1 rounded text-xl w-full md:w-64" />
                <div class="button-group-row">
                  <button @click="addManualIp"
                    class="btn btn-secondary px-6 py-1 text-xl whitespace-nowrap w-full md:w-auto">
                    Add IP
                  </button>
                  <button @click="onRescanServers"
                    class="btn btn-secondary px-6 py-1 text-xl whitespace-nowrap w-full md:w-auto">
                    Rescan Servers
                  </button>
                </div>
              </div>
            </div>
          </div>
        </CardContainer>

        <!-- RIGHT: credentials -->
        <CardContainer class="col-span-1 bg-secondary border-default rounded-md text-left shadow-sm">
          <div class="flex flex-col gap-3">
            <span class="font-semibold text-2xl text-center mb-2">
              Enter Server Credentials
            </span>

            <p class="text-base">
              Use a <b>root</b> or <b>sudo-capable</b> account. These credentials are used once to install required
              tools
              and upload a secure SSH key to the server.
            </p>

            <div class="flex flex-col">
              <span>Username:</span>
              <input v-model="manualUsername" type="text" placeholder="root" tabindex="2"
               @keydown.enter.prevent.stop="canAddServer && useCredentialsForCurrentServer()" :class="[
                  'input-textlike px-4 py-1 rounded text-xl w-full border',
                  credsRequired && 'focus:ring-2 focus:ring-yellow-400 outline outline-2 outline-yellow-400'
                ]" />
            </div>

            <div class="flex flex-col mt-1">
              <span>Password:</span>
              <div class="w-full relative">
                <input v-model="manualPassword" v-enter-next :type="showPassword ? 'text' : 'password'" id="password"
                  tabindex="3" placeholder="••••••••"@keydown.enter.prevent.stop="canAddServer && useCredentialsForCurrentServer()"
                  :class="[
                    'input-textlike px-4 py-1 rounded text-xl w-full border',
                    credsRequired && 'focus:ring-2 focus:ring-yellow-400 outline outline-2 outline-yellow-400'
                  ]" />
                <button type="button" @click="togglePassword"
                  class="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted">
                  <EyeIcon v-if="!showPassword" class="w-5 h-5" />
                  <EyeSlashIcon v-else class="w-5 h-5" />
                </button>
              </div>
            </div>

            <div class="mt-2 text-sm italic flex flex-row items-center text-center justify-center justify-self-center">
               Steps to Troubleshoot
              <div class="mt-1 ml-2"><CommanderToolTip :width="1450" :message="`Troubleshooting Steps!
        1.) Plugin monitor and keyboard into your server.
        2.) Login to the user you want to use. On fresh machines the user is <b>root</b> and password is <b>45Dr!ves</b>.
        3.) If using root make sure root login over SSH is enabled.<br/> nano /etc/ssh/sshd_config and look for PermitRootLogin yes
        4.) Check if the server has internet access. ping google.ca
        `" />
              </div>
            </div>

            <div class="button-group-row mt-2">
              <button @click="useCredentialsForCurrentServer" :disabled="!canAddServer"
                class="btn btn-primary px-6 py-1 text-xl whitespace-nowrap w-full md:w-auto">
                Use Credentials
              </button>
            </div>
          </div>
        </CardContainer>
      </div>

      <!-- Troubleshooting + “Start Over” text -->
      <div class="w-9/12 text-xl text-center mt-2">
        If your storage server is not appearing in the list above, please return to the Hardware Setup and ensure
        all steps were completed correctly, or try adding it by IP.
        <br />
        <a href="#" @click.prevent="onRestartSetup" class="text-blue-600 hover:underline">Start Over</a>
        <div v-if="statusMessage" class="mt-3 text-base text-center">
          {{ statusMessage }}
        </div>
        <div v-if="isInstalling" class="w-full flex justify-center mt-2">
          <div class="spinner"></div>
        </div>
      </div>
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
import { useWizardSteps, DynamicBrandingLogo, useEnterToAdvance, CardContainer, Notification, pushNotification, reportError } from '@45drives/houston-common-ui';
import { IPCRouter } from '@45drives/houston-common-lib';
import HoustonServerListView from '../../components/HoustonServerListView.vue'
import { EyeIcon, EyeSlashIcon } from "@heroicons/vue/20/solid";
import { Server } from '../../types';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import GlobalSetupWizardMenu from '../../components/GlobalSetupWizardMenu.vue';
import { divisionCodeInjectionKey } from '../../keys/injection-keys';
import { inject } from 'vue';
import { CommanderToolTip } from '../../components/commander';
import { useServerCredentials } from "../../composables/useServerCredentials";

const division = inject(divisionCodeInjectionKey);
const showPassword = ref(false);
const togglePassword = () => {
  showPassword.value = !showPassword.value;
};
const statusMessage = ref('');
const isInstalling = ref(false);

const { completeCurrentStep, unCompleteCurrentStep, prevStep, reset } = useWizardSteps("setup");
const { credsByIp, setCredentials, getCredentials } = useServerCredentials();

const selectedServer = ref<(Server & {
  username?: string;
  password?: string;
  manuallyAdded?: boolean;
  fallbackAdded?: boolean;
}) | null>(null);

const manualIp = ref('');
const manuallyAddedIp = ref('');
const manualUsername = ref('root');
const manualPassword = ref('');
const manualCredentials = credsByIp; 
const ipv4Regex =
  /^((25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/;

const canAddServer = computed(() => {
  const ip = manualIp.value.trim();
  return ipv4Regex.test(ip);
});

const credsRequired = computed(() => {
  const srv = selectedServer.value;
  if (!srv) return false;

  const cached = manualCredentials.value[srv.ip];
  if (cached) return false;

  return !manualUsername.value.trim() || !manualPassword.value.trim();
});


function clearServerCredentials(ip: string) {
  const map = manualCredentials.value;
  if (map[ip]) {
    delete map[ip];
  }
}

function saveServerCredentials(ip: string, username: string, password: string) {
  setCredentials(ip, username, password);

  if (selectedServer.value && selectedServer.value.ip === ip) {
    selectedServer.value.fallbackAdded = selectedServer.value.fallbackAdded ?? false;
    selectedServer.value.manuallyAdded = !selectedServer.value.fallbackAdded ? true : false;
  }
}

async function useCredentialsForCurrentServer() {
  const username = manualUsername.value.trim();
  const password = manualPassword.value.trim();

  if (!username || !password) {
    const msg = "Please enter a username and password first.";
    reportError(new Error(msg));
    pushNotification(new Notification('Missing Credentials', msg, 'error', 8000));
    return;
  }

  let srv = selectedServer.value;
  let ip = srv?.ip ?? manualIp.value.trim();

  if (!ip) {
    const msg = "Please select a server or enter an IP address.";
    reportError(new Error(msg));
    pushNotification(new Notification('No Server Selected', msg, 'error', 8000));
    return;
  }

  if (!srv) {
    if (!ipv4Regex.test(ip)) {
      const msg = "Please enter a valid IPv4 address.";
      reportError(new Error(msg));
      pushNotification(new Notification('Invalid IP Address', msg, 'error', 8000));
      return;
    }

    IPCRouter.getInstance().send(
      "backend",
      "action",
      JSON.stringify({ type: "addManualIP", ip, manuallyAdded: true })
    );

    const newSrv: Server & { manuallyAdded: true; fallbackAdded: false } = {
      ip,
      name: ip,
      lastSeen: Date.now(),
      status: "unknown",
      manuallyAdded: true,
      fallbackAdded: false,
    };

    selectedServer.value = newSrv;
    srv = newSrv;

    pushNotification(new Notification(
      'Manual Server Added',
      `Server ${ip} has been added to the list.`,
      'success',
      6000
    ));
  }

  saveServerCredentials(ip, username, password);

  pushNotification(new Notification(
    'Credentials Saved',
    `Credentials saved for server ${ip} (user: ${username}).`,
    'success',
    6000
  ));
}


const serverListKey = ref(0);

function onRescanServers() {
  manuallyAddedIp.value = '';
  manualCredentials.value = {};
  selectedServer.value = null;
  serverListKey.value += 1;

  IPCRouter.getInstance().send(
    'backend',
    'action',
    JSON.stringify({ type: 'rescanServers' })
  );

  pushNotification(new Notification(
    'Rescanning Network',
    'Looking for 45Drives servers on your network…',
    'info',
    6000
  ));
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
  password: string,
): Promise<InstallResult> => {
  isInstalling.value = true;
  statusMessage.value = "Connecting to server, uploading SSH key and installing packages… This may take several minutes.";

  // Unique ID for this install so we can filter progress messages
  const id = crypto.randomUUID();
  const unlisten = listenSetupProgress(id);

  try {
    const result = await IPCRouter
      .getInstance()
      .invoke<InstallResult>("install-cockpit-module", {
        host,
        username,
        password,
        id,
      });

    console.debug("installModule result:", result);

    if (!result.success) {
      // Main process will already have sent a "Setup failed." message,
      // but ensure we leave a useful message here too.
      statusMessage.value = result.error || "Installation failed.";
    } else if (result.reboot) {
      // This message will override whatever the last progress label was.
      statusMessage.value = "Setup installed. Server will reboot to finish enabling ZFS…";
      await rebootFunction();
    } else {
      statusMessage.value = "Modules installed and SSH key uploaded!";
    }

    return result;
  } catch (err: any) {
    console.error("installModule failed:", err);
    statusMessage.value = "Could not connect or authenticate.";
    return { success: false, error: err.message };
  } finally {
    isInstalling.value = false;
    unlisten?.();
  }
};


function listenSetupProgress(id: string) {
  const handler = (_event: any, msg: any) => {
    console.debug("renderer setup-progress:", msg);
    if (!msg || msg.id !== id) return;
    if (msg.label) {
      statusMessage.value = msg.label;
    }
  };

  window.electron?.ipcRenderer.on("setup-progress", handler);

  return () => {
    window.electron?.ipcRenderer.removeListener("setup-progress", handler);
  };
}

async function addManualIp() {
  const ip = manualIp.value.trim();

  if (!ipv4Regex.test(ip)) {
    const msg = "Please enter a valid IPv4 address.";
    reportError(new Error(msg));
    pushNotification(new Notification('Invalid IP Address', msg, 'error', 8000));
    return;
  }

  IPCRouter.getInstance().send(
    'backend',
    'action',
    JSON.stringify({ type: 'addManualIP', ip, manuallyAdded: true })
  );

  const srv: Server & { manuallyAdded: true; fallbackAdded: false } = {
    ip,
    name: ip,
    lastSeen: Date.now(),
    status: 'unknown',
    manuallyAdded: true,
    fallbackAdded: false,
  };

  selectedServer.value = srv;

  if (manualUsername.value.trim() && manualPassword.value.trim()) {
    saveServerCredentials(ip, manualUsername.value, manualPassword.value);
  } else {
    manualUsername.value = manualUsername.value || 'root';
    manualPassword.value = manualPassword.value || '';
  }

  pushNotification(new Notification(
    'Manual Server Added',
    `Server ${ip} has been added to the list.`,
    'success',
    6000
  ));
}


const goBackStep = () => prevStep();

const proceedToNextStep = async () => {
  const srv = selectedServer.value;
  if (!srv) {
    const msg = "Please select a server first.";
    reportError(new Error(msg));
    pushNotification(new Notification('No Server Selected', msg, 'error', 8000));
    return;
  }

  let cached = manualCredentials.value[srv.ip];

  const typedUser = manualUsername.value.trim();
  const typedPass = manualPassword.value.trim();

  if (typedUser && typedPass) {
    saveServerCredentials(srv.ip, typedUser, typedPass);
    cached = manualCredentials.value[srv.ip];
  }

  if (!cached) {
    const msg = "Username and password are required to install modules on this server.";
    reportError(new Error(msg));
    pushNotification(new Notification('Credentials Required', msg, 'error', 8000));
    return;
  }

  const { username, password } = cached;

  pushNotification(new Notification(
    'Starting Setup',
    `Beginning setup on ${srv.ip} as ${username}…`,
    'info',
    6000
  ));

  const result = await installModule(srv.ip, username, password);
  console.debug("installModule finished:", result);

  if (!result.success) {
    pushNotification(new Notification(
      'Setup Failed',
      result.error || `Setup failed on ${srv.ip}.`,
      'error',
      8000
    ));
    return;
  }

  pushNotification(new Notification(
    'Setup Complete',
    `Initial setup completed on ${srv.ip}.`,
    'success',
    6000
  ));

  unCompleteCurrentStep();
  completeCurrentStep(true, srv as Record<string, any>);
};


const onRestartSetup = () => reset();

const handleServerSelected = (server: Server | null) => {
  if (server) {
    selectedServer.value = {
      ...server,
      manuallyAdded: (server as any).manuallyAdded ?? false,
      fallbackAdded: (server as any).fallbackAdded ?? false,
    };

    manualIp.value = server.ip;

    const cached = manualCredentials.value[server.ip];
    if (cached) {
      manualUsername.value = cached.username;
      manualPassword.value = cached.password;
    } else {
      manualUsername.value = 'root';
      manualPassword.value = '';
    }
  } else {
    selectedServer.value = null;
    manualIp.value = '';
    manualUsername.value = 'root';
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


onMounted(() => {
  window.electron?.ipcRenderer.invoke('discovery:setEnabled', true);
});

onBeforeUnmount(() => {
  window.electron?.ipcRenderer.invoke('discovery:setEnabled', false);
});


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
