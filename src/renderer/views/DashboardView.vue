<template>
    <div
        class="w-screen h-screen overflow-hidden flex flex-col items-center justify-center text-default bg-default text-center">

        <!-- 🌀 SCANNING OVERLAY -->
        <div v-if="scanningNetworkForServers" class="flex flex-col items-center justify-center w-full h-full p-4">
            <p class="text-2xl text-center">Give us a few while we scan for connected servers...</p>
            <div id="spinner" class="spinner"></div>
        </div>

        <!-- 🎯 MAIN CONTENT -->
        <div v-else
            class="w-full h-full relative flex flex-col items-center justify-start text-default overflow-auto p-4">

            <h1 class="text-4xl font-bold mb-8">Dashboard</h1>

            <!-- Dashboard Cards -->
            <div class="w-full max-w-[1200px] flex flex-row justify-center items-start gap-6">
                <div class="dashboard-card">
                    <p class="text-xl font-semibold text-center">
                        Have new 45Drives Hardware?<br />
                        Click “SETUP” to have the Houston Wizard get you up and running with our best practice storage
                        architecture!
                    </p>
                    <p class="text-sm italic mt-2 text-center">
                        We will configure ZFS Pools and Samba Shares so you can use all of your drives and connect to
                        your storage over the network.
                    </p>
                    <button class="dashboard-button" @click="() => showWizard('storage')">SETUP</button>
                </div>

                <div class="dashboard-card">
                    <p class="text-xl font-semibold text-center">
                        Want to keep your data safe?<br />
                        Click “BACKUP” to open our Backup module, which allows you to backup data from this computer to
                        the server, or from this server to another.
                    </p>
                    <p class="text-sm italic mt-2 text-center">
                        You can backup from this computer to a 45Drives server, or from a 45Drives server to another
                        server, or from a 45Drives server to a cloud provider!
                    </p>
                    <button class="dashboard-button" @click="() => showWizard('backup')">BACKUP</button>
                </div>

                <div class="dashboard-card">
                    <p class="text-xl font-semibold text-center">
                        Lost data? Don’t worry, click “RESTORE” to open our Restore module, which allows you to restore
                        files from a server to this computer, or rollback snapshots on the server itself.
                    </p>
                    <p class="text-sm italic mt-2 text-center">
                        You can restore snapshots from server to server or select individual files to restore on this
                        computer. You can also restore an entire directory from a cloud backup!
                    </p>
                    <button class="dashboard-button" @click="() => showWizard('restore-backup')">RESTORE</button>
                </div>
            </div>

            <!-- Server Selector -->
            <div class="w-full max-w-[900px] mt-10 px-4 py-6 rounded-lg bg-gray-800">
                <HoustonServerListView :filterOutStorageSetupComplete="false" @serverSelected="handleServerSelected" :filter-out-non-setup-servers="false"/>
                <div class="flex justify-end gap-4 mt-4">
                    <button class="dashboard-button-sm" @click="" :disabled="!currentServer">Houston
                        UI</button>
                    <button class="dashboard-button-sm" @click="" :disabled="!currentServer">Manage
                        Server</button>
                </div>
            </div>

            <!-- Wizards -->
            <div class="w-full h-full relative flex flex-col items-center justify-center">
                <div class="w-full h-full flex items-center justify-center" v-if="currentWizard === 'storage'">
                    <StorageSetupWizard id="setup" :onComplete="onWizardComplete" />
                </div>

                <div class="w-full h-full flex items-center justify-center" v-else-if="currentWizard === 'backup'">
                    <BackUpSetupWizard id="backup" :onComplete="onWizardComplete" />
                </div>

                <div class="w-full h-full flex items-center justify-center"
                    v-else-if="currentWizard === 'restore-backup'">
                    <RestoreBackUpWizard id="restore-backup" :onComplete="onWizardComplete" />
                </div>

                <webview v-show="showWebView && !loadingWebview && !waitingForServerReboot" id="myWebview"
                    :src="currentUrl" partition="persist:authSession"
                    webpreferences="contextIsolation=true, nodeIntegration=false, enableRemoteModule=false"
                    ref="webview" @did-finish-load="onWebViewLoaded" />

                <div v-if="loadingWebview"
                    class="absolute inset-0 z-40 bg-default flex flex-col items-center justify-center">
                    <p class="text-2xl text-center">
                        <template v-if="loadingWebview">Give us a few while we login...</template>
                    </p>
                    <div id="spinner" class="spinner"></div>
                </div>

                <!-- Page curl corner effect -->
                <div v-if="!showWebView && currentWizard !== 'restore-backup'"
                    class="page-corner-effect pointer-events-none">
                </div>

                <!-- Double arrows -->
                <div v-if="!showWebView && currentWizard !== 'restore-backup'"
                    class="double-arrow absolute bottom-4 right-4 z-10 text-gray-400 text-xl animate-pulse pointer-events-none">
                    &raquo;
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref, provide, unref, watch } from 'vue';
import { useAdvancedModeState } from '../composables/useAdvancedState';
import { useDarkModeState, Notification, pushNotification, reportError, reportSuccess, useWizardSteps } from '@45drives/houston-common-ui';
import { currentWizardInjectionKey, currentServerInjectionKey, divisionCodeInjectionKey } from '../keys/injection-keys';
import type { Server, DivisionType } from '../types';
import HoustonServerListView from '../components/HoustonServerListView.vue';
import StorageSetupWizard from './storageSetupWizard/Wizard.vue';
import BackUpSetupWizard from './backupSetupWizard/Wizard.vue';
import RestoreBackUpWizard from './restoreBackupWizard/Wizard.vue';
import { IPCMessageRouterRenderer, IPCRouter } from '@45drives/houston-common-lib';

IPCRouter.initRenderer();
IPCRouter.getInstance().addEventListener("action", async (data) => {
    console.log("action in renderer: ", data);
    try {
        if (
            data === "setup_wizard_go_back" ||
            data === "show_storage_setup_wizard"
        ) {
            currentWizard.value = "storage";
            showWebView.value = false;
            openStorageSetup(null);
        } else if (data === "show_backup_setup_wizard") {
            currentWizard.value = "backup";
            showWebView.value = false;
            openStorageSetup(null);
        } else if (data === "show_restore-backup_setup_wizard") {
            currentWizard.value = "restore-backup";
            showWebView.value = false;
            openStorageSetup(null);
        } else if (data === "show_houston") {
            currentWizard.value = null;
            showWebView.value = true;

            const serverIp = currentServer.value?.ip;
            loadingWebview.value = true;
            currentUrl.value = `https://${serverIp}:9090`;
        } else if (data === "show_dashboard") {
            currentWizard.value = null;
            showWebView.value = false;
        }

        if (data.endsWith("_reboot")) {
            waitingForServerReboot.value = true;
            currentWizard.value = "backup";
            showWebView.value = false;
            await waitForServerRebootAndShowWizard();
        }

    } catch (error) {
        console.log(error)
    }
});


const currentWizard = ref<'storage' | 'backup' | 'restore-backup' | null>(null);
provide(currentWizardInjectionKey, currentWizard);

const showWizard = (type: 'storage' | 'backup' | 'restore-backup') => {
    currentWizard.value = type;
    showWebView.value = false;
};

const waitingForServerReboot = ref(false);
let rebootNotification: Notification | null = null;

const selectedServer = ref<Server | null>(null);
const handleServerSelected = async (server: Server | null) => {
    selectedServer.value = server;
};

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
        pushNotification(new Notification('Server Available', `${currentServer.value?.ip} is now accessible!`, 'success', 8000));
    }
}, {});



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
        currentWizard.value = 'backup';
        useWizardSteps("backup").reset()
        // currentWizard.value = 'storage';
        // useWizardSteps("setup").reset();
    } else {
        waitingForServerReboot.value = false;
        reportError(new Error("Server did not come back online within timeout."));
        currentWizard.value = 'storage';
        useWizardSteps("setup").reset();
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
    console.log("[Renderer] 🔔 Received notification:", message);

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

    window.electron.ipcRenderer.send("renderer-ready", {});
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
}, { deep: true, immediate: true });

// Receive the discovered servers from the main process
let discoveredServersChecked = false;
window.electron.ipcRenderer.on('discovered-servers', (_event, discoveredServers: Server[]) => {
    if (!scanningNetworkForServers.value && !discoveredServersChecked) {
        discoveredServersChecked = true;
        const anyServersNotSetup = discoveredServers.some((server) => server.status !== "complete");
        currentWizard.value = null;
        showWebView.value = false;
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

    if (isDev.value) {

        webview.value.openDevTools();
    }
}

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
.dashboard-container {
    background-color: #2b2b2b;
}

.dashboard-card {
    flex: 1;
    background-color: #1e1e1e;
    border-radius: 1rem;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    height: 100%;
    gap: 1rem;
}

.dashboard-button {
    margin-top: auto;
    background-color: #e60000;
    color: white;
    font-weight: bold;
    border-radius: 1.5rem;
    padding: 0.75rem 1.5rem;
    align-self: center;
    transition: transform 0.2s ease;
}

.dashboard-button:hover {
    transform: scale(1.05);
}

.dashboard-button-sm {
    background-color: #cc0000;
    color: white;
    font-weight: 500;
    border-radius: 1rem;
    padding: 0.5rem 1.25rem;
}

.dashboard-button-sm:disabled {
    background-color: #555;
    cursor: not-allowed;
}

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

.selected {
    @apply bg-blue-500 text-white border-blue-600;
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