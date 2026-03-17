<template>
    <div class="h-full flex flex-col min-h-0 overflow-hidden p-4">
        <!-- Tab bar + actions header -->
        <div class="relative flex items-center justify-between mb-4 shrink-0 h-10">
            <!-- Back to Dashboard -->
            <div class="flex items-center min-w-0">
                <button class="btn btn-secondary text-sm h-8 flex items-center gap-1.5" @click="router.push({ name: 'dashboard' })">
                    <ArrowLeftIcon class="w-4 h-4" />
                    Dashboard
                </button>
            </div>

            <!-- Centered tab toggle -->
            <div class="absolute left-1/2 -translate-x-1/2 inline-flex rounded-lg border border-default overflow-hidden">
                <button class="px-5 py-2 text-sm font-medium flex items-center gap-2 transition-colors"
                    :class="activeTab === 'local' ? 'bg-primary text-primary-foreground' : 'bg-well hover:bg-accent text-default'"
                    @click="activeTab = 'local'">
                    <ComputerDesktopIcon class="w-4 h-4" />
                    Local Backups
                </button>
                <button class="px-5 py-2 text-sm font-medium border-l border-default flex items-center gap-2 transition-colors"
                    :class="activeTab === 'remote' ? 'bg-primary text-primary-foreground' : 'bg-well hover:bg-accent text-default'"
                    @click="activeTab = 'remote'">
                    <GlobeAltIcon class="w-4 h-4" />
                    Remote Backups
                </button>
            </div>

            <!-- Right side actions -->
            <div class="flex items-center gap-2 justify-end min-w-0">
                <template v-if="activeTab === 'remote'">
                    <select v-model="selectedIp" :title="selectedIp"
                        class="input-textlike border border-default rounded-lg px-3 py-1.5 min-w-56 text-sm">
                        <option value="">Select Server…</option>
                        <optgroup v-if="favoriteServers.length" label="Favorites">
                            <option v-for="opt in favoriteServers" :key="'fav-' + opt.ip" :value="opt.ip">{{ opt.label }}</option>
                        </optgroup>
                        <optgroup label="Discovered">
                            <option v-for="opt in serversForDropdown" :key="opt.ip" :value="opt.ip">{{ opt.label }}</option>
                        </optgroup>
                    </select>
                    <button class="btn btn-primary text-sm h-8" :disabled="!selectedIp" @click="openLogin">Connect</button>
                    <button v-if="currentServer" class="btn btn-secondary text-sm h-8"
                        @click="cockpitRef?.logoutFromCurrentServer()">Log out</button>
                    <button v-if="activeCredId && currentServer" class="btn btn-danger text-sm h-8"
                        @click="forgetActive">Forget</button>
                </template>
                <template v-else>
                    <button class="btn btn-primary text-sm h-8 flex items-center gap-1.5" @click="newBackupTask">
                        <PlusIcon class="w-4 h-4" />
                        New Backup
                    </button>
                </template>
            </div>
        </div>

        <!-- LOCAL tab content -->
        <div v-if="activeTab === 'local'" class="flex-1 min-h-0 flex flex-col">
            <div class="flex-1 min-h-0 bg-well rounded-lg border border-default overflow-hidden">
                <BackUpListView ref="backUpListRef" class="h-full"
                    @backUpTaskSelected="handleBackUpTaskSelected" />
            </div>

            <!-- Contextual action toolbar (appears when tasks selected) -->
            <div v-if="selectedBackUpTasks.length > 0"
                class="mt-3 flex items-center gap-2 p-3 bg-accent rounded-lg border border-default shrink-0">
                <span class="text-sm text-muted mr-2">
                    {{ selectedBackUpTasks.length }} selected
                </span>

                <button class="btn btn-primary text-sm h-8 flex items-center gap-1.5"
                    :disabled="isRunningNow" @click="runSelected">
                    <PlayIcon class="w-4 h-4" />
                    <template v-if="!isRunningNow">Run Now</template>
                    <template v-else>Starting…</template>
                </button>

                <button class="btn btn-secondary text-sm h-8 flex items-center gap-1.5"
                    :disabled="selectedBackUpTasks.length !== 1" @click="viewSelected">
                    <EyeIcon class="w-4 h-4" />
                    View
                </button>

                <button class="btn btn-secondary text-sm h-8 flex items-center gap-1.5"
                    :disabled="selectedBackUpTasks.length !== 1" @click="editSelected">
                    <PencilSquareIcon class="w-4 h-4" />
                    Edit Schedule
                </button>

                <button class="btn btn-secondary text-sm h-8 flex items-center gap-1.5"
                    :disabled="selectedBackUpTasks.length !== 1" @click="viewSelectedLog">
                    <DocumentTextIcon class="w-4 h-4" />
                    Logs
                </button>

                <div class="flex-1" />

                <button class="btn btn-danger text-sm h-8 flex items-center gap-1.5"
                    @click="deleteSelectedTasks">
                    <TrashIcon class="w-4 h-4" />
                    Delete
                </button>
            </div>
        </div>

        <!-- REMOTE tab content -->
        <div v-else class="flex-1 min-h-0 bg-well rounded-lg border border-default overflow-hidden">
            <CockpitWebview v-if="currentServer" :key="currentServer.ip" ref="cockpitRef"
                routePath="/scheduler-test" hash="simple" wrapperClass="h-full rounded-lg"
                heightClass="h-full" :openDevtoolsInDev="true" class="p-2"/>
            <div v-else class="h-full flex flex-col items-center justify-center text-muted gap-4">
                <GlobeAltIcon class="w-12 h-12 opacity-30" />
                <p>Select a server above to view remote backups.</p>
            </div>
        </div>
    </div>

    <ServerLoginModal :open="loginOpen" :host="selectedIp || null" :displayName="selectedOptionLabel"
        :presetUsername="prefillUsername" @cancel="closeLogin" @submit="onLoginSubmit" />
</template>

<script setup lang="ts">
import { BackUpTask, IPCRouter } from '@45drives/houston-common-lib';
import CockpitWebview from '../../components/CockpitWebview.vue';
import ServerLoginModal from './ServerLoginModal.vue';
import { useEnterToAdvance } from '@45drives/houston-common-ui';
import BackUpListView from './BackUpListView.vue';
import { computed, inject, Ref, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { currentServerInjectionKey, discoveryStateInjectionKey, reviewBackUpSetupKey } from '../../keys/injection-keys';
import { useRouter } from 'vue-router';
import { useHeader } from '../../composables/useHeader';
import { useLogModal } from '../../composables/useLogModal';
import { DiscoveryState, type Server as ServerType } from '../../types';
import {
    ComputerDesktopIcon, GlobeAltIcon, PlusIcon, PlayIcon,
    EyeIcon, PencilSquareIcon, DocumentTextIcon, TrashIcon,
    ArrowLeftIcon
} from '@heroicons/vue/24/outline';

useHeader('Backup Manager');

const { openLogModal } = useLogModal();
const reviewBackup = inject(reviewBackUpSetupKey);
const router = useRouter();
const selectedBackUpTasks = ref<BackUpTask[]>([]);
const activeTab = ref<'local' | 'remote'>('local');

const handleBackUpTaskSelected = (tasks: BackUpTask[]) => {
    selectedBackUpTasks.value = tasks;
    if (reviewBackup) reviewBackup.tasks = tasks;
};

const backUpListRef = ref<InstanceType<typeof BackUpListView> | null>(null);

const currentServer = inject<Ref<ServerType | null>>(currentServerInjectionKey, ref<ServerType | null>(null))
const discoveryState = inject<DiscoveryState>(discoveryStateInjectionKey)!
const selectedIp = ref<string>('')
const serversForDropdown = computed(() =>
    discoveryState.servers.map(s => ({
        ip: s.ip,
        label: s.name && s.name !== s.ip ? `${s.name} (${s.ip})` : s.ip
    }))
)

const cockpitRef = ref<InstanceType<typeof CockpitWebview> | null>(null);

type SavedServer = { id: string; host: string; name?: string; username: string; favorite?: boolean; lastUsedAt?: number };
const savedServers = ref<SavedServer[]>([]);
const activeCredId = ref<string | null>(null);

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
    maybeAutoConnect(true);
}

function closeLogin() {
    loginOpen.value = false;
}

function sendCredsToWebview(ip: string, username: string, password: string) {
    window.electron?.ipcRenderer.send('store-manual-creds', { ip, username, password });
}

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
    const srv = discoveryState.servers.find(s => s.ip === ip) || null;
    if (srv) currentServer!.value = srv;
    prefillUsername.value = null;
    loginOpen.value = false;
    if (activeCredId.value) window.electron?.ipcRenderer.invoke('cred:touch', activeCredId.value);
}

async function forgetActive() {
    if (!activeCredId.value) return;
    await window.electron?.ipcRenderer.invoke('cred:remove', activeCredId.value);
    activeCredId.value = null;
    await loadSavedServers();
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
        return;
    }
    prefillUsername.value = null;
    if (forceModalIfNoSaved) loginOpen.value = true;
}

watch(selectedIp, async (ip) => {
    activeCredId.value = null;
    if (!ip) return;
    const fav = savedServers.value.find(s => s.host === ip && s.favorite);
    if (fav) {
        const saved = await window.electron?.ipcRenderer.invoke('cred:get-for', ip);
        if (saved?.username && saved?.password) {
            activeCredId.value = saved.id;
            sendCredsToWebview(ip, saved.username, saved.password);
            const srv = discoveryState.servers.find(s => s.ip === ip) || null;
            if (srv) currentServer!.value = srv;
            return;
        }
    }
});

watch(serversForDropdown, (list) => {
    if (!list.length || (selectedIp.value && !list.some(x => x.ip === selectedIp.value))) {
        selectedIp.value = ''
        if (currentServer) currentServer.value = null
    }
}, { immediate: true })

function newBackupTask() {
    router.push({ name: 'create-new-backup' });
}

const deleteSelectedTasks = () => {
    backUpListRef.value?.deleteSelectedTasks?.();
};

async function runSelected() {
    if (selectedBackUpTasks.value.length === 0 || isRunningNow.value) return;
    isRunningNow.value = true;
    runningTaskIds.value = selectedBackUpTasks.value.map(t => t.uuid);
    runningTaskNames.value = selectedBackUpTasks.value.map(t => (t.description || '').trim());
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

function editSelected() {
    backUpListRef.value?.editSelectedSchedules?.();
}

function viewSelected() {
    const ids = selectedBackUpTasks.value.map(t => t.uuid).join(',');
    router.push({ name: 'view-selected-backups', query: { ids } });
}

function viewSelectedLog() {
    if (selectedBackUpTasks.value.length !== 1) return;
    const task = selectedBackUpTasks.value[0];
    openLogModal({ uuid: task.uuid, description: task.description || task.target || task.uuid });
}

const isRunningNow = ref(false);
const runningTaskIds = ref<string[]>([]);
const runningTaskNames = ref<string[]>([]);
let clearSpinnerTimer: number | null = null;

function stopRunningUi() {
    isRunningNow.value = false;
    runningTaskIds.value = [];
    runningTaskNames.value = [];
    if (clearSpinnerTimer) { window.clearTimeout(clearSpinnerTimer); clearSpinnerTimer = null; }
}

const actionHandler = (raw: string) => {
    try {
        const msg = JSON.parse(raw);
        if (msg?.type === 'notification' && msg.message) {
            maybeClearFromNotification(msg.message);
        }
        if (msg?.type === 'backUpStatusesUpdated') {
            const containsRanTask = (msg.tasks || []).some((t: { uuid: string }) =>
                runningTaskIds.value.includes(t.uuid)
            );
            if (containsRanTask) stopRunningUi();
        }
    } catch (e) { console.debug('actionHandler parse error:', e); }
};

onMounted(() => {
    IPCRouter.getInstance().addEventListener('action', actionHandler);
});

onBeforeUnmount(() => {
    try { IPCRouter.getInstance().removeEventListener?.('action', actionHandler); } catch { }
});
</script>
