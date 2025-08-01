<template>
  <div
    class="w-screen h-screen overflow-hidden flex flex-col items-center justify-center text-default bg-default text-center">

    <!-- 🌀 FULL SCREEN LOADING WHEN SCANNING -->
    <div v-if="scanningNetworkForServers" class="flex flex-col items-center justify-center w-full h-full p-4">
      <p class="text-2xl text-center">Give us a few while we scan for connected servers...</p>
      <div id="spinner" class="spinner"></div>
    </div>

    <!-- 🎯 MAIN APP CONTENT -->
    <div v-else class="w-full h-full relative flex flex-col items-center justify-center">

      <div class="w-full h-full flex items-center justify-center" v-if="currentWizard === 'storage'">
        <StorageSetupWizard id="setup" :onComplete="onWizardComplete" />
      </div>

      <div class="w-full h-full flex items-center justify-center" v-else-if="currentWizard === 'backup'">
        <BackUpSetupWizard id="backup" :onComplete="onWizardComplete" />
      </div>

      <div class="w-full h-full flex items-center justify-center" v-else-if="currentWizard === 'restore-backup'">
        <RestoreBackUpWizard id="restore-backup" :onComplete="onWizardComplete" />
      </div>

      <webview v-show="showWebView && !loadingWebview && !waitingForServerReboot" id="myWebview" :src="currentUrl"
        partition="persist:authSession"
        webpreferences="contextIsolation=true, nodeIntegration=false, enableRemoteModule=false" ref="webview" allowpopups
        @did-finish-load="onWebViewLoaded" />

      <div v-if="loadingWebview" class="absolute inset-0 z-40 bg-default flex flex-col items-center justify-center">
        <p class="text-2xl text-center">
          <template v-if="loadingWebview">Give us a few while we login...</template>
        </p>
        <div id="spinner" class="spinner"></div>
      </div>

    </div>
  </div>
  <GlobalModalConfirm />
  <NotificationView />
</template>

<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount, provide, reactive, ref, unref, watch } from 'vue';
import { useAdvancedModeState } from './composables/useAdvancedState';
import { Server, DivisionType, DiscoveryState } from './types';
import { GlobalModalConfirm, Notification, reportError, reportSuccess, useDarkModeState, NotificationView, pushNotification } from '@45drives/houston-common-ui'
import StorageSetupWizard from './views/storageSetupWizard/Wizard.vue';
import BackUpSetupWizard from './views/backupSetupWizard/Wizard.vue';
import RestoreBackUpWizard from './views/restoreBackupWizard/Wizard.vue';
import { divisionCodeInjectionKey, currentServerInjectionKey, currentWizardInjectionKey, thisOsInjectionKey, discoveryStateInjectionKey } from './keys/injection-keys';
import { IPCMessageRouterRenderer, IPCRouter } from '@45drives/houston-common-lib';

const thisOS = ref<string>('');
const setOs = (value: string) => {
  thisOS.value = value;
};

const discoveryState = reactive<DiscoveryState>({
  servers: [],
  fallbackTriggered: false,
})
provide(discoveryStateInjectionKey, discoveryState)

provide(thisOsInjectionKey, thisOS);

IPCRouter.initRenderer();

const isRebootWatcherRunning = ref(false);

const currentWizard = ref<'storage' | 'backup' | 'restore-backup' | null>('storage');
provide(currentWizardInjectionKey, currentWizard);

const waitingForServerReboot = ref(false);
let rebootNotification: Notification | null = null;

watch(waitingForServerReboot, () => {
  
  if (waitingForServerReboot.value) {
    if (!rebootNotification) {
      rebootNotification = new Notification(
        'Server Rebooting',
        `Waiting for ${currentServer.value?.ip} to reboot...`,
        'info',
        'never'
      );
      pushNotification(rebootNotification);
    }
  } else {
    if (rebootNotification) {
      rebootNotification.remove();
      rebootNotification = null;
    }
  }
}, { immediate: true });

let hasOpenedHouston = false;

function openHoustonWindow() {
  if (hasOpenedHouston) return;
  hasOpenedHouston = true;

  const url = `https://${currentServer.value?.ip}:9090`;
  window.open(url, '_blank', 'width=1200,height=800,noopener,noreferrer');

  setTimeout(() => {
    hasOpenedHouston = false;
  }, 5000);
}

let lastToastShownIp: string | null = null;

async function waitForServerRebootAndOpenHouston() {
  const server = currentServer.value;
  const serverIp = server?.ip;
  if (!serverIp) {
    console.error("No current server IP found!");
    return;
  }

  waitingForServerReboot.value = true;

  const pingUrl = `https://${serverIp}:9090/`;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  console.log(`Waiting for server at ${pingUrl} to reboot...`);

  let serverUp = false;
  const startTime = Date.now();
  const timeout = 5 * 60 * 1000;

  while (!serverUp && (Date.now() - startTime) < timeout) {
    try {
      const res = await fetch(pingUrl, { method: 'GET', cache: 'no-store' });
      if (res.ok) {
        await sleep(5000);
        const confirmRes = await fetch(pingUrl, { method: 'GET', cache: 'no-store' });
        if (confirmRes.ok) {
          serverUp = true;
          break;
        }
      }
    } catch {
      // ignored
    }

    await sleep(5000);
  }

  waitingForServerReboot.value = false;

  if (serverUp) {
    await nextTick();

    const houstonUrl = `https://${serverIp}:9090`;
    window.open(houstonUrl, '_blank', 'width=1200,height=800,noopener,noreferrer');

    // ✅ Toast success once
    if (serverIp !== lastToastShownIp) {
      pushNotification(new Notification(
        'Server Available',
        `${serverIp} is now accessible!`,
        'success',
        8000
      ));
      lastToastShownIp = serverIp;
    }

  } else {
    reportError(new Error("Server did not come back online within timeout."));
    currentWizard.value = 'storage';
  }

  if (rebootNotification) {
    rebootNotification.remove();
    rebootNotification = null;
  }
}

async function waitForServerRebootAndShowWizard() {
  const server = currentServer.value;
  const serverIp = server?.ip;
  if (!serverIp) {
    console.error("No current server IP found!");
    return;
  }

  waitingForServerReboot.value = true;

  const pingUrl = `https://${serverIp}:9090/`;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  console.log(`Waiting for server at ${pingUrl} to reboot...`);

  let serverUp = false;
  const startTime = Date.now();
  const timeout = 5 * 60 * 1000;

  while (!serverUp && (Date.now() - startTime) < timeout) {
    try {
      const res = await fetch(pingUrl, { method: 'GET', cache: 'no-store' });
      if (res.ok) {
        await sleep(5000);
        const confirmRes = await fetch(pingUrl, { method: 'GET', cache: 'no-store' });
        if (confirmRes.ok) {
          serverUp = true;
          break;
        }
      }
    } catch {
      // ignored
    }

    await sleep(5000);
  }

  if (serverUp) {
    waitingForServerReboot.value = false;
    currentWizard.value = 'backup';

    await nextTick();

    // ✅ Trigger the "Server Available" toast directly here
    if (serverIp !== lastToastShownIp) {
      pushNotification(new Notification(
        'Server Available',
        `${serverIp} is now accessible!`,
        'success',
        8000
      ));
      lastToastShownIp = serverIp;
    }

  } else {
    waitingForServerReboot.value = false;
    reportError(new Error("Server did not come back online within timeout."));
    currentWizard.value = 'storage';
  }


  if (rebootNotification) {
    rebootNotification.remove();
    rebootNotification = null;
  }
}

async function waitForServerReboot() {
  const server = currentServer.value;
  const serverIp = server?.ip;
  if (!serverIp) {
    console.error("No current server IP found!");
    return;
  }


  const pingUrl = `https://${serverIp}:9090/`;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  console.log(`Waiting for server at ${pingUrl} to reboot...`);

  let serverUp = false;
  const startTime = Date.now();
  const timeout = 5 * 60 * 1000;

  while (!serverUp && (Date.now() - startTime) < timeout) {
    try {
      const res = await fetch(pingUrl, { method: 'GET', cache: 'no-store' });
      if (res.ok) {
        await sleep(5000);
        const confirmRes = await fetch(pingUrl, { method: 'GET', cache: 'no-store' });
        if (confirmRes.ok) {
          serverUp = true;
          break;
        }
      }
    } catch {
      // ignored
    }

    await sleep(5000);
  }

  if (serverUp) {
    await nextTick();

    // ✅ Trigger the "Server Available" toast directly here
    if (serverIp !== lastToastShownIp) {
      pushNotification(new Notification(
        'Server Available',
        `${serverIp} is now accessible!`,
        'success',
        8000
      ));
      lastToastShownIp = serverIp;
    }

  } else {
    waitingForServerReboot.value = false;
    reportError(new Error("Server did not come back online within timeout."));
    currentWizard.value = 'storage';
  }


  if (rebootNotification) {
    rebootNotification.remove();
    rebootNotification = null;
  }
}

provide('reboot-function', waitForServerReboot);

const currentTheme = ref("theme-default");

const aliasStyleToTheme: Record<string, string> = {
  homelab: 'theme-homelab',
  professional: 'theme-professional'
};

function applyThemeFromAliasStyle(aliasStyle?: string) {
  // console.log('detected alias style:', aliasStyle);
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

const isDev = ref(false);

// window.electron.ipcRenderer.invoke('is-dev').then(value => isDev.value = value);
// console.log(window.electron.ipcRenderer);

const darkModeState = useDarkModeState();

const advancedState = useAdvancedModeState();

const currentServer = ref<Server | null>(null);
const divisionCode = ref<DivisionType>('default');
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

function isJsonString(str: string) {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

window.electron.ipcRenderer.on('notification', (_event, message: string) => {
  // console.log("[Renderer] 🔔 Received notification:", message);

  if (message.startsWith("Error")) {
    reportError(new Error(message));
    return;
  }

  if (isJsonString(message)) {
    const mJson = JSON.parse(message);
    if (mJson.error) {
      reportError(new Error(mJson.error));
    } else {
      reportSuccess(message);
    }
  } else {
    // Treat it as a simple success string
    reportSuccess(message);
  }
});

let actionListener: ((data: any) => void) | null = null;

onMounted(async () => {
  if (window.electron) {
    const osString = await window.electron.getOS();
    setOs(osString);

    console.log("[DEBUG] OS:" + osString);
    
    // IPCRouter.getInstance().send('backend', 'action', 'requestBackUpTasks');
    
  }
  
  setTimeout(() => {
    scanningNetworkForServers.value = false;
  }, 7000);

  window.electron.ipcRenderer.on(
    'discovered-servers',
    (_evt, mdnsList: Server[]) => {
      mdnsList.forEach(m => {
        const idx = discoveryState.servers.findIndex(s => s.ip === m.ip)

        if (idx > -1) {
          const current = discoveryState.servers[idx];
          const hasRealHostname = m.name && m.name !== m.ip;

          // merge logic: only replace if the new one has better info
          const updated = {
            ...current,
            ...m,
            name: hasRealHostname ? m.name : current.name,
            fallbackAdded: m.fallbackAdded ?? (hasRealHostname ? false : current.fallbackAdded),
          };

          discoveryState.servers.splice(idx, 1, updated);
        } else {
          discoveryState.servers.push(m);
        }
      });
      discoveryState.servers.sort((a, b) => {
        if (a.name === a.ip && b.name !== b.ip) return 1;
        if (a.name !== a.ip && b.name === b.ip) return -1;
        return 0;
      });
    }
  )

  setTimeout(async () => {
    if (discoveryState.fallbackTriggered) return
    discoveryState.fallbackTriggered = true
    try {
      const fallback: Server[] = await window.electron.ipcRenderer.invoke('scan-network-fallback')
      const toAdd = fallback.filter(fb =>
        !discoveryState.servers.some(existing => existing.ip === fb.ip)
      )
      if (toAdd.length) {
        discoveryState.servers.push(...toAdd)
        pushNotification(new Notification(
          'Fallback Discovery',
          `Found ${toAdd.length} additional server(s) via IP scan.`,
          'success',
          6000
        ))
      }
    } catch (err) {
      console.error('Fallback scan failed:', err)
      reportError(new Error('Fallback scan failed.'))
    }
  }, 1200)

  const updateTheme = () => {
    const found = Array.from(document.documentElement.classList).find(cls =>
      cls.startsWith("theme-")
    );
    // console.log('found:', found);
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

  window.electron.ipcRenderer.send("renderer-ready", {});

  const router = IPCRouter.getInstance();

  if (!actionListener) {
    actionListener = async (data: any) => {
      try {
        const message = typeof data === 'string' ? JSON.parse(data) : data;

        switch (message.type) {
          case 'show_wizard':
          case 'wizard_go_back':
            if (['storage', 'backup', 'restore-backup'].includes(message.wizard)) {
              currentWizard.value = message.wizard;
              showWebView.value = false;
              openStorageSetup(null);
            }
            break;

          case 'reboot_and_show_wizard':
            if (isRebootWatcherRunning.value) return;
            isRebootWatcherRunning.value = true;
            currentWizard.value = message.wizard;
            showWebView.value = false;
            await waitForServerRebootAndShowWizard();
            isRebootWatcherRunning.value = false;
            break;

          case 'show_webview':
            currentWizard.value = null;
            openHoustonWindow();
            break;

          case 'reboot_and_show_webview':
            if (isRebootWatcherRunning.value) return;
            isRebootWatcherRunning.value = true;
            await waitForServerRebootAndOpenHouston();
            isRebootWatcherRunning.value = false;
            break;
          default:
            break;
        }
      } catch (err) {
        console.error("❌ IPC action handler error:", err);
      }
    };

    router.addEventListener("action", actionListener);
  }
});

onBeforeUnmount(() => {
  const router = IPCRouter.getInstance();
  if (actionListener) {
    router.removeEventListener("action", actionListener);
    actionListener = null;
  }
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
}, { deep: true, immediate: true});

// Receive the discovered servers from the main process
let discoveredServersChecked = false;
window.electron.ipcRenderer.on('discovered-servers', (_event, discoveredServers: Server[]) => {
  if (!scanningNetworkForServers.value && !discoveredServersChecked) {
    discoveredServersChecked = true;
    const anyServersNotSetup = discoveredServers.some((server) => server.status !== "complete");
    currentWizard.value = anyServersNotSetup ? 'storage' : 'backup';
    // currentWizard.value = 'storage';
    showWebView.value = false;
  }

});

const manualCreds = ref<{ ip: string; username: string; password: string } | null>(null);

window.electron.ipcRenderer.on('store-manual-creds', (_event, data) => {
  manualCreds.value = data;
});

// Handle server click to open the website
const openStorageSetup = (server: Server | null) => {

  currentServer.value = server;
  let newUrl = "";
  if (server) {
    // const prodURL = 'super-simple-setup';
    // const devURL = 'super-simple-setup-test';
    // newUrl = `https://${server.ip}:9090/${(isDev.value ? devURL : prodURL)}#dark=${darkModeState.value}&advanced=${advancedState.value}&client_ip=${clientip.value}&server_ip=${server.ip}`;

    newUrl = `https://${server.ip}:9090/super-simple-setup#dark=${darkModeState.value}&advanced=${advancedState.value}&client_ip=${clientip.value}&server_ip=${server.ip}`;
    // newUrl = `https://${server.ip}:9090/super-simple-setup-test#dark=${darkModeState.value}&advanced=${advancedState.value}&client_ip=${clientip.value}&server_ip=${server.ip}`;

  } else {
    currentUrl.value = "";
  }

  if (newUrl !== currentUrl.value) {
    loadingWebview.value = true;
    currentUrl.value = newUrl;
  }

};
const onWebViewLoaded = async () => {
  const user = manualCreds.value?.username ?? "root";
  const pass = manualCreds.value?.password ?? "45Dr!ves";

  const routerRenderer = IPCRouter.getInstance() as IPCMessageRouterRenderer;
  routerRenderer.setCockpitWebView(webview.value);

  if (currentUrl.value.endsWith(":9090")) {
    loadingWebview.value = false;
    webview.value.className = "h-[100vh] w-full";
    webview.value.style.visibility = "visible";
    return;
  }

  const loginScript = `
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
        console.log("Login UI showing");
        const usernameField = document.querySelector("#login-user-input");
        const passwordField = document.querySelector("#login-password-input");
        const loginButton = document.querySelector("#login-button");
        const loginForm  = document.querySelector("form");

        if (usernameField && passwordField && loginButton) {
          usernameField.value = "${user}";
          passwordField.value = "${pass}";

          usernameField.dispatchEvent(new Event("input", { bubbles: true }));
          passwordField.dispatchEvent(new Event("input", { bubbles: true }));

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
            loginForm.submit();
          }, 500);
        } else {
          console.error("Login fields or button not found.");
        }
      }
    });
  `;

  await webview.value.executeJavaScript(loginScript)
    .then((result: any) => {
      loadingWebview.value = false;
      webview.value.className = "h-[100vh] w-full";
      webview.value.style.visibility = "visible";
    })
    .catch((error: any) => {
      console.error("Webview login error:", error);
      loadingWebview.value = false;
      webview.value.className = "h-[100vh] w-full";
      webview.value.style.visibility = "visible";
    });

  if (isDev.value) {
    webview.value.openDevTools();
  }
};

const onWizardComplete = (server: Server) => {
  const realServer = unref(server);
  const aliasStyle = realServer.serverInfo?.aliasStyle?.toLowerCase();

  applyThemeFromAliasStyle(aliasStyle);

  // Open Cockpit view
  loginRequest(realServer);
  currentWizard.value = null;
  showWebView.value = true;
};



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
</style>
