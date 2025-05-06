<template>
  <div
    class="w-screen h-screen overflow-hidden flex flex-col items-center justify-center text-default bg-default text-center">

    <div>
      <button @click="showWizard('storage')" class="btn btn-secondary w-40 h-min p-2 mx-2">
        Storage Setup
      </button>

      <button @click="showWizard('backup')" class="btn btn-secondary w-40 h-min p-2 mx-2">
        Backup Setup
      </button>

      <button @click="showWizard('restore-backup')" class="btn btn-secondary w-40 h-min p-2 mx-2">
        Restore Backup
      </button>
    </div>

    <div class="w-full h-full flex items-center justify-center" v-show="showWelcomeSetupWizard">
      <StorageSetupWizard id="setup" :onComplete="onWelcomeWizardComplete" />
    </div>
    <div class="w-full h-full flex items-center justify-center" v-show="showBackUpSetupWizard">
      <BackUpSetupWizard id="backup" :onComplete="onBackUpWizardComplete" />
    </div>
    <div class="w-full h-full flex items-center justify-center" v-show="showRestoreBackupWizard">
      <RestoreBackUpWizard id="restore-backup" :onComplete="onRestoreBackUpWizardComplete" />
    </div>

    <webview v-show="showWebView && !loadingWebview && !waitingForServerReboot" id="myWebview" title="test"
      :src="currentUrl" allowpopups nodeintegration allow-same-origin allow-scripts partition="persist:authSession"
      webpreferences="javascript=yes,webSecurity=no,enable-cookies=true,nodeIntegration=false,contextIsolation=true"
      ref="webview" @did-finish-load="onWebViewLoaded" />

    <div v-if="loadingWebview" class="flex flex-col items-center justify-center p-4">
      <p class="text-2xl text-center">Give us a few while we login...</p>
      <div id="spinner" class="spinner"></div>
    </div>

    <div v-if="waitingForServerReboot" class="flex flex-col items-center justify-center p-4">
      <p class="text-2xl text-center">Waiting for {{ currentServer!.ip }} to reboot...</p>
      <div id="spinner" class="spinner"></div>
    </div>

    <div v-if="scanningNetworkForServers" class="flex flex-col items-center justify-center p-4">
      <p class="text-2xl text-center">Give us a few while we scan for connected servers...</p>
      <div id="spinner" class="spinner"></div>
    </div>

    <NotificationView />

    <!-- Page curl corner effect -->
    <div v-if="!showWebView" class="page-corner-effect pointer-events-none"></div>

    <!-- Double arrows -->
    <div v-if="!showWebView"
      class="double-arrow absolute bottom-4 right-4 z-10 text-gray-400 text-xl animate-pulse pointer-events-none">
      &raquo;
    </div>
  </div>

</template>

<script setup lang="ts">
import { onMounted, provide, ref, unref, watch } from 'vue';
import { useDarkModeState } from './composables/useDarkModeState';
import { useAdvancedModeState } from './composables/useAdvancedState';
import { reportError, reportSuccess } from './components/NotificationView.vue';
import NotificationView from './components/NotificationView.vue';
import { Server, DivisionType } from './types';
import { useWizardSteps } from '@45drives/houston-common-ui'
import StorageSetupWizard from './views/storageSetupWizard/Wizard.vue';
import BackUpSetupWizard from './views/backupSetupWizard/Wizard.vue';
import RestoreBackUpWizard from './views/restoreBackupWizard/Wizard.vue';
import { divisionCodeInjectionKey, currentServerInjectionKey } from './keys/injection-keys';
import { IPCMessageRouterRenderer, IPCRouter, server } from '@45drives/houston-common-lib';

IPCRouter.initRenderer();
IPCRouter.getInstance().addEventListener("action", async (data) => {
  console.log("action in renderer: ", data);
  try {
    if (data === "setup_wizard_go_back" || data === "show_storage_setup_wizard") {
      showWelcomeSetupWizard.value = true;
      showWebView.value = false;
      showBackUpSetupWizard.value = false;
      openStorageSetup(null);
    } else if (data === "show_back_up_setup_wizard") {
      showWelcomeSetupWizard.value = false;
      showWebView.value = false;
      showBackUpSetupWizard.value = true;

      openStorageSetup(null);
      useWizardSteps("setup").reset()
    } else if (data === "show_houston") {
      showWelcomeSetupWizard.value = false;
      showWebView.value = true;
      showBackUpSetupWizard.value = false;

      const serverIp = currentServer.value?.ip;

      loadingWebview.value = true;
      currentUrl.value = `https://${serverIp}:9090`;
    }

    if (data.endsWith("_reboot")) {
      await waitForServerRebootAndShowWizard();
    }

  } catch (error) {
    console.log(error)
  }
});

const waitingForServerReboot = ref(false);

async function waitForServerRebootAndShowWizard() {
  const serverIp = currentServer.value?.ip;
  if (!serverIp) {
    console.error("No current server IP found!");
    waitingForServerReboot.value = false;
    return;
  }

  const pingUrl = `https://${serverIp}:9090/`;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  console.log(`Waiting for server at ${pingUrl} to reboot...`);

  let serverUp = false;
  const startTime = Date.now();
  const timeout = 5 * 60 * 1000; // 5 minutes max wait

  while (!serverUp && (Date.now() - startTime) < timeout) {
    try {
      const res = await fetch(pingUrl, { method: 'GET' });
      if (res.ok) {
        serverUp = true;
        console.log("✅ Server is back online!");
      } else {
        console.log("Server not ready yet. Retrying...");
      }
    } catch {
      console.log("Server still down, retrying...");
    }
    if (!serverUp) await sleep(5000);
  }

  if (serverUp) {
    waitingForServerReboot.value = false;
    showBackUpSetupWizard.value = true;
    useWizardSteps("setup").reset();
  } else {
    waitingForServerReboot.value = false;
    reportError(new Error("Server did not come back online within timeout."));
    showWelcomeSetupWizard.value = true;
  }
}

const currentTheme = ref("theme-default");

const aliasStyleToTheme: Record<string, string> = {
  homelab: 'theme-homelab',
  professional: 'theme-professional'
};

function applyThemeFromAliasStyle(aliasStyle?: string) {
  console.log('detected alias style:', aliasStyle);
  const normalized = aliasStyle?.toLowerCase() || '';
  const themeClass = aliasStyleToTheme[normalized] || 'theme-default';

  document.documentElement.classList.remove(
    'theme-default',
    'theme-homelab',
    'theme-professional'
  );

  document.documentElement.classList.add(themeClass);
  currentTheme.value = themeClass;
}

const isDev = ref(true);

window.electron.ipcRenderer.invoke('is-dev').then(value => isDev.value = value);
console.log(window.electron.ipcRenderer);

const darkModeState = useDarkModeState();

const advancedState = useAdvancedModeState();

const currentServer = ref<Server | null>(null);
const divisionCode = ref<DivisionType>('default');
const showBackUpSetupWizard = ref<boolean>(false);
const showRestoreBackupWizard = ref<boolean>(false);
const showWelcomeSetupWizard = ref<boolean>(false);
const showWebView = ref<boolean>(false);

provide(divisionCodeInjectionKey, divisionCode);
provide(currentServerInjectionKey, currentServer);

const clientip = ref<string>("");
const webview = ref();
const loadingWebview = ref(false);
const scanningNetworkForServers = ref(true);
const currentUrl = ref<string>('https://45drives.com');

window.electron.ipcRenderer.on('client-ip', (_event, ip: string) => {
  clientip.value = ip;
});

window.electron.ipcRenderer.on('notification', (_event, message: string) => {

  if (message.startsWith("Error")) {

    reportError(new Error(message))
  } else {
    try {
      const mJson = JSON.parse(message);

      if (mJson.error) {
        reportError(new Error(mJson.error));
      } else {
        reportSuccess(message);
      }
    } catch (_error) {
      // assume it is just a success message
      reportSuccess(message);
    }

  }

});

const showWizard = (type: 'storage' | 'backup' | 'restore-backup') => {
  showWelcomeSetupWizard.value = type === 'storage';
  showBackUpSetupWizard.value = type === 'backup';
  showRestoreBackupWizard.value = type === 'restore-backup';
  showWebView.value = false;
};


onMounted(() => {
  setTimeout(() => {
    scanningNetworkForServers.value = false;
  }, 7000);

  const updateTheme = () => {
    const found = Array.from(document.documentElement.classList).find(cls =>
      cls.startsWith("theme-")
    );
    console.log('found:', found);
    currentTheme.value = found || "theme-default";
    switch (currentTheme.value) {
      case 'theme-homelab':
        divisionCode.value = 'homelab';
        break;
      case 'theme-professional':
        divisionCode.value = 'professional';
        break;
      default:
        divisionCode.value = 'default';
        break;
    }
  };

  updateTheme(); // check initially

  const observer = new MutationObserver(() => updateTheme());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class']
  });

});

watch(currentTheme, (theme) => {
  switch (theme) {
    case 'theme-homelab':
      divisionCode.value = 'homelab';
      break;
    case 'theme-professional':
      divisionCode.value = 'professional';
      break;
    default:
      divisionCode.value = 'default';
      break;
  }
});

// Receive the discovered servers from the main process
let discoveredServersChecked = false;
window.electron.ipcRenderer.on('discovered-servers', (_event, discoveredServers: Server[]) => {
  if (!scanningNetworkForServers.value && !discoveredServersChecked) {
    discoveredServersChecked = true;
    const anyServersNotSetup = discoveredServers.some((server, _index, _array) => server.status !== "complete");
    if (anyServersNotSetup) {
      showWelcomeSetupWizard.value = true;
      showBackUpSetupWizard.value = false;
      showRestoreBackupWizard.value = false;
      showWebView.value = false;
    } else {
      showRestoreBackupWizard.value = false;
      showWelcomeSetupWizard.value = false;
      showBackUpSetupWizard.value = true;
      showWebView.value = false;
    }
  }

});

// Handle server click to open the website
const openStorageSetup = (server: Server | null) => {

  currentServer.value = server;
  let newUrl = "";
  if (server) {
    const prodURL = 'super-simple-setup';
    const devURL = 'super-simple-setup-test';
    newUrl = `https://${server.ip}:9090/${(isDev.value ? devURL : prodURL)}#dark=${darkModeState.value}&advanced=${advancedState.value}&client_ip=${clientip.value}&server_ip=${server.ip}`;

  } else {
    currentUrl.value = "";
  }

  if (newUrl !== currentUrl.value) {
    loadingWebview.value = true;
    currentUrl.value = newUrl;
  }

};

const onWebViewLoaded = async () => {

  const routerRenderer = IPCRouter.getInstance() as IPCMessageRouterRenderer;

  routerRenderer.setCockpitWebView(webview.value);

  if (currentUrl.value.endsWith(":9090")) {
    loadingWebview.value = false;
    webview.value.className = "h-[100vh] w-full";
    return;
  }
  webview.value.executeJavaScript(`
        new Promise((resolve, reject) => {
    if (!document.querySelector("#login")) {
      setTimeout(() => {
        [...document.querySelectorAll('#main > div')].forEach((e) => {
          if (e.id !== 'content') e.style.display = 'none';
        });

        [...document.querySelectorAll('#main > nav')].forEach((e) => {
          if (e.id !== 'content') e.style.display = 'none';              });

              document.querySelector('#main').style.gridTemplateAreas = '"header" "main"';
              document.querySelector('#main').style.gridTemplateColumns = '1fr';

              resolve("View modified and visible.");
            }, 500);
          
          } else {

            console.log("Login UI showing")
            const usernameField = document.querySelector("#login-user-input");
            const passwordField = document.querySelector("#login-password-input");
            const loginButton = document.querySelector("#login-button");
            const loginForm  = document.querySelector("form");

            if (usernameField && passwordField && loginButton) {
              usernameField.value = "root";  // Insert your username
              passwordField.value = "password";  // Insert your password

              // Dispatch input events to ensure the values are recognized
              usernameField.dispatchEvent(new Event("input", { bubbles: true }));
              passwordField.dispatchEvent(new Event("input", { bubbles: true }));
              
              // Watch for login result
              const observer = new MutationObserver(() => {
                const loginError = document.querySelector("#login-error-message");
                if (loginError && loginError.textContent.includes("Wrong user name")) {
                  observer.disconnect();
                  [...document.querySelectorAll('#main > div')].forEach((e) => {
                    if (e.id !== 'content') e.style.display = 'block';
                  });
                  reject("Login failed: Wrong user name or password.");
                } else if (!document.querySelector("#login")) {
                  observer.disconnect();
                  resolve("Login successful: login form disappeared.");
                }
              });

              observer.observe(document.body, { childList: true, subtree: true });
              setTimeout(() => {
                loginButton.click();
                loginForm.submit(); // Submit the form programmatically
              }, 500); // Small delay to ensure input is registered
            } else {
              console.error("Login fields or button not found.");
            }
          }
        });
        `)
    .then((result: any) => {
      console.log("result", result);
      loadingWebview.value = false;
      webview.value.className = "h-[100vh] w-full";
    })
    .catch((error: any) => {
      console.error("Error:", error);
      loadingWebview.value = false;
      webview.value.className = "h-[100vh] w-full";
    });

  // comment this line out for prod
  webview.value.openDevTools();
}

const onWelcomeWizardComplete = (server: Server) => {

  console.log("server before unref:", server);
  const realServer = unref(server);
  console.log("server after unref:", realServer);
  const aliasStyle = realServer.serverInfo?.aliasStyle?.toLowerCase();

  applyThemeFromAliasStyle(aliasStyle);

  loginRequest(realServer)
  showWelcomeSetupWizard.value = false;
  showWebView.value = true;
  showBackUpSetupWizard.value = false;
  showRestoreBackupWizard.value = false;
}

const onBackUpWizardComplete = (server: Server) => {

  console.log("server before unref:", server);
  const realServer = unref(server);
  console.log("server after unref:", realServer);
  const aliasStyle = realServer.serverInfo?.aliasStyle?.toLowerCase();

  applyThemeFromAliasStyle(aliasStyle);

  console.log("BackUp Wizard complete")
  showBackUpSetupWizard.value = true;
  showWelcomeSetupWizard.value = false;
  showRestoreBackupWizard.value = false;
  showWebView.value = false;
}

const onRestoreBackUpWizardComplete = (server: Server) => {

  console.log("server before unref:", server);
  const realServer = unref(server);
  console.log("server after unref:", realServer);
  const aliasStyle = realServer.serverInfo?.aliasStyle?.toLowerCase();

  applyThemeFromAliasStyle(aliasStyle);

  console.log("BackUp Wizard complete")
  showBackUpSetupWizard.value = true;
  showWelcomeSetupWizard.value = false;
  showRestoreBackupWizard.value = false;
  showWebView.value = false;
}


const loginRequest = async (server: Server) => {
  openStorageSetup(server);
};

</script>

<style scoped>
.selected {
  @apply bg-blue-500 text-white border-blue-600;
}

/* Loading spinner */
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

.page-corner-effect {
  position: fixed;
  bottom: 0;
  right: 0;
  width: 10%;
  height: 40%;
  background: linear-gradient(135deg, rgba(0, 0, 0, 0.4) 0%, rgba(0, 0, 0, 0.1) 100%);
  clip-path: polygon(100% 100%, 0% 100%, 100% 0%);
  z-index: 1;
  transform: rotate(0deg);
  opacity: 0.8;
  pointer-events: none;
}

.double-arrow {
  bottom: 10%;
  font-size: 5rem;
  animation: doubleArrowPulse 1.6s infinite ease-in-out;
}

@keyframes doubleArrowPulse {

  0%,
  100% {
    transform: translateY(0);
    opacity: 0.5;
  }

  50% {
    transform: translateY(-6px);
    opacity: 1;
  }
}
</style>
