<template>

  <div class="w-screen h-screen overflow-hidden flex flex-col items-center justify-center text-default bg-default">

    <div v-if="isDev">
      <button @click="showWizard('storage')" class="btn btn-secondary w-40 h-min p-2 mx-2">
        Storage Setup
      </button>

      <button @click="showWizard('backup')" class="btn btn-secondary w-40 h-min p-2 mx-2">
        Backup Setup
      </button>
    </div>

    <div class="w-full h-full" v-show="showWelcomeSetupWizard">
      <StorageSetupWizard id="setup" :onComplete="onWelcomeWizardComplete" />
    </div>
    <div class="w-full h-full" v-show="showBackUpSetupWizard">
      <BackUpSetupWizard id="backup" :onComplete="onBackUpWizardComplete" />
    </div>


    <webview v-show="showWebView && !loadingWebview" id="myWebview" title="test" :src="currentUrl" allowpopups
      nodeintegration allow-same-origin allow-scripts partition="persist:authSession"
      webpreferences="javascript=yes,webSecurity=no,enable-cookies=true,nodeIntegration=false,contextIsolation=true"
      ref="webview" @did-finish-load="onWebViewLoaded" />

    <div v-if="loadingWebview" class="p-4">
      <p class="w-3/4 text-2xl">
        Give us a few while we login...
      </p>
      <div id="spinner" class="spinner"></div>
    </div>

    <div v-if="scanningNetworkForServers" class="p-4">
      <p class="w-3/4 text-2xl">
        Give us a few while we scan for connected servers...
      </p>
      <div id="spinner" class="spinner"></div>
    </div>

    <NotificationView />

  </div>

</template>

<script setup lang="ts">
import { onMounted, provide, ref } from 'vue';
import { useDarkModeState } from './composables/useDarkModeState';
import { useAdvancedModeState } from './composables/useAdvancedState';
import { reportError, reportSuccess } from './components/NotificationView.vue';
import NotificationView from './components/NotificationView.vue';
import { Server } from './types';
import { useWizardSteps } from './components/wizard'
import StorageSetupWizard from './views/storageSetupWizard/Wizard.vue';
import BackUpSetupWizard from './views/backupSetupWizard/Wizard.vue';
import { serverInfoInjectionKey } from './keys/injection-keys';
import { IPCMessageRouterRenderer, IPCRouter } from '@45drives/houston-common-lib';

IPCRouter.initRenderer();
IPCRouter.getInstance().addEventListener("action", (data) => {
  console.log("action in renderer: ", data);
  try {
    if (data === "setup_wizard_go_back") {
      showWelcomeSetupWizard.value = true;
      showWebView.value = false;
      showBackUpSetupWizard.value = false;

    } else if (data === "go_home") {
      console.log("Go_HOME")
      showWelcomeSetupWizard.value = false;
      showWebView.value = false;
      showBackUpSetupWizard.value = true;

      useWizardSteps("setupwizard").reset()
    }
  } catch (error) {
  }
});

const isDev = ref(false);

window.electron.ipcRenderer.invoke('is-dev').then(value => isDev.value = value);
console.log(window.electron.ipcRenderer);

const darkModeState = useDarkModeState();

const advancedState = useAdvancedModeState();

const currentServer = ref<Server | null>(null);
const showBackUpSetupWizard = ref<boolean>(false);
const showWelcomeSetupWizard = ref<boolean>(false);
const showWebView = ref<boolean>(false);

provide(currentServer, serverInfoInjectionKey);

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

    reportSuccess(message);
  }

});

const showWizard = (type: 'storage' | 'backup') => {
  showWelcomeSetupWizard.value = type === 'storage';
  showBackUpSetupWizard.value = type === 'backup';
  showWebView.value = false;
};


onMounted(() => {
  setTimeout(() => {
    scanningNetworkForServers.value = false;
  }, 5000);
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
      showWebView.value = false;
    } else {
      showWelcomeSetupWizard.value = false;
      showBackUpSetupWizard.value = true;
      showWebView.value = false;
    }
  }

});

// Handle server click to open the website
const openServerWebsite = (server: Server | null) => {

  console.log(server);

  currentServer.value = server;
  let newUrl = "";
  if (server) {

    newUrl = `https://${server.ip}:9090/super-simple-setup-test#dark=${darkModeState.value}&advanced=${advancedState.value}&client_ip=${clientip.value}&server_ip=${server.ip}`;

  } else {
    currentUrl.value = "";
  }

  if (newUrl !== currentUrl.value) {
    loadingWebview.value = true;
    currentUrl.value = newUrl;
  }

};

const onWebViewLoaded = async () => {

  const routerREnderer = IPCRouter.getInstance() as IPCMessageRouterRenderer;

  routerREnderer.setCockpitWebView(webview.value);

  webview.value.executeJavaScript(`
        new Promise((resolve, reject) => {

          if (!document.querySelector("#login")) {
            setTimeout(() => {
              [...document.querySelectorAll('#main > div')].forEach((e) => {
                if (e.id !== 'content') e.style.display = 'none';
              });

              [...document.querySelectorAll('#main > nav')].forEach((e) => {
                if (e.id !== 'content') e.style.display = 'none';
              });

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
    });

  webview.value.openDevTools();
}

const onWelcomeWizardComplete = (server: Server) => {
  loginRequest(server)
  showWelcomeSetupWizard.value = false;
  showWebView.value = true;
  showBackUpSetupWizard.value = false;
}

const onBackUpWizardComplete = () => {
  console.log("BackUp Wizard complete")
  showBackUpSetupWizard.value = true;
  showWelcomeSetupWizard.value = false;
  showWebView.value = false;
}

const loginRequest = async (server: Server) => {
  openServerWebsite(server);
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
</style>
