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
        @dom-ready="onWebViewDomReady" @did-finish-load="onWebViewLoaded" @did-fail-load="onWebViewFailed" />

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

    // newUrl = `https://${server.ip}:9090/super-simple-setup#dark=${darkModeState.value}&advanced=${advancedState.value}&client_ip=${clientip.value}&server_ip=${server.ip}`;
    newUrl = `https://${server.ip}:9090/super-simple-setup-test#dark=${darkModeState.value}&advanced=${advancedState.value}&client_ip=${clientip.value}&server_ip=${server.ip}`;

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

const COCKPIT_CHROME_CSS = `
/* Master switch for "wizard mode" */
html.houston-wizard-mode,
html.houston-wizard-mode body {
  height: 100% !important;
  width: 100% !important;
  margin: 0 !important;
}

/* Hide sidebar + anything that renders the left column contents */
html.houston-wizard-mode #nav-system,
html.houston-wizard-mode .area-ct-subnav,
html.houston-wizard-mode .nav-system-menu.sidebar,
html.houston-wizard-mode .pf-v5-c-page__sidebar,
html.houston-wizard-mode .pf-v5-c-page__sidebar-body,
html.houston-wizard-mode .pf-v5-c-page__sidebar-panel,
html.houston-wizard-mode aside[role="navigation"] {
  display: none !important;
}

/* Hide top/header/masthead */
html.houston-wizard-mode .pf-v5-c-masthead,
html.houston-wizard-mode .pf-v5-c-page__header,
html.houston-wizard-mode header[role="banner"],
html.houston-wizard-mode #topnav,
html.houston-wizard-mode #main > header {
  display: none !important;
  height: 0 !important;
  min-height: 0 !important;
}

/* PatternFly: kill reserved header/side sizing variables */
html.houston-wizard-mode .pf-v5-c-page {
  --pf-v5-c-page__sidebar--Width: 0px !important;
  --pf-v5-c-page__sidebar--WidthOnXl: 0px !important;
  --pf-v5-c-page__sidebar--WidthOn2xl: 0px !important;
  --pf-v5-c-page__header--MinHeight: 0px !important;
}

/* PatternFly layout: collapse the grid so there is no left column / top row */
html.houston-wizard-mode .pf-v5-c-page {
  grid-template-areas: "main" !important;
  grid-template-columns: 1fr !important;
  grid-template-rows: 1fr !important;
}

/* Ensure main actually fills everything with no offsets */
html.houston-wizard-mode .pf-v5-c-page__main,
html.houston-wizard-mode #main,
html.houston-wizard-mode #content {
  grid-area: main !important;
  margin: 0 !important;
  padding: 0 !important;
  inset: auto !important;
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
}

/* If Cockpit uses an internal grid on #main, collapse it too */
html.houston-wizard-mode #main {
  grid-template-areas: "main" !important;
  grid-template-columns: 1fr !important;
  grid-template-rows: 1fr !important;
}

/* Bottom-left host/user dropdown */
html.houston-wizard-mode nav#hosts-sel,
html.houston-wizard-mode #hosts-sel,
html.houston-wizard-mode #host-toggle {
  display: none !important;
}

`;


let cssInstalledForNav = false;

const onWebViewDomReady = async () => {
  try {
    // Re-inject on each navigation; Electron keeps it per-page.
    cssInstalledForNav = false;
    await webview.value.insertCSS(COCKPIT_CHROME_CSS);
    await webview.value.executeJavaScript(`
  (function() {
    const p = window.location.pathname || "";
    if (p.includes("/super-simple-setup") || p.includes("/super-simple-setup-test")) {
      document.documentElement.classList.add("houston-wizard-mode");
    }
  })();
`);
    cssInstalledForNav = true;
  } catch (e) {
    console.error("insertCSS failed:", e);
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
    let finished = false;

    function done(status, extra) {
      if (finished) return;
      finished = true;
      try { if (observer) observer.disconnect(); } catch {}
      observer = null;
      resolve(Object.assign({ status }, extra || {}));
    }

    function onModulePage() {
      return window.location.pathname.includes("/super-simple-setup-test");
    }

    function setChromeMode(enabled) {
      if (!onModulePage()) return;
      const root = document.documentElement;
      root.classList.toggle("houston-wizard-mode", !!enabled);
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function waitForCockpit(timeoutMs = 20000) {
      return new Promise((resolveWait, rejectWait) => {
        const start = Date.now();
        const t = setInterval(() => {
          if (window.cockpit && typeof window.cockpit.spawn === "function") {
            clearInterval(t);
            resolveWait(true);
          } else if (Date.now() - start > timeoutMs) {
            clearInterval(t);
            rejectWait(new Error("cockpit.js not available"));
          }
        }, 50);
      });
    }

    function findLimitedAccessControl() {
      const nodes = Array.from(document.querySelectorAll("button,a,[role=button]"));
      return nodes.find(n => /limited access/i.test((n.textContent || "").trim())) || null;
    }

    function findAdminModal() {
      return (
        document.querySelector(".pf-v5-c-modal-box") ||
        document.querySelector('[role="dialog"]')
      );
    }

    function findAdminPasswordInput(modal) {
      return (
        modal.querySelector('input#switch-to-admin-access-password[type="password"]') ||
        modal.querySelector('input[type="password"]')
      );
    }

    function setNativeValue(el, value) {
      const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : el.__proto__;
      const desc =
        Object.getOwnPropertyDescriptor(proto, "value") ||
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      if (desc && desc.set) desc.set.call(el, value);
      else el.value = value;

      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function clickLimitedAccessThrottled() {
      const now = Date.now();
      if (clickLimitedAccessThrottled._next && now < clickLimitedAccessThrottled._next) return false;
      clickLimitedAccessThrottled._next = now + 1200;

      const btn = findLimitedAccessControl();
      if (!btn) return false;

      btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    }
    clickLimitedAccessThrottled._next = 0;

    const submittedForModal = new WeakSet();

    function trySubmitModalOnce(password) {
      const modal = findAdminModal();
      if (!modal) return false;
      if (submittedForModal.has(modal)) return false;

      const passInput = findAdminPasswordInput(modal);
      if (!passInput) return false;

      const buttons = Array.from(modal.querySelectorAll("button"));
      const authButton =
        modal.querySelector("button.pf-v5-c-button.pf-m-primary") ||
        buttons.find(b => /authenticate/i.test((b.textContent || "").trim())) ||
        null;

      passInput.focus();
      setNativeValue(passInput, password);

      if (authButton) {
        try { authButton.disabled = false; authButton.removeAttribute("disabled"); } catch {}
        authButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        authButton.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        authButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        submittedForModal.add(modal);
        return true;
      }

      const form = passInput.closest("form");
      if (form) {
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
        submittedForModal.add(modal);
        return true;
      }

      return false;
    }

    async function requireAdminOnce() {
      return await new Promise((resolveSpawn, rejectSpawn) => {
        cockpit.spawn(["id", "-u"], { superuser: "require" })
          .done(resolveSpawn)
          .fail(rejectSpawn);
      });
    }

    async function elevateToAdmin(password, timeoutMs = 60000) {
      if (!onModulePage()) return { ok: true, skipped: true };

      setChromeMode(true);
      await waitForCockpit();

      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        clickLimitedAccessThrottled();
        trySubmitModalOnce(password);

        try {
          await requireAdminOnce();
          setChromeMode(true);
          return { ok: true };
        } catch {
          setChromeMode(false);
        }

        await sleep(600);
      }

      setChromeMode(false);
      return { ok: false, error: "Timed out waiting for admin access" };
    }

    const globalTimeout = setTimeout(() => done("timeout"), 15000);
    function clearGlobalTimeout() { clearTimeout(globalTimeout); }

    const loginEl = document.querySelector(LOGIN_SELECTOR);

    // Already logged in
    if (!loginEl) {
      setTimeout(() => {
        clearGlobalTimeout();
        setChromeMode(true);
        elevateToAdmin("${pass}", 60000)
          .then(r => done("no-login", { admin: !!r.ok, adminError: r.error || null }))
          .catch(e => done("no-login", { admin: false, adminError: String(e && (e.message || e)) }));
      }, 300);
      return;
    }

    // Login form present
    const usernameField = document.querySelector(USER_SELECTOR);
    const passwordField = document.querySelector(PASS_SELECTOR);
    const loginButton   = document.querySelector(BUTTON_SELECTOR);
    const loginForm     = document.querySelector("form");

    if (!usernameField || !passwordField || !loginButton || !loginForm) {
      clearGlobalTimeout();
      done("no-fields");
      return;
    }

    if (onModulePage()) setChromeMode(true);

    usernameField.value = "${user}";
    passwordField.value = "${pass}";
    usernameField.dispatchEvent(new Event("input", { bubbles: true }));
    passwordField.dispatchEvent(new Event("input", { bubbles: true }));

    observer = new MutationObserver(() => {
      const loginError = document.querySelector(ERROR_SELECTOR);
      const loginStillVisible = document.querySelector(LOGIN_SELECTOR);

      if (loginError) {
        const text = (loginError.textContent || "").trim();
        const isJsWarning = /enable\\s+javascript/i.test(text);
        const isAuthError = /wrong user name|authentication failed|incorrect|invalid/i.test(text);

        if (isAuthError) {
          clearGlobalTimeout();
          done("login-failed", { message: text });
          return;
        }
        if (isJsWarning) return;
      }

      // Login form disappeared -> login succeeded
      if (!loginStillVisible) {
        setTimeout(() => {
          clearGlobalTimeout();
          setChromeMode(true);
          elevateToAdmin("${pass}", 60000)
            .then(r => done("login-success", { admin: !!r.ok, adminError: r.error || null }))
            .catch(e => done("login-success", { admin: false, adminError: String(e && (e.message || e)) }));
        }, 500);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      try {
        loginButton.click();
        loginForm.submit();
      } catch (e) {
        clearGlobalTimeout();
        done("submit-error", { message: String(e && (e.message || e)) });
      }
    }, 300);
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
    // if (isDev.value && webview.value?.openDevTools) {
      webview.value.openDevTools();
    // }
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