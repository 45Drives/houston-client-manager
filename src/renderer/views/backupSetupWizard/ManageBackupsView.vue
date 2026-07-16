<template>
    <div class="h-full flex flex-col min-h-0 overflow-hidden p-4 ui-texture-surface ui-texture-surface--soft">
        <!-- Tab bar + actions header -->
        <div class="flex flex-wrap items-center gap-3 mb-4 shrink-0">
            <!-- Left-aligned group -->
            <button class="btn btn-sm btn-ghost h-fit flex items-center gap-1.5 text-gray-500 hover:text-default shrink-0" @click="router.push({ name: 'dashboard' })">
                <ArrowLeftIcon class="w-4 h-4" />
                Dashboard
            </button>

            <div class="inline-flex rounded-lg border border-default overflow-hidden shrink-0" data-tour="tab-bar">
                <button class="px-3 sm:px-5 py-1.5 sm:py-2 text-sm font-medium flex items-center gap-2 transition-colors"
                    :class="activeTab === 'local' ? 'bg-accent text-default shadow-[inset_0_-2px_0_var(--btn-primary-bg)]' : 'bg-well hover:bg-accent text-muted'"
                    @click="activeTab = 'local'; remoteView = 'backups'">
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
                <div class="flex flex-wrap items-center gap-3 min-h-9" data-tour="remote-server-picker">
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
                    <button class="btn btn-sm btn-primary h-fit flex items-center gap-1.5" :disabled="!selectedIp" @click="openLogin">
                        <LinkIcon class="w-4 h-4" />
                        Connect
                    </button>
                    <button class="btn btn-sm btn-outline-shadow h-fit flex items-center gap-1.5"
                        :class="currentServer || showRemoteTour ? '' : 'invisible pointer-events-none'"
                        :disabled="!currentServer"
                        @click="showRestoreView ? disconnectRestore() : cockpitRef?.logoutFromCurrentServer()">
                        <ArrowRightOnRectangleIcon class="w-4 h-4" />
                        Disconnect
                    </button>
                    <button class="btn btn-sm btn-ghost h-fit flex items-center gap-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                        :class="(activeCredId && currentServer) || showRemoteTour ? '' : 'invisible pointer-events-none'"
                        :disabled="!(activeCredId && currentServer)"
                        @click="forgetActive">
                        <TrashIcon class="w-4 h-4" />
                        Forget
                    </button>
                </div>
            </template>

            <!-- Spacer pushes right-side items to far right -->
            <div class="flex-1" />

            <!-- Right-aligned group -->
            <template v-if="activeTab === 'remote'">
                <button class="btn btn-sm h-fit flex items-center gap-1.5" data-tour="restore-btn"
                    :class="remoteView === 'restore' ? 'btn-outline-shadow' : 'btn-primary'" :disabled="!restoreConnected"
                    @click="remoteView = remoteView === 'restore' ? 'backups' : 'restore'">
                    <template v-if="remoteView === 'restore'">
                        <ArrowLeftIcon class="w-4 h-4" />
                        Return to Backups
                    </template>
                    <template v-else>
                        <ArrowDownTrayIcon class="w-4 h-4" />
                        Restore
                    </template>
                </button>
                <button class="btn btn-sm h-fit flex items-center gap-1.5" data-tour="snapshots-btn"
                    :class="remoteView === 'snapshots' ? 'btn-outline-shadow' : 'btn-primary'" :disabled="!restoreConnected"
                    @click="remoteView = remoteView === 'snapshots' ? 'backups' : 'snapshots'">
                    <template v-if="remoteView === 'snapshots'">
                        <ArrowLeftIcon class="w-4 h-4" />
                        Return to Backups
                    </template>
                    <template v-else>
                        <CameraIcon class="w-4 h-4" />
                        Snapshots
                    </template>
                </button>
            </template>
            <template v-else>
                <button class="btn btn-sm btn-primary h-fit flex items-center gap-1.5" @click="newBackupTask" data-tour="new-backup">
                    <PlusIcon class="w-4 h-4" />
                    New Backup
                </button>
            </template>

            <button class="w-8 h-8 p-0 rounded-md bg-transparent inline-flex items-center justify-center text-gray-500 hover:text-default hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors" title="Settings" @click="openSettingsModal()" data-tour="settings-btn">
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
                                class="h-full bg-primary/40 rounded-full animate-indeterminate-bar" />
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
            <RestoreBrowser v-if="remoteView === 'restore' && restoreConnected && restoreUsername"
                :serverIp="selectedIp" :username="restoreUsername" />

            <!-- Snapshot manager (toggled via Snapshots button) -->
            <SnapshotManager v-else-if="remoteView === 'snapshots' && restoreConnected && restoreUsername"
                :serverIp="selectedIp" :username="restoreUsername" />

            <!-- Scheduler webview (default remote view) -->
            <CockpitWebview v-else-if="currentServer && remoteView === 'backups'" :key="currentServer.ip" ref="cockpitRef"
                routePath="/scheduler-test" hash="simple" wrapperClass="h-full overflow-hidden"
                heightClass="h-full" :openDevtoolsInDev="true" :requireAdmin="false" />

            <!-- Scheduler mockup shown during the remote tour when not connected -->
            <div v-else-if="showRemoteTour" class="relative h-full" data-tour="scheduler-preview">
                <SchedulerMockup class="h-full" />
            </div>

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
import { useTourManager, type TourStep } from '../../composables/useTourManager';
import SchedulerMockup from '../../components/SchedulerMockup.vue';
import RestoreBrowser from './RestoreBrowser.vue';
import SnapshotManager from './SnapshotManager.vue';
import ServerLoginModal from './ServerLoginModal.vue';
import BackUpListView from './BackUpListView.vue';
import { useServerCredentials } from '../../composables/useServerCredentials';
import { computed, inject, Ref, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { currentServerInjectionKey, discoveryStateInjectionKey, reviewBackUpSetupKey } from '../../keys/injection-keys';
import { useRouter } from 'vue-router';
import { useHeader } from '../../composables/useHeader';
import { useLogModal } from '../../composables/useLogModal';
import { useSettingsModal } from '../../composables/useSettingsModal';
import { DiscoveryState, type Server as ServerType } from '../../types';
import { useSettings } from '../../composables/useSettings';
import { useOnboarding } from '../../composables/useOnboarding';
import {
    ComputerDesktopIcon, GlobeAltIcon, PlusIcon,
    ArrowLeftIcon, ArrowDownTrayIcon, Cog6ToothIcon, XMarkIcon,
    LinkIcon, ArrowRightOnRectangleIcon, TrashIcon, CameraIcon,
} from '@heroicons/vue/24/outline';

useHeader('Backup Manager');

const emit = defineEmits<{
    openWizard: [];
}>();

const { setCredentials } = useServerCredentials();
const { openLogModal } = useLogModal();
const { openSettingsModal } = useSettingsModal();
const reviewBackup = inject(reviewBackUpSetupKey);
const router = useRouter();
const selectedBackUpTasks = ref<BackUpTask[]>([]);
const activeTab = ref<'local' | 'remote'>('local');
const { settings } = useSettings();
const { onboarding, markDone } = useOnboarding();
const { requestTour, activeTour } = useTourManager();
const showRemoteTour = computed(() => activeTour.value?.id === 'remote-backups');

// ── Guided tour ──────────────────────────────────────────────────────────

const managerTourSteps: TourStep[] = [
    {
        target: '[data-tour="tab-bar"]',
        message: 'Switch between Local and Remote backup views here.\n\nLocal backups are scheduled tasks that run on this computer.\nRemote backups let you connect to your storage server to manage backups there.',
    },
    {
        target: '[data-tour="new-backup"]',
        message: 'Click here to create a new backup task.\n\nYou\'ll choose which folders to back up, pick a schedule, and enter your server login details.',
    },
    {
        target: '[data-tour="settings-btn"]',
        message: 'Open Settings to configure server connections, display preferences, and more.',
    },
    {
        target: '[data-tour="backup-table"]',
        message: 'This is your backup task list.\n\nClick on a row to select it. You can select multiple tasks using the checkboxes.',
    },
    {
        target: '[data-tour="run-now"]',
        message: 'Run a backup immediately.\n\nThese action buttons appear when you select one or more tasks from the list. Click Run Now to trigger a backup right away instead of waiting for the schedule.',
    },
    {
        target: '[data-tour="view-restore"]',
        message: 'View the files in a backup and restore individual files or entire backups.\n\nSelect tasks from the list to enable this button.',
    },
    {
        target: '[data-tour="edit-btn"]',
        message: 'Edit a task\'s name, source folder, schedule, or credentials.\n\nThis button is enabled when exactly one task is selected.',
    },
];

onMounted(() => {
    if (!onboarding.value.backupManagerTourDone) {
        setTimeout(() => {
            requestTour('backup-manager', managerTourSteps, async () => {
                await markDone('backupManagerTourDone');
                await markDone('backupListTourDone');
            });
        }, 500);
    }
});

// ── Remote backups tab tour ──────────────────────────────────────────────

const remoteTourSteps: TourStep[] = [
    {
        target: '[data-tour="remote-server-picker"]',
        message: 'Select a storage server from your discovered servers or favorites, then click Connect to log in.\n\nOnce connected, you can view and manage the server\'s backup tasks.',
    },
    {
        target: '[data-tour="scheduler-preview"]',
        message: 'Here\'s a preview of the Remote Backup Scheduler.\n\nOnce connected, you\'ll see your server\'s backup tasks listed in a table — create new tasks, run them on demand, view logs, and monitor progress.',
        placement: 'top',
    },
    {
        target: '[data-tour="restore-btn"]',
        message: 'Open the Restore browser to recover files from server-to-server or cloud backups on the remote server.',
    },
    {
        target: '[data-tour="snapshots-btn"]',
        message: 'Manage ZFS snapshots on the connected server.\n\nCreate, browse, restore, rollback, or delete snapshots for any dataset.',
    },
];

watch(activeTab, (tab) => {
    if (tab === 'remote' && !onboarding.value.remoteBackupsTourDone) {
        setTimeout(() => {
            requestTour('remote-backups', remoteTourSteps, () => markDone('remoteBackupsTourDone'));
        }, 400);
    }
});

// ── Restore/Snapshot view state (within Remote tab) ────────────────────────
const remoteView = ref<'backups' | 'restore' | 'snapshots'>('backups');
const restoreConnected = ref(false);
const restoreUsername = ref('');

// Compat: showRestoreView used in disconnect logic
const showRestoreView = computed(() => remoteView.value !== 'backups');

function disconnectRestore() {
    remoteView.value = 'backups';
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
    // Use unified list: stored servers + discovered-only servers
    // Exclude favorites (they have their own optgroup)
    const favHosts = new Set(savedServers.value.filter(s => s.favorite).map(s => s.host));
    return unifiedServers.value
        .filter(s => !favHosts.has(s.host))
        .map(s => {
            const hasName = s.name && s.name !== s.host;
            let label: string;
            if (fmt === 'ip') label = s.host;
            else if (fmt === 'hostname' && hasName) label = s.name!;
            else label = hasName ? `${s.name} (${s.host})` : s.host;
            return { ip: s.host, label };
        });
})

const cockpitRef = ref<InstanceType<typeof CockpitWebview> | null>(null);

import { useServers, type StoredServer } from '../../composables/useServers';
const { servers: unifiedServers, savedServers, refresh: refreshUnifiedServers } = useServers();
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
    await refreshUnifiedServers();
}
onMounted(async () => {
    await loadSavedServers();
    // Restore dropdown selection if already connected (e.g. navigating back to this view)
    if (currentServer?.value?.ip && !selectedIp.value) {
        selectedIp.value = currentServer.value.ip;
    }
});

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
    // Populate in-memory store so CockpitWebview can hydrate on mount
    // (the IPC relay is async and may arrive after the component mounts).
    setCredentials(ip, username, password);
    window.electron?.ipcRenderer.send('store-manual-creds', { ip, username, password });
}

async function onLoginSubmit({ username, password, remember }:
    { username: string; password: string; remember: boolean }) {
    const ip = selectedIp.value!;
    if (remember) {
        // Determine share name from discovery if available
        const disc = discoveryState.servers.find(s => s.ip === ip);
        const shareName = disc?.shareName || '';
        const res = await window.electron?.ipcRenderer.invoke('servers:add', {
            host: ip, shareName, username, password, favorite: true,
        });
        activeCredId.value = res?.id ?? null;
        await refreshUnifiedServers();
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
    if (activeCredId.value) window.electron?.ipcRenderer.invoke('servers:touch', activeCredId.value);
}

async function forgetActive() {
    if (!activeCredId.value) return;
    await window.electron?.ipcRenderer.invoke('servers:remove', activeCredId.value);
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
    remoteView.value = 'backups';
    if (!ip) return;
    const fav = savedServers.value.find(s => s.host === ip && s.favorite);
    const alreadyConnected = currentServer?.value?.ip === ip;
    if ((fav && settings.value?.autoConnectFavorites !== false) || alreadyConnected) {
        const saved = await window.electron?.ipcRenderer.invoke('cred:get-for', ip);
        if (saved?.username && saved?.password) {
            activeCredId.value = saved.id;
            restoreUsername.value = saved.username;
            restoreConnected.value = true;
            if (activeTab.value === 'remote') {
                sendCredsToWebview(ip, saved.username, saved.password);
            }
            const srv = discoveryState.servers.find(s => s.ip === ip) || null;
            if (srv) currentServer!.value = srv;
            return;
        }
    }
});

watch(serversForDropdown, (list) => {
    // Check both dropdown lists (favorites + main)
    const allIps = [...list.map(x => x.ip), ...favoriteServers.value.map(x => x.ip)]
    if (!allIps.length || (selectedIp.value && !allIps.includes(selectedIp.value))) {
        selectedIp.value = ''
        if (currentServer) currentServer.value = null
    }
}, { immediate: true })

function newBackupTask() {
    emit('openWizard');
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
        serverIp: t.host,
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
        if (msg?.type === 'sendBackupEvents' && 'runningUuids' in msg) {
            const currentRunning: string[] = Array.isArray(msg.runningUuids) ? msg.runningUuids : [];

            // Remove tasks that are no longer reported as running by the backend
            // (their backup_end was written since the last poll)
            for (const uuid of Object.keys(taskProgressMap.value)) {
                // Only auto-remove event-log-detected tasks (percent is still null),
                // not tasks started via Run Now that are actively reporting progress.
                const entry = taskProgressMap.value[uuid];
                if (entry && entry.percent == null && !currentRunning.includes(uuid)) {
                    removeFinishedTask(uuid);
                }
            }

            // Add newly-detected running tasks
            for (const uuid of currentRunning) {
                if (!runningTaskIds.value.includes(uuid)) {
                    runningTaskIds.value.push(uuid);
                }
                if (!taskProgressMap.value[uuid]) {
                    const resolvedName = backUpListRef.value?.getTaskName?.(uuid) || uuid.slice(0, 8);
                    taskProgressMap.value[uuid] = { name: resolvedName, percent: null, message: 'In progress…' };
                }
            }
            if (currentRunning.length > 0) {
                isRunningNow.value = true;
            }
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

function refreshBackups() {
    backUpListRef.value?.fetchBackupTasks();
}

defineExpose({ refreshBackups });
</script>
