<template>
    <CardContainer class="overflow-y-auto min-h-0">
        <div class="flex flex-col h-full items-stretch gap-3">
            <p class="w-full text-center text-2xl">Here are your currently scheduled backups.
                Select <b>LOCAL</b>
                <CommanderToolTip
                    :message="'Local backups are backups coming from this computer (the Client) and sent to 45Drives hardware (the Server).'" />
                or <b>REMOTE</b>
                <CommanderToolTip
                    :message="'Remote backups are backups coming from a 45Drives Server to another Server or to a Cloud Provider.'" />
                to view those backups.
            </p>

            <!-- Toggle row centered, with remote controls on the right -->
            <div class="w-full grid items-center gap-3 grid-cols-[1fr_auto_1fr]">
                <!-- right: remote-only controls -->
                <div v-if="activeTab === 'remote'" class="col-start-1 justify-self-start flex items-center gap-3">
                    <span class="text-sm text-default">
                        {{ currentServer ? `Viewing: ${currentServer.name || currentServer.ip}` : 'Select a server' }}
                    </span>
                </div>
                <!-- center: tabs -->
                <div class="col-start-2 justify-self-center">
                    <div class="inline-flex rounded-lg border border-default overflow-hidden">
                        <button class="px-4 py-2 text-sm font-medium"
                            :class="activeTab === 'local' ? 'bg-primary text-primary-foreground' : 'bg-well hover:bg-muted'"
                            @click="activeTab = 'local'">
                            LOCAL
                        </button>
                        <button class="px-4 py-2 text-sm font-medium border-l border-default"
                            :class="activeTab === 'remote' ? 'bg-primary text-primary-foreground' : 'bg-well hover:bg-muted'"
                            @click="activeTab = 'remote'">
                            REMOTE
                        </button>
                    </div>
                </div>

                <!-- right: remote-only controls -->
                <!-- <div v-if="activeTab === 'remote'" class="col-start-3 justify-self-end flex items-center gap-2">
                    <label class="text-sm">Server:</label>
                    <select v-model="selectedIp" :title="selectedIp"
                        class="input-textlike border rounded px-3 py-1 min-w-64">
                        <option value="">Select Server</option>
                        <option v-for="opt in serversForDropdown" :key="opt.ip" :value="opt.ip">
                            {{ opt.label }}
                        </option>
                    </select>
                </div> -->
                <div v-if="activeTab === 'remote'" class="col-start-3 justify-self-end flex items-center gap-2">
                    <label class="text-sm">Server:</label>
                    <select v-model="selectedIp" :title="selectedIp"
                        class="input-textlike border rounded px-3 py-1 min-w-64">
                        <option value="">Select Server</option>

                        <optgroup v-if="favoriteServers.length" label="Favorites">
                            <option v-for="opt in favoriteServers" :key="'fav-' + opt.ip" :value="opt.ip">
                                {{ opt.label }}
                            </option>
                        </optgroup>

                        <optgroup label="Discovered">
                            <option v-for="opt in serversForDropdown" :key="opt.ip" :value="opt.ip">
                                {{ opt.label }}
                            </option>
                        </optgroup>
                    </select>

                    <button class="btn btn-primary h-9 px-3" :disabled="!selectedIp" @click="openLogin">
                        Connect…
                    </button>

                    <button v-if="currentServer" class="btn btn-secondary h-9 px-3"
                        @click="cockpitRef?.logoutFromCurrentServer()" title="Clear Cockpit session & reload">
                        Log out
                    </button>

                    <button v-if="activeCredId && currentServer" class="btn btn-danger h-9 px-3" @click="forgetActive"
                        title="Remove saved credentials for this host">
                        Forget saved login
                    </button>
                </div>
            </div>

            <div v-if="activeTab === 'local'" class="overflow-hidden w-full text-left items-center justify-center">
                <div class="bg-well p-2 rounded-lg border border-default h-[64vh] flex flex-col">
                    <BackUpListView ref="backUpListRef" class="flex-1 min-h-0"
                        @backUpTaskSelected="handleBackUpTaskSelected" />
                </div>
                <div class="button-group-row w-full justify-between item-center mt-2">
                    <button class="btn btn-secondary w-64 h-10 px-5" :disabled="selectedBackUpTasks.length !== 1"
                        @click="viewSelected">View Selected Backup{{ selectedBackUpTasks.length > 1 ? 's' : ''
                        }}</button>
                    <!-- <button class="btn btn-primary w-64 h-10 px-5" :disabled="selectedBackUpTasks.length === 0"
                        @click="runSelected">Run Selected Backup{{ selectedBackUpTasks.length > 1 ? 's' : '' }} NOW
                    </button> -->
                    <button class="btn btn-primary w-64 h-10 px-5 min-w-64"
                        :disabled="selectedBackUpTasks.length === 0 || isRunningNow" @click="runSelected">
                        <template v-if="!isRunningNow">
                            Run Selected Backup{{ selectedBackUpTasks.length > 1 ? 's' : '' }} NOW
                        </template>
                        <template v-else>
                            <span class="inline-flex items-center text-center gap-2">
                                Starting…
                                <div class="justify-self-end spinner"></div>
                            </span>
                        </template>
                    </button>
                    <button class="btn btn-secondary w-64 h-10 px-5" :disabled="selectedBackUpTasks.length !== 1"
                        @click="editSelected">Edit Selected Backup{{ selectedBackUpTasks.length > 1 ? 's' : ''
                        }}</button>
                    <button class="btn btn-secondary w-64 h-10 px-5" :disabled="selectedBackUpTasks.length !== 1"
                        @click="viewSelectedLog">Check Selected Backup{{ selectedBackUpTasks.length > 1 ? "s'"
                        : "'s"
                        }} Logs</button>
                    <button class="btn btn-danger w-64 h-10 px-5" :disabled="selectedBackUpTasks.length === 0"
                        @click="deleteSelectedTasks">Cancel Selected Backup{{ selectedBackUpTasks.length > 1 ? 's' :
                        '' }}</button>
                </div>
            </div>
            <div v-else class="overflow-hidden w-full items-center justify-center ">
                <div class="bg-well p-2 rounded-lg border border-default h-[64vh] flex flex-col">
                    <div class="flex-1 min-h-0">
                        <CockpitWebview v-if="currentServer" :key="currentServer.ip" ref="cockpitRef"
                            routePath="/scheduler-test" hash="simple" wrapperClass="h-full rounded-lg"
                            heightClass="h-full" :openDevtoolsInDev="true" />
                        <div v-else class="h-full flex flex-col items-center justify-center text-default">
                            <span>
                                Select a server to load the remote backup scheduler.
                            </span>
                            <div class="col-start-3 justify-self-end flex items-center gap-3">
                                <select v-model="selectedIp" :title="selectedIp"
                                    class="input-textlike border rounded px-3 py-1 min-w-72 text-left">
                                    <option value="">Select Server</option>
                                    <option v-for="opt in serversForDropdown" :key="opt.ip" :value="opt.ip">
                                        {{ opt.label }}
                                    </option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <template #footer>
            <div class="button-group-row w-full justify-start">
                <button @click="proceedToPreviousStep" class="btn btn-secondary w-40 h-20">Back</button>
            </div>
        </template>
    </CardContainer>
    <ServerLoginModal :open="loginOpen" :host="selectedIp || null" :displayName="selectedOptionLabel"
        :presetUsername="prefillUsername" @cancel="closeLogin" @submit="onLoginSubmit" />
</template>

<script setup lang="ts">
import { BackUpTask, IPCRouter } from '@45drives/houston-common-lib';
import CardContainer from '../../components/CardContainer.vue';
import CockpitWebview from '../../components/CockpitWebview.vue';
import ServerLoginModal from './ServerLoginModal.vue';
import { useWizardSteps, useEnterToAdvance } from '@45drives/houston-common-ui';
import BackUpListView from './BackUpListView.vue';
import { computed, inject, Ref, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { currentServerInjectionKey, discoveryStateInjectionKey, reviewBackUpSetupKey } from '../../keys/injection-keys';
import { useRouter } from 'vue-router';
import { useHeader } from '../../composables/useHeader';
import CommanderToolTip from '../../components/commander/CommanderToolTip.vue';
import { DiscoveryState, type Server as ServerType } from '../../types';

useHeader('Manage Your Backups');

const reviewBackup = inject(reviewBackUpSetupKey);
const router = useRouter();
const selectedBackUpTasks = ref<BackUpTask[]>([]);
const activeTab = ref<'local' | 'remote'>('local');

const handleBackUpTaskSelected = (tasks: BackUpTask[]) => {
    selectedBackUpTasks.value = tasks;
    if (reviewBackup) reviewBackup.tasks = tasks;
};

const backUpListRef = ref<InstanceType<typeof BackUpListView> | null>(null);

const currentServer = inject<Ref<ServerType | null>>(currentServerInjectionKey, ref(null) as any)
const discoveryState = inject<DiscoveryState>(discoveryStateInjectionKey)!
const selectedIp = ref<string>('')
const serversForDropdown = computed(() =>
    discoveryState.servers.map(s => ({
        ip: s.ip,
        label: s.name && s.name !== s.ip ? `${s.name} (${s.ip})` : s.ip
    }))
)

// Reference to the Cockpit view to call logout()
const cockpitRef = ref<InstanceType<typeof CockpitWebview> | null>(null);

// Saved creds metadata (from keychain-backed DB in main)
type SavedServer = { id: string; host: string; name?: string; username: string; favorite?: boolean; lastUsedAt?: number };
const savedServers = ref<SavedServer[]>([]);
const activeCredId = ref<string | null>(null);

// Modal control + UX helpers
const loginOpen = ref(false);
const prefillUsername = ref<string | null>(null);

const selectedOptionLabel = computed(() => {
    const ip = selectedIp.value;
    if (!ip) return '';
    const fav = savedServers.value.find(s => s.host === ip && s.favorite);
    if (fav) return `${fav.name || ip} (${fav.username})`;
    const disc = serversForDropdown.value.find(o => o.ip === ip);
    return disc?.label || ip;
});

const favoriteServers = computed(() =>
    savedServers.value
        .filter(s => s.favorite)
        .map(s => ({ ip: s.host, label: `${s.name || s.host} (${s.username})` }))
);

async function loadSavedServers() {
    savedServers.value = await window.electron?.ipcRenderer.invoke('cred:list-servers') ?? [];
}
onMounted(loadSavedServers);

function openLogin() {
  // If we already have saved creds for this host, skip modal and connect now
  maybeAutoConnect(true /*forceModalIfNoSaved*/);
}

function closeLogin() {
  loginOpen.value = false;
}

function sendCredsToWebview(ip: string, username: string, password: string) {
  window.electron?.ipcRenderer.send('store-manual-creds', { ip, username, password });
}

// Called when the modal form is submitted
async function onLoginSubmit({ username, password, remember }:
  { username: string; password: string; remember: boolean }) {
  const ip = selectedIp.value!;
  if (remember) {
    const res = await window.electron?.ipcRenderer.invoke('cred:save', {
      host: ip, username, password, favorite: true,
    });
    activeCredId.value = res?.id ?? null;
    await loadSavedServers();
  }

  sendCredsToWebview(ip, username, password);

  // Set the currentServer so webview mounts
  const srv = discoveryState.servers.find(s => s.ip === ip) || null;
  if (srv) currentServer!.value = srv;

  // Close modal and scrub (modal component already scrubs password)
  prefillUsername.value = null;
  loginOpen.value = false;

  // Optional: mark last-used
  if (activeCredId.value) window.electron?.ipcRenderer.invoke('cred:touch', activeCredId.value);
}

// “Forget saved login” button
async function forgetActive() {
  if (!activeCredId.value) return;
  await window.electron?.ipcRenderer.invoke('cred:remove', activeCredId.value);
  activeCredId.value = null;
  await loadSavedServers();
  // also clear session
  cockpitRef.value?.logoutFromCurrentServer();
}

async function maybeAutoConnect(forceModalIfNoSaved = false) {
    const ip = selectedIp.value;
    if (!ip) return;

    const saved = await window.electron?.ipcRenderer.invoke('cred:get-for', ip);
    if (saved?.username && saved?.password) {
        activeCredId.value = saved.id;
        sendCredsToWebview(ip, saved.username, saved.password);
        const srv = discoveryState.servers.find(s => s.ip === ip) || null;
        if (srv) currentServer!.value = srv;
        return; // done
    }

    // No saved creds — show modal
    prefillUsername.value = null; // or remember last entered name if you want
    if (forceModalIfNoSaved) loginOpen.value = true;
}

watch(selectedIp, async (ip) => {
    activeCredId.value = null;
    if (!ip) return;

    // If a favorite exists, auto-connect immediately
    const fav = savedServers.value.find(s => s.host === ip && s.favorite);
    if (fav) {
        const saved = await window.electron?.ipcRenderer.invoke('cred:get-for', ip);
        if (saved?.username && saved?.password) {
            activeCredId.value = saved.id;
            sendCredsToWebview(ip, saved.username, saved.password);
            const srv = discoveryState.servers.find(s => s.ip === ip) || null;
            if (srv) currentServer!.value = srv;
            // Don’t open modal
            return;
        }
    }

    // Otherwise, wait for user to click “Connect…”
});




watch(serversForDropdown, (list) => {
    // If no servers, or the currently selected IP disappeared, reset to empty
    if (!list.length || (selectedIp.value && !list.some(x => x.ip === selectedIp.value))) {
        selectedIp.value = ''
        if (currentServer) currentServer.value = null
    }
}, { immediate: true })


watch(selectedIp, (ip) => {
    const srv = discoveryState.servers.find(s => s.ip === ip) || null
    if (srv) {
        currentServer!.value = srv
        // If you cache credentials per-IP, you can also emit 'store-manual-creds' here.
    }
})


const deleteSelectedTasks = () => {
    backUpListRef.value?.deleteSelectedTasks?.();
};

// function runSelected() {
//     backUpListRef.value?.runSelectedNow?.();
// }
async function runSelected() {
    if (selectedBackUpTasks.value.length === 0 || isRunningNow.value) return;

    isRunningNow.value = true;
    runningTaskIds.value = selectedBackUpTasks.value.map(t => t.uuid);
    runningTaskNames.value = selectedBackUpTasks.value.map(t => (t.description || '').trim());

    // fallback, just in case no event ever comes
    if (clearSpinnerTimer) window.clearTimeout(clearSpinnerTimer);
    clearSpinnerTimer = window.setTimeout(stopRunningUi, 20000);

    try {
        await backUpListRef.value?.runSelectedNow?.();
    } catch {
        stopRunningUi();
    }
}

function maybeClearFromNotification(message: string) {
    if (!isRunningNow.value) return;
    const m = message.match(/Backup task "(.+?)"/i);
    if (m && runningTaskNames.value.includes(m[1].trim())) {
        stopRunningUi();
        IPCRouter.getInstance().send('backend', 'action',
            JSON.stringify({ type: 'fetchBackupEvents' })
        );
    }
}



// function editSelected() {
//     backUpListRef.value?.editSelectedSchedules?.();
// }

function editSelected() {
    const ids = selectedBackUpTasks.value.map(t => t.uuid).join(',');
    router.push({ name: 'backups-bulk-edit', query: { ids } });
}


function viewSelected() {
    // Reuse your wizard flow; this just triggers the same next step action
    // proceedToNextStep();
}

function viewSelectedLog() {
    // Reuse your wizard flow; this just triggers the same next step action
    // proceedToNextStep();
    backUpListRef.value?.editSelectedSchedules?.();
}

const { completeCurrentStep, unCompleteCurrentStep, prevStep } = useWizardSteps('backup-root');

const proceedToNextStep = async () => {
    if (selectedBackUpTasks.value.length < 1) throw new Error('Select at least one backup task to proceed');
    unCompleteCurrentStep();
    completeCurrentStep(true, selectedBackUpTasks.value);
};

const proceedToPreviousStep = async () => { 
    // goBackStep();
    prevStep();
 };

useEnterToAdvance(() => { }, 300, () => { }, () => { proceedToPreviousStep(); });

const goBackStep = () => { router.push({ name: 'dashboard' }); };

const isRunningNow = ref(false);
const runningTaskIds = ref<string[]>([]);
const runningTaskNames = ref<string[]>([]);   // NEW
let clearSpinnerTimer: number | null = null;

function stopRunningUi() {
    isRunningNow.value = false;
    runningTaskIds.value = [];
    runningTaskNames.value = [];
    if (clearSpinnerTimer) { window.clearTimeout(clearSpinnerTimer); clearSpinnerTimer = null; }
}

// listen for the “done/updated” message from main.ts
const actionHandler = (raw: string) => {
    try {
        const msg = JSON.parse(raw);

        if (msg?.type === 'notification' && msg.message) {
            maybeClearFromNotification(msg.message); 
        }


        if (msg?.type === 'backUpStatusesUpdated') {
            const containsRanTask = (msg.tasks || []).some((t: any) =>
                runningTaskIds.value.includes(t.uuid)
            );
            if (containsRanTask) stopRunningUi();
        }
    } catch { }
};


onMounted(() => {
    IPCRouter.getInstance().addEventListener('action', actionHandler);
});

onBeforeUnmount(() => {
    try { IPCRouter.getInstance().removeEventListener?.('action', actionHandler); } catch { }
});
</script>

<style scoped>
.spinner {
    width: 1.25rem;
    /* 20px */
    height: 1.25rem;
    border: 2px solid rgba(0, 0, 0, 0.15);
    border-left-color: #2c3e50;
    border-radius: 9999px;
    animation: spin 1s linear infinite;
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
