<template>
    <div class="h-full flex flex-col min-h-0 overflow-hidden p-4">
        <!-- Tab bar + actions header -->
        <div class="flex flex-wrap items-center gap-3 mb-4 shrink-0">
            <!-- Left-aligned group -->
            <button class="btn btn-secondary text-sm h-fit flex items-center gap-1.5 shrink-0" @click="router.push({ name: 'dashboard' })">
                <ArrowLeftIcon class="w-4 h-4" />
                Dashboard
            </button>

            <div class="inline-flex rounded-lg border border-default overflow-hidden shrink-0">
                <button class="px-3 sm:px-5 py-1.5 sm:py-2 text-sm font-medium flex items-center gap-2 transition-colors"
                    :class="activeTab === 'local' ? 'bg-accent text-default shadow-[inset_0_-2px_0_var(--btn-primary-bg)]' : 'bg-well hover:bg-accent text-muted'"
                    @click="activeTab = 'local'; showRestoreView = false">
                    <ComputerDesktopIcon class="w-4 h-4" />
                    Local Backups
                </button>
                <button class="px-3 sm:px-5 py-1.5 sm:py-2 text-sm font-medium border-l border-default flex items-center gap-2 transition-colors"
                    :class="activeTab === 'remote' ? 'bg-accent text-default shadow-[inset_0_-2px_0_var(--btn-primary-bg)]' : 'bg-well hover:bg-accent text-muted'"
                    @click="activeTab = 'remote'">
                    <GlobeAltIcon class="w-4 h-4" />
                    Remote Backups
                </button>
            </div>

            <!-- Remote: server dropdown + action buttons (left-aligned) -->
            <template v-if="activeTab === 'remote'">
                <select v-model="selectedIp" :title="selectedIp"
                    class="input-textlike border border-default rounded-lg px-3 py-1.5 text-sm min-w-0 max-w-full sm:max-w-56 truncate">
                    <option value="">Select Server…</option>
                    <optgroup v-if="favoriteServers.length" label="Favorites">
                        <option v-for="opt in favoriteServers" :key="'fav-' + opt.ip" :value="opt.ip">{{ opt.label }}</option>
                    </optgroup>
                    <optgroup label="Discovered">
                        <option v-for="opt in serversForDropdown" :key="opt.ip" :value="opt.ip">{{ opt.label }}</option>
                    </optgroup>
                </select>
                <button class="btn btn-primary text-sm h-fit" :disabled="!selectedIp" @click="openLogin">Connect</button>
                <button v-if="currentServer" class="btn btn-secondary text-sm h-fit"
                    @click="showRestoreView ? disconnectRestore() : cockpitRef?.logoutFromCurrentServer()">Log out</button>
                <button v-if="activeCredId && currentServer" class="btn btn-danger text-sm h-fit"
                    @click="forgetActive">Forget</button>
            </template>

            <!-- Spacer pushes right-side items to far right -->
            <div class="flex-1" />

            <!-- Right-aligned group -->
            <template v-if="activeTab === 'remote'">
                <button class="btn text-sm h-fit flex items-center gap-1.5"
                    :class="showRestoreView ? 'btn-secondary' : 'btn-primary'" :disabled="!restoreConnected"
                    @click="showRestoreView = !showRestoreView">
                    <template v-if="showRestoreView">
                        <ArrowLeftIcon class="w-4 h-fit" />
                        Return to Backups
                    </template>
                    <template v-else>
                        <ArrowDownTrayIcon class="w-4 h-fit" />
                        Restore
                    </template>
                </button>
            </template>
            <template v-else>
                <button class="btn btn-primary text-sm h-fit flex items-center gap-1.5" @click="newBackupTask">
                    <PlusIcon class="w-4 h-fit" />
                    New Backup
                </button>
            </template>

            <button class="btn btn-secondary text-sm h-fit p-1.5" title="Settings" @click="settingsOpen = true">
                <Cog6ToothIcon class="w-5 h-5" />
            </button>
        </div>

        <!-- LOCAL tab content -->
        <div v-if="activeTab === 'local'" class="flex-1 min-h-0 flex flex-col">
            <div class="flex-1 min-h-0 bg-well rounded-lg border border-default overflow-hidden bg-default">
                <BackUpListView ref="backUpListRef" class="h-full"
                    :selectedCount="selectedBackUpTasks.length"
                    :isRunningNow="isRunningNow"
                    :runningTaskIds="runningTaskIds"
                    @backUpTaskSelected="handleBackUpTaskSelected"
                    @run="runSelected"
                    @view="viewSelected"
                    @edit="editSelected"
                    @viewLog="viewSelectedLog"
                    @delete="deleteSelectedTasks" />
            </div>

            <!-- Bottom progress panel (visible while any backup is in progress) -->
            <div v-if="runningTaskCount > 0"
                class="mt-3 bg-accent rounded-lg border border-default shrink-0 flex flex-col">
                <div class="px-3 pt-3 pb-1.5 text-xs font-semibold text-muted uppercase tracking-wide">
                    {{ runningTaskCount }} backup{{ runningTaskCount > 1 ? 's' : '' }} in progress
                </div>
                <div class="overflow-y-auto max-h-[220px] px-3 pb-3 space-y-2">
                    <div v-for="(info, uuid) in taskProgressMap" :key="uuid"
                        class="flex items-center gap-3 py-1.5">
                        <span class="text-sm font-medium text-default truncate min-w-[120px] max-w-[240px]"
                            :title="info.name">{{ info.name }}</span>
                        <div class="flex-1 h-2.5 bg-default rounded-full overflow-hidden">
                            <div v-if="info.percent != null"
                                class="h-full bg-primary rounded-full transition-all duration-300"
                                :style="{ width: info.percent + '%' }" />
                            <div v-else
                                class="h-full bg-primary rounded-full animate-pulse w-full" />
                        </div>
                        <span class="text-sm text-muted whitespace-nowrap min-w-[80px] text-right">
                            {{ info.percent != null ? info.percent + '%' : info.message || 'Working…' }}
                        </span>
                        <button class="text-muted hover:text-default ml-1 shrink-0" title="Dismiss"
                            @click="removeFinishedTask(uuid as string)">
                            <XMarkIcon class="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- REMOTE tab content -->
        <div v-else-if="activeTab === 'remote'" class="flex-1 min-h-0 bg-well rounded-lg border border-default overflow-hidden">
            <!-- Restore view (toggled via Restore button) -->
            <RestoreBrowser v-if="showRestoreView && restoreConnected && restoreUsername"
                :serverIp="selectedIp" :username="restoreUsername" />

            <!-- Scheduler webview (default remote view) -->
            <CockpitWebview v-else-if="currentServer && !showRestoreView" :key="currentServer.ip" ref="cockpitRef"
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

    <SettingsModal :open="settingsOpen" @close="settingsOpen = false" @saved="onSettingsSaved"
        @serversChanged="loadSavedServers" />
</template>

<script setup lang="ts">
import { BackUpTask, IPCRouter } from '@45drives/houston-common-lib';
import CockpitWebview from '../../components/CockpitWebview.vue';
import RestoreBrowser from './RestoreBrowser.vue';
import ServerLoginModal from './ServerLoginModal.vue';
import SettingsModal from './SettingsModal.vue';
import { useEnterToAdvance } from '@45drives/houston-common-ui';
import BackUpListView from './BackUpListView.vue';
import { computed, inject, Ref, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { currentServerInjectionKey, discoveryStateInjectionKey, reviewBackUpSetupKey } from '../../keys/injection-keys';
import { useRouter } from 'vue-router';
import { useHeader } from '../../composables/useHeader';
import { useLogModal } from '../../composables/useLogModal';
import { DiscoveryState, type Server as ServerType } from '../../types';
import { useSettings } from '../../composables/useSettings';
import {
    ComputerDesktopIcon, GlobeAltIcon, PlusIcon,
    ArrowLeftIcon, ArrowDownTrayIcon, Cog6ToothIcon, XMarkIcon
} from '@heroicons/vue/24/outline';

useHeader('Backup Manager');

const { openLogModal } = useLogModal();
const reviewBackup = inject(reviewBackUpSetupKey);
const router = useRouter();
const selectedBackUpTasks = ref<BackUpTask[]>([]);
const activeTab = ref<'local' | 'remote'>('local');
const settingsOpen = ref(false);
const { settings } = useSettings();

// ── Restore view state (within Remote tab) ─────────────────────────────────
const showRestoreView = ref(false);
const restoreConnected = ref(false);
const restoreUsername = ref('');

function disconnectRestore() {
    showRestoreView.value = false;
    restoreConnected.value = false;
    restoreUsername.value = '';
    if (currentServer) currentServer.value = null;
}

const handleBackUpTaskSelected = (tasks: BackUpTask[]) => {
    selectedBackUpTasks.value = tasks;
    if (reviewBackup) reviewBackup.tasks = tasks;
};

const backUpListRef = ref<InstanceType<typeof BackUpListView> | null>(null);

const currentServer = inject<Ref<ServerType | null>>(currentServerInjectionKey, ref<ServerType | null>(null))
const discoveryState = inject<DiscoveryState>(discoveryStateInjectionKey)!
const selectedIp = ref<string>('')
const serversForDropdown = computed(() => {
    const fmt = settings.value?.serverDisplayFormat ?? 'both';
    return discoveryState.servers
        .filter(s => s.setupComplete === true)
        .map(s => {
            const hasName = s.name && s.name !== s.ip;
            let label: string;
            if (fmt === 'ip') label = s.ip;
            else if (fmt === 'hostname' && hasName) label = s.name;
            else label = hasName ? `${s.name} (${s.ip})` : s.ip;
            return { ip: s.ip, label };
        });
})

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

const favoriteServers = computed(() => {
    const fmt = settings.value?.serverDisplayFormat ?? 'both';
    return savedServers.value
        .filter(s => s.favorite)
        .map(s => {
            let label: string;
            if (fmt === 'ip') label = `${s.host} (${s.username})`;
            else if (fmt === 'hostname' && s.name) label = `${s.name} (${s.username})`;
            else label = `${s.name || s.host} (${s.username})`;
            return { ip: s.host, label };
        });
});

async function loadSavedServers() {
    savedServers.value = await window.electron?.ipcRenderer.invoke('cred:list-servers') ?? [];
}
onMounted(loadSavedServers);

async function onSettingsSaved() {
    // Reload server list in case names/favorites changed
    await loadSavedServers();
}

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
    // For the remote tab, send creds to webview for cockpit login
    if (activeTab.value === 'remote') {
        sendCredsToWebview(ip, username, password);
        // Also enable restore (lives inside remote tab)
        restoreUsername.value = username;
        restoreConnected.value = true;
    }
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
        if (activeTab.value === 'remote') {
            sendCredsToWebview(ip, saved.username, saved.password);
            restoreUsername.value = saved.username;
            restoreConnected.value = true;
        }
        const srv = discoveryState.servers.find(s => s.ip === ip) || null;
        if (srv) currentServer!.value = srv;
        return;
    }
    prefillUsername.value = null;
    if (forceModalIfNoSaved) loginOpen.value = true;
}

watch(selectedIp, async (ip) => {
    activeCredId.value = null;
    restoreConnected.value = false;
    restoreUsername.value = '';
    showRestoreView.value = false;
    if (!ip) return;
    const fav = savedServers.value.find(s => s.host === ip && s.favorite);
    if (fav && settings.value?.autoConnectFavorites !== false) {
        const saved = await window.electron?.ipcRenderer.invoke('cred:get-for', ip);
        if (saved?.username && saved?.password) {
            activeCredId.value = saved.id;
            if (activeTab.value === 'remote') {
                sendCredsToWebview(ip, saved.username, saved.password);
                restoreUsername.value = saved.username;
                restoreConnected.value = true;
            }
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
    // Clear progress entries for tasks being deleted
    for (const t of selectedBackUpTasks.value) {
        removeFinishedTask(t.uuid);
    }
    backUpListRef.value?.deleteSelectedTasks?.();
};

async function runSelected() {
    if (selectedBackUpTasks.value.length === 0 || isRunningNow.value) return;
    isRunningNow.value = true;
    runningTaskIds.value = selectedBackUpTasks.value.map(t => t.uuid);
    runningTaskNames.value = selectedBackUpTasks.value.map(t => (t.description || '').trim());
    // Seed per-task progress entries
    for (const t of selectedBackUpTasks.value) {
        const name = t.name || t.description || t.source?.split('/').pop() || t.uuid.slice(0, 8);
        taskProgressMap.value[t.uuid] = { name, percent: null, message: 'Starting…' };
    }
    try {
        await backUpListRef.value?.runSelectedNow?.();
    } catch {
        stopRunningUi();
    }
}

function maybeClearFromNotification(message: string) {
    if (!isRunningNow.value) return;
    const m = message.match(/Backup task "(.+?)"/i);
    if (m) {
        const name = m[1].trim();
        // Find and remove the matching task by description
        const matchUuid = Object.entries(taskProgressMap.value)
            .find(([, info]) => info.name === name)?.[0]
            ?? runningTaskIds.value.find((id, i) => runningTaskNames.value[i] === name);
        if (matchUuid) {
            removeFinishedTask(matchUuid);
        }
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
    if (selectedBackUpTasks.value.length < 1) return;
    const tasks = selectedBackUpTasks.value.map(t => ({
        uuid: t.uuid,
        description: t.description || t.target || t.uuid,
    }));
    openLogModal(tasks);
}

const isRunningNow = ref(false);
const runningTaskIds = ref<string[]>([]);
const runningTaskNames = ref<string[]>([]);

// ── Per-task progress tracking ──────────────────────────────────────────────
const taskProgressMap = ref<Record<string, { name: string; percent: number | null; message: string }>>({});
const runningTaskCount = computed(() => Object.keys(taskProgressMap.value).length);

function stopRunningUi() {
    isRunningNow.value = false;
    runningTaskIds.value = [];
    runningTaskNames.value = [];
    taskProgressMap.value = {};
}

function removeFinishedTask(uuid: string) {
    delete taskProgressMap.value[uuid];
    runningTaskIds.value = runningTaskIds.value.filter(id => id !== uuid);
    if (Object.keys(taskProgressMap.value).length === 0) {
        stopRunningUi();
    }
}

const backupProgressHandler = (data: { taskUuid: string; percent: number | null; message?: string }) => {
    if (!runningTaskIds.value.includes(data.taskUuid)) {
        // Accept progress for tasks we didn't explicitly start (detected from event log)
        runningTaskIds.value.push(data.taskUuid);
        isRunningNow.value = true;
    }
    const existing = taskProgressMap.value[data.taskUuid];
    const name = existing?.name || backUpListRef.value?.getTaskName?.(data.taskUuid) || data.taskUuid.slice(0, 8);
    taskProgressMap.value[data.taskUuid] = {
        name,
        percent: data.percent,
        message: data.message ?? '',
    };

    // Auto-clear completed tasks after a short delay so the user sees 100%
    if (data.percent === 100) {
        setTimeout(() => removeFinishedTask(data.taskUuid), 3000);
    }
};

const actionHandler = (raw: string) => {
    try {
        const msg = JSON.parse(raw);
        if (msg?.type === 'notification' && msg.message) {
            maybeClearFromNotification(msg.message);
        }
        if (msg?.type === 'backUpStatusesUpdated') {
            // Status polling completed — individual task completion is handled
            // by the notification handler (maybeClearFromNotification)
        }
        // Restore running state from event log (backup_start without backup_end)
        if (msg?.type === 'sendBackupEvents' && Array.isArray(msg.runningUuids) && msg.runningUuids.length > 0) {
            for (const uuid of msg.runningUuids) {
                if (!runningTaskIds.value.includes(uuid)) {
                    runningTaskIds.value.push(uuid);
                }
                if (!taskProgressMap.value[uuid]) {
                    const resolvedName = backUpListRef.value?.getTaskName?.(uuid) || uuid.slice(0, 8);
                    taskProgressMap.value[uuid] = { name: resolvedName, percent: null, message: 'In progress…' };
                }
            }
            isRunningNow.value = true;
        }
    } catch (e) { console.debug('actionHandler parse error:', e); }
};

onMounted(() => {
    IPCRouter.getInstance().addEventListener('action', actionHandler);
    IPCRouter.getInstance().addEventListener('backupProgress', backupProgressHandler);
});

onBeforeUnmount(() => {
    try { IPCRouter.getInstance().removeEventListener?.('action', actionHandler); } catch { }
    try { IPCRouter.getInstance().removeEventListener?.('backupProgress', backupProgressHandler); } catch { }
});
</script>
