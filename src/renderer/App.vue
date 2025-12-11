<template>
  <div
    class="w-screen h-screen overflow-hidden flex flex-col items-center justify-center text-default bg-default text-center">

    <!-- FULL SCREEN LOADING WHEN SCANNING -->
    <div v-if="scanningNetworkForServers" class="flex flex-col items-center justify-center w-full h-full p-4">
      <p class="text-2xl text-center">Give us a few while we scan for connected servers...</p>
      <div id="spinner" class="spinner"></div>
    </div>

    <!--  MAIN APP CONTENT -->
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
      <!-- <div class="w-full h-full flex items-center justify-center">
        <DashboardView/>
      </div> -->

      <webview v-show="showWebView" id="myWebview" :src="currentUrl" partition="persist:authSession"
        webpreferences="contextIsolation=true, nodeIntegration=false, enableRemoteModule=false" ref="webview"
        allowpopups :style="{ visibility: webviewVisible ? 'visible' : 'hidden', height: '100vh', width: '100%' }"
        @did-finish-load="onWebViewLoaded" @did-fail-load="onWebViewFailed" />

      <div v-if="loadingWebview" class="absolute inset-0 z-40 bg-default flex flex-col items-center justify-center">
        <p class="text-2xl text-center">
          Give us a few while we login...
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
import { useServerCredentials } from "./composables/useServerCredentials";
import { useThemeFromAlias } from '../renderer/composables/useThemeFromAlias'
import DashboardView from './views/DashboardView.vue';

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

const { setCredentials, getCredentials } = useServerCredentials();

const divisionCode = ref<DivisionType>('default')
provide(divisionCodeInjectionKey, divisionCode)

const { currentTheme, currentDivision, applyThemeFromAlias, setTheme } = useThemeFromAlias()

watch(currentDivision, (d) => {
  divisionCode.value = d as DivisionType
}, { immediate: true })

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

  console.debug(`Waiting for server at ${pingUrl} to reboot...`);

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

    //  Toast success once
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

  console.debug(`Waiting for server at ${pingUrl} to reboot...`);

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

    //  Trigger the "Server Available" toast directly here
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

  console.debug(`Waiting for server at ${pingUrl} to reboot...`);

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

    //  Trigger the "Server Available" toast directly here
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

const isDev = ref(false);

// window.electron.ipcRenderer.invoke('is-dev').then(value => isDev.value = value);
// console.debug(window.electron.ipcRenderer);

const darkModeState = useDarkModeState();

const advancedState = useAdvancedModeState();

const currentServer = ref<Server | null>(null);
const showWebView = ref<boolean>(false);

provide(currentServerInjectionKey, currentServer);

const clientip = ref<string>("");
const webview = ref<any>();
const webviewVisible = ref(false);
const loadingWebview = ref(false);
const scanningNetworkForServers = ref(true);
const currentUrl = ref<string>('https://45drives.com');

const isAutoLoggingIn = ref(false);
let lastWebviewUrl = '';
const MIN_OVERLAY_MS = 500;
let overlayStart = 0;

function startOverlay() {
  overlayStart = Date.now();
  loadingWebview.value = true;
  webviewVisible.value = false;
}

function finishOverlay() {
  const elapsed = Date.now() - overlayStart;
  const remaining = Math.max(0, MIN_OVERLAY_MS - elapsed);
  setTimeout(() => {
    loadingWebview.value = false;
    webviewVisible.value = true;
  }, remaining);
}

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
  // console.debug("[Renderer]  Received notification:", message);

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

    // console.debug("[DEBUG] OS:" + osString);
    
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
        console.error(" IPC action handler error:", err);
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

window.electron.ipcRenderer.on("store-manual-creds", (_event, data: { ip: string; username: string; password: string }) => {
  setCredentials(data.ip, data.username, data.password);
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
    // loadingWebview.value = true;
    isAutoLoggingIn.value = false;
    lastWebviewUrl = "";
    startOverlay();
    showWebView.value = true;
    currentUrl.value = newUrl;
  }

};

const onWebViewLoaded = async () => {
  const url = webview.value?.getURL?.() ?? currentUrl.value;

  const ip = currentServer.value?.ip ?? "";
  const credsForServer = getCredentials(ip);

  const user = credsForServer?.username ?? "root";
  const pass = credsForServer?.password ?? "45Dr!ves";

  const routerRenderer = IPCRouter.getInstance() as IPCMessageRouterRenderer;
  routerRenderer.setCockpitWebView(webview.value);

  const loginAndSimplifyScript = `
  (function() {
    return new Promise((resolve) => {
      const LOGIN_SELECTOR  = "#login";
      const ERROR_SELECTOR  = "#login-error-message";
      const USER_SELECTOR   = "#login-user-input";
      const PASS_SELECTOR   = "#login-password-input";
      const BUTTON_SELECTOR = "#login-button";

      let observer = null;

      function simplifyLayoutForModule() {
        // Only touch layout on the super-simple-setup module
        if (!window.location.pathname.includes("/super-simple-setup")) {
          return;
        }

        function applyOnce() {
          const main = document.querySelector("#main");
          if (!main) return false;

          try {
            // Hide Cockpit chrome
            [...document.querySelectorAll("#main > div")].forEach((e) => {
              if (e.id !== "content") e.style.display = "none";
            });
            [...document.querySelectorAll("#main > nav")].forEach((e) => {
              if (e.id !== "content") e.style.display = "none";
            });

            main.style.gridTemplateAreas = '"header" "main"';
            main.style.gridTemplateColumns = "1fr";
          } catch (e) {
            console.error("Error simplifying Cockpit layout:", e);
          }
          return true;
        }

        // Try once immediately; if #main isn't ready yet, keep trying briefly.
        if (!applyOnce()) {
          let tries = 0;
          const maxTries = 20; // ~5s at 250ms

          const interval = setInterval(() => {
            tries += 1;
            if (applyOnce() || tries >= maxTries) {
              clearInterval(interval);
            }
          }, 250);
        }
      }

      function requestAdmin(user, pass) {
        if (!window.cockpit) {
          console.warn("cockpit.js not loaded yet, skipping admin request");
          return;
        }

        // 1. Ask Cockpit to require admin, which opens the dialog
        cockpit.spawn(["id", "-u"], { superuser: "require" })
          .done(out => console.log("Admin access obtained:", out.trim()))
          .fail(err => console.error("Failed to obtain admin:", err));
      }

      // function autoAdmin(user, pass) {
      //   if (!window.cockpit) return;

      //   const obs = new MutationObserver(() => {
      //     // The exact selectors may differ by Cockpit version; may need to tweak
      //     const dialog = document.querySelector('.pf-c-modal-box'); // admin modal is a PatternFly modal
      //     if (!dialog) return;

      //     const title = (dialog.querySelector('h1, h2, .pf-c-modal-box__title')?.textContent || "").toLowerCase();
      //     if (!title.includes("administrative access") && !title.includes("limited access")) return;

      //     const userField = dialog.querySelector('input[type="text"], input[autocomplete="username"]');
      //     const passField = dialog.querySelector('input[type="password"]');
      //     const okButton  = dialog.querySelector('button[type="submit"], button.pf-m-primary');

      //     if (!passField || !okButton) return;

      //     if (userField) {
      //       userField.value = user;
      //       userField.dispatchEvent(new Event("input", { bubbles: true }));
      //     }
      //     passField.value = pass;
      //     passField.dispatchEvent(new Event("input", { bubbles: true }));

      //     okButton.click();
      //     obs.disconnect();
      //   });

      //   obs.observe(document.body, { childList: true, subtree: true });

      //   // This will open the "Switch to administrative access" dialog
      //   cockpit.spawn(["id", "-u"], { superuser: "require" })
      //     .fail(err => {
      //       console.error("superuser spawn failed:", err);
      //       obs.disconnect();
      //     });
      // }


      function done(status, extra) {
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        resolve(Object.assign({ status }, extra || {}));
      }

      const globalTimeout = setTimeout(() => {
        done("timeout");
      }, 15000);

      function clearGlobalTimeout() {
        clearTimeout(globalTimeout);
      }

      const loginEl = document.querySelector(LOGIN_SELECTOR);

      // Case 1: already logged in – wait a tick, then simplify module view
      if (!loginEl) {
        setTimeout(() => {
          clearGlobalTimeout();
          simplifyLayoutForModule();
          done("no-login");
        }, 500);
        return;
      }

      // Case 2: login form present – auto-fill and watch for success/failure
      const usernameField = document.querySelector(USER_SELECTOR);
      const passwordField = document.querySelector(PASS_SELECTOR);
      const loginButton   = document.querySelector(BUTTON_SELECTOR);
      const loginForm     = document.querySelector("form");

      if (!usernameField || !passwordField || !loginButton || !loginForm) {
        clearGlobalTimeout();
        done("no-fields");
        return;
      }

      usernameField.value = "${user}";
      passwordField.value = "${pass}";
      usernameField.dispatchEvent(new Event("input", { bubbles: true }));
      passwordField.dispatchEvent(new Event("input", { bubbles: true }));

      observer = new MutationObserver(() => {
        const loginError = document.querySelector(ERROR_SELECTOR);
        const loginStillVisible = document.querySelector(LOGIN_SELECTOR);

        if (loginError) {
          const text = (loginError.textContent || "").trim();

          // Ignore Cockpit's initial JS warning
          const isJsWarning = /enable\\s+javascript/i.test(text);
          const isAuthError = /wrong user name|authentication failed|incorrect|invalid/i.test(text);

          if (isAuthError) {
            clearGlobalTimeout();
            done("login-failed", { message: text });
            return;
          }

          if (isJsWarning) {
            return;
          }
        }

        // Login form disappeared -> login succeeded
        if (!loginStillVisible) {
          setTimeout(() => {
            clearGlobalTimeout();
            simplifyLayoutForModule();
            requestAdmin("${user}", "${pass}");
            done("login-success");
            // autoAdmin("${user}", "${pass}")
          }, 800);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        try {
          loginButton.click();
          loginForm.submit();
        } catch (e) {
          console.error("Error triggering login:", e);
          clearGlobalTimeout();
          done("submit-error");
        }
      }, 500);
    });
  })();
`;


  try {
    const result = await webview.value.executeJavaScript(loginAndSimplifyScript);
    console.debug("auto-login / simplify result:", result);
    // result.status can be: "no-login", "login-success", "login-failed", "no-fields", "submit-error", "timeout"
    // We always stop the overlay below; on login-failed the user will see the login screen.
  } catch (error: any) {
    console.error("Webview login error:", error);
  } finally {
    finishOverlay();
    if (isDev.value && webview.value?.openDevTools) {
      webview.value.openDevTools();
    }
  }
};

const onWebViewFailed = (event: any) => {
  console.error(
    "Webview failed to load Cockpit:",
    event.errorCode,
    event.errorDescription,
    event.validatedURL,
  );

  loadingWebview.value = false;
  showWebView.value = false;
  currentWizard.value = 'storage';

  reportError(
    new Error(
      `Could not load Cockpit Web UI (${event.errorDescription || event.errorCode})`
    )
  );
};

const onWizardComplete = (server: Server) => {
  const realServer = unref(server);
  const aliasStyle = realServer.serverInfo?.aliasStyle;

  applyThemeFromAlias(aliasStyle);

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
