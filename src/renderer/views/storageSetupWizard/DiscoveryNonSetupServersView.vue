<template>
  <CardContainer class="overflow-y-auto min-h-0 w-full ui-texture-surface ui-texture-surface--tech bg-transparent">
    <form @submit.prevent="proceedToNextStep" class="flex flex-col justify-center items-center h-full w-full">
      <div class="grid gap-4 w-10/12 max-w-4xl">

        <section class="text-center mb-2">
          <h2 class="text-xl font-semibold">Select a 45Drives Server to Setup</h2>
          <p class="text-base mt-1 opacity-90">
            Servers appear automatically via network discovery. You can also enter an IP manually.
          </p>
          <p class="text-sm mt-1 opacity-75">
            This wizard sets up one server at a time. Re-run to setup additional servers.
          </p>
        </section>

        <div class="grid grid-cols-2 gap-4">
          <!-- Server Selection Panel -->
          <section class="min-w-0 p-4 rounded-lg shadow-lg border border-default bg-accent">
            <div class="text-sm tracking-wider uppercase opacity-85 font-bold mb-2">Server Selection</div>

            <div class="flex flex-col text-left">
              <span class="mb-1 text-sm font-semibold opacity-90">Select a server</span>
              <select v-model="selectedServerIp" :disabled="isInstalling || manualIp !== ''"
                class="h-[2.9rem] text-default rounded-lg px-4 flex-1 border border-default w-full input-textlike">
                <option value="" disabled>— Choose a detected server —</option>
                <option v-for="srv in discoveryState.servers" :key="srv.ip" :value="srv.ip">
                  {{ srv.name }} ({{ srv.ip }})
                </option>
              </select>
            </div>

            <div class="text-center text-xs tracking-widest uppercase opacity-70 leading-none min-h-[1rem] mt-2">OR</div>

            <div class="flex flex-col text-left">
              <span class="mb-1 text-sm font-semibold opacity-90">Connect manually via IP</span>
              <input v-model="manualIp" type="text" placeholder="192.168.1.123" :disabled="isInstalling"
                class="h-[2.9rem] text-default input-textlike border px-4 rounded-lg text-lg w-full" />
            </div>

            <div class="flex items-center gap-2 mt-3">
              <button type="button" @click="onRescanServers" :disabled="isInstalling"
                class="btn btn-primary px-4 py-1 text-sm whitespace-nowrap">
                Rescan Servers
              </button>
              <a href="#" @click.prevent="onRestartSetup" class="text-sm text-blue-400 hover:underline ml-2">
                Start Over
              </a>
            </div>
          </section>

          <!-- Authentication Panel -->
          <section class="min-w-0 p-4 rounded-lg shadow-lg border border-default bg-accent">
            <div class="text-sm tracking-wider uppercase opacity-85 font-bold mb-2">Authentication</div>

            <label class="flex flex-col text-left">
              <span class="mb-1 text-sm font-semibold opacity-90">Username</span>
              <input v-model="username" type="text" placeholder="root" :disabled="isInstalling"
                class="h-[2.9rem] text-default input-textlike px-4 py-2 rounded-lg text-lg w-full border" />
            </label>

            <div class="invisible text-center text-xs tracking-widest uppercase opacity-70 leading-none min-h-[1rem] mt-2" aria-hidden="true">&nbsp;</div>

            <label class="flex flex-col text-left">
              <span class="mb-1 text-sm font-semibold opacity-90">Password</span>
              <div class="w-full relative">
                <input v-model="password" v-enter-next :type="showPassword ? 'text' : 'password'"
                  :disabled="isInstalling" placeholder="••••••••"
                  class="h-[2.9rem] text-default input-textlike px-4 py-2 rounded-lg text-lg w-full border" />
                <button type="button" @click="togglePassword" :disabled="isInstalling"
                  class="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted">
                  <EyeIcon v-if="!showPassword" class="w-5 h-5" />
                  <EyeSlashIcon v-else class="w-5 h-5" />
                </button>
              </div>
            </label>

            <p class="text-xs italic opacity-75 mt-2 text-center">
              These credentials are used to securely connect to the server, install required software,
              and auto-login to the server's management interface. <br/>
              <span class="text-sm text-red-600 dark:text-red-400"><b>Admin</b> or <b>sudo</b>-level privileges are required for setup.</span>
            </p>
          </section>
        </div>

        <!-- Status / Troubleshooting -->
        <div v-if="statusMessage || isInstalling" class="mt-1 text-center">
          <div v-if="isInstalling" class="flex items-center justify-center gap-2">
            <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none" opacity=".25" />
              <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" stroke-width="4" fill="none" />
            </svg>
            <span class="text-base">{{ statusMessage }}</span>
          </div>
          <p v-else-if="statusMessage" class="text-base">
            {{ statusMessage }}
            <br />
            <span class="text-sm">Troubleshooting steps:</span>
            <CommanderToolTip :width="1450" :message="`Troubleshoot Steps!
        1.) Plugin monitor and keyboard into your server.
        2.) Login to the user you want to use. On fresh machines the user is <b>root</b> and password is <b>45Dr!ves</b>.
        3.) If using root make sure root login over SSH is enabled. nano /etc/ssh/sshd_config and look for PermitRootLogin yes
        4.) Check if the server has internet access. ping google.ca
        `" />
          </p>
        </div>

      </div>
    </form>

    <!-- Footer Buttons -->
    <template #footer>
      <div class="button-group-row w-full justify-between">
        <button type="button" @click="goBackStep" class="btn btn-secondary w-40 h-fit py-4">
          Back
        </button>

        <button type="button" class="btn btn-primary w-40 h-fit py-4"
          :disabled="!canProceed || isInstalling"
          @click="proceedToNextStep">
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
import { CardContainer, reportError } from '@45drives/houston-common-ui'
import { useWizardSteps, useEnterToAdvance } from '@45drives/houston-common-ui';
import { IPCRouter } from '@45drives/houston-common-lib';
import { EyeIcon, EyeSlashIcon } from "@heroicons/vue/20/solid";
import { Server, DiscoveryState } from '../../types';
import { computed, inject, onBeforeUnmount, onMounted, ref, watch, Ref } from 'vue';
import { useRouter } from 'vue-router'
import { CommanderToolTip } from '../../components/commander';
import { useHeader } from '../../composables/useHeader'
import { useServerCredentials } from '../../composables/useServerCredentials'
import { useRebootWatcher } from '../../composables/useRebootWatcher'
import { currentServerInjectionKey, discoveryStateInjectionKey } from '../../keys/injection-keys'

const router = useRouter()
const providedCurrentServer = inject(currentServerInjectionKey) as Ref<Server | null>
const discoveryState = inject<DiscoveryState>(discoveryStateInjectionKey)!
const { setCredentials } = useServerCredentials()

useHeader('Discovered 45Drives Servers')

const showPassword = ref(false);
const togglePassword = () => { showPassword.value = !showPassword.value; };
const statusMessage = ref('');
const isInstalling = ref(false);

const { completeCurrentStep, unCompleteCurrentStep, prevStep, reset } = useWizardSteps("setup");

// --- Server selection ---
const selectedServerIp = ref('');
const manualIp = ref('');
const username = ref('root');
const password = ref('');

const selectedServer = computed<Server | undefined>(() =>
  discoveryState.servers.find(s => s.ip === selectedServerIp.value)
);

// Auto-select first server when discovery populates
watch(() => discoveryState.servers.length, (len) => {
  if (len > 0 && !selectedServerIp.value && !manualIp.value) {
    selectedServerIp.value = discoveryState.servers[0].ip;
  }
}, { immediate: true });

// If manual IP matches a discovered server, switch to the dropdown
watch(manualIp, (val) => {
  const ip = val.trim();
  const hit = ip ? discoveryState.servers.find(s => s.ip === ip) : undefined;
  if (hit) {
    selectedServerIp.value = hit.ip;
    manualIp.value = '';
  } else if (val !== '') {
    selectedServerIp.value = '';
  }
});

// Clear manual IP when selecting from dropdown
watch(selectedServerIp, () => {
  if (selectedServerIp.value !== '') manualIp.value = '';
});

const effectiveIp = computed(() => {
  return (selectedServer.value?.ip || manualIp.value).trim();
});

const isManualEntry = computed(() => {
  return !selectedServer.value && !!manualIp.value.trim();
});

const canProceed = computed(() => {
  if (!effectiveIp.value) return false;
  if (!username.value.trim()) return false;
  if (!password.value.trim()) return false;
  // Validate manual IP format
  if (isManualEntry.value) {
    return /^((25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/.test(effectiveIp.value);
  }
  return true;
});

function onRescanServers() {
  selectedServerIp.value = '';
  manualIp.value = '';
  IPCRouter.getInstance().send(
    'backend',
    'action',
    JSON.stringify({ type: 'rescanServers' })
  );
}

function friendlySshError(raw?: string): string {
  const msg = (raw ?? '').toLowerCase();
  if (msg.includes('authentication') || msg.includes('auth')) {
    return 'Incorrect username or password. Please double-check your credentials and try again.';
  }
  if (msg.includes('timed out') || msg.includes('timeout')) {
    return 'Connection timed out. The server may be unreachable or SSH is not running.';
  }
  if (msg.includes('econnrefused') || msg.includes('connection refused')) {
    return 'Connection refused. Make sure SSH (port 22) is enabled on the server.';
  }
  if (msg.includes('getaddrinfo') || msg.includes('enotfound')) {
    return 'Could not resolve the server address. Please check the IP.';
  }
  return raw || 'Authentication failed. Please check your credentials.';
}

interface InstallResult {
  success: boolean;
  error?: string;
  rebootRequired?: boolean;
  reboot?: boolean;
}

const rebootWatcher = useRebootWatcher();

const installModule = async (
  host: string,
  user: string,
  pass: string
): Promise<InstallResult> => {
  isInstalling.value = true;
  statusMessage.value = "Connecting to server, uploading SSH key and installing packages… This may take several minutes.";

  try {
    const result = await IPCRouter
      .getInstance()
      .invoke<InstallResult>("install-cockpit-module", {
        host,
        username: user,
        password: pass,
      });

    console.debug("installModule result:", result);
    if (!result.success) {
      statusMessage.value = '';
      reportError(new Error(friendlySshError(result.error)));
    } else if (result.reboot) {
      statusMessage.value = "Setup installed. Server will reboot to finish enabling ZFS…";
      await rebootWatcher.waitFor(host);
    } else {
      statusMessage.value = "Modules installed and SSH key uploaded!";
    }
    return result;
  } catch (err: unknown) {
    console.error("installModule failed:", err);
    statusMessage.value = '';
    const raw = err instanceof Error ? err.message : String(err);
    reportError(new Error(friendlySshError(raw)));
    return { success: false, error: raw };
  } finally {
    isInstalling.value = false;
  }
};

const goBackStep = () => prevStep();

const proceedToNextStep = async () => {
  const ip = effectiveIp.value;
  const user = username.value.trim();
  const pass = password.value.trim();

  if (!ip) {
    reportError(new Error("Please select or enter a server before continuing."));
    return;
  }
  if (!user) {
    reportError(new Error("Please enter a username."));
    return;
  }
  if (!pass) {
    reportError(new Error("Please enter a password."));
    return;
  }

  if (isManualEntry.value) {
    if (!/^((25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/.test(ip)) {
      reportError(new Error("Please enter a valid IPv4 address."));
      return;
    }

    // Notify backend about the manual IP
    IPCRouter.getInstance().send(
      'backend',
      'action',
      JSON.stringify({ type: 'addManualIP', ip, manuallyAdded: true })
    );
  }

  // Verify credentials and check admin privileges before proceeding
  isInstalling.value = true;
  statusMessage.value = "Verifying credentials…";
  try {
    const check = await IPCRouter
      .getInstance()
      .invoke<{ success: boolean; error?: string; isAdmin?: boolean }>("verify-ssh-credentials", {
        host: ip,
        username: user,
        password: pass,
      });
    if (!check.success) {
      const friendlyMsg = friendlySshError(check.error);
      statusMessage.value = '';
      reportError(new Error(friendlyMsg));
      return;
    }
    if (!check.isAdmin) {
      statusMessage.value = '';
      reportError(new Error(
        "Admin privileges are required to set up a server. " +
        "Please use a root or sudo-enabled account."
      ));
      return;
    }
  } catch (err: unknown) {
    statusMessage.value = '';
    reportError(new Error("Could not verify credentials. Is the server reachable?"));
    return;
  } finally {
    isInstalling.value = false;
  }

  // Determine if we need to run the install module
  // (manual entries and fallback-detected servers always need install)
  const srv = selectedServer.value;
  const needsInstall = isManualEntry.value || srv?.manuallyAdded || srv?.fallbackAdded;

  if (needsInstall) {
    // install-cockpit-module handler in main also sends store-manual-creds
    // to CockpitWebview for auto-login
    const result = await installModule(ip, user, pass);
    if (!result.success) return;
  }

  // Set the current server for the rest of the app
  providedCurrentServer.value = srv ?? {
    ip,
    name: ip,
    lastSeen: Date.now(),
    status: 'unknown',
    manuallyAdded: true,
  };

  // Store credentials so CockpitWebview can auto-login + auto-elevate
  setCredentials(ip, user, pass);

  // Also send via IPC so main process and any already-mounted listeners get it
  window.electron?.ipcRenderer.send('store-manual-creds', {
    ip,
    username: user,
    password: pass,
  });

  // Navigate to the cockpit webview
  router.push({ name: 'houston' });

  unCompleteCurrentStep();
  completeCurrentStep(true, { ip, name: srv?.name ?? ip } as Record<string, any>);
};

const onRestartSetup = () => reset();

useEnterToAdvance(
  () => {
    if (canProceed.value) proceedToNextStep();
  },
  200,
  () => {
    if (canProceed.value) proceedToNextStep();
  },
  () => {
    goBackStep();
  }
);
</script>
