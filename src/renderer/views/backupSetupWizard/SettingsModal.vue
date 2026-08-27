<template>
    <div v-if="open" class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40"
        @keydown.esc="close" @click.self="close" tabindex="-1" ref="overlayRef">
        <div class="bg-well border border-default rounded-lg shadow-xl w-[44rem] max-w-[calc(100vw-2rem)] h-[28rem] max-h-[80vh] flex flex-col text-left"
            @click.stop>
            <!-- Header -->
            <div class="flex items-center justify-between px-5 py-3 border-b border-default shrink-0">
                <h2 class="text-lg font-semibold">Settings</h2>
                <button class="text-muted hover:text-default" @click="close">
                    <XMarkIcon class="w-5 h-5" />
                </button>
            </div>

            <!-- Body: sidebar + content -->
            <div class="flex flex-1 min-h-0">
                <!-- Sidebar nav -->
                <nav class="w-40 shrink-0 border-r border-default py-3 overflow-y-auto" data-tour="settings-nav">
                    <template v-for="group in navGroups" :key="group.label">
                        <p class="nav-group-label">{{ group.label }}</p>
                        <button v-for="item in group.items" :key="item.key"
                            class="nav-btn" :class="{ 'nav-btn-active': activeSection === item.key }"
                            @click="activeSection = item.key">
                            <component :is="item.icon" class="w-4 h-4 shrink-0" />
                            {{ item.label }}
                        </button>
                    </template>
                </nav>

                <!-- Content -->
                <div class="flex-1 overflow-y-auto px-5 py-4" data-tour="settings-content">

                <!-- ═══ Servers ═══════════════════════════════════════ -->
                <template v-if="activeSection === 'servers'">
                    <div v-if="servers.length === 0" class="text-sm text-muted py-8 text-center">
                        No saved servers yet. Connect to a server and choose "Remember" to save it.
                    </div>
                    <div v-else class="space-y-2">
                        <div v-for="srv in servers" :key="srv.id"
                            class="flex items-center gap-3 p-3 rounded-lg border border-default bg-default">
                            <!-- Favorite star -->
                            <button class="shrink-0"
                                :title="srv.favorite ? 'Remove from favorites' : 'Add to favorites'"
                                @click="toggleFavorite(srv)">
                                <StarIconSolid v-if="srv.favorite" class="w-5 h-5 text-yellow-400" />
                                <StarIconOutline v-else class="w-5 h-5 text-muted hover:text-yellow-400" />
                            </button>

                            <!-- Info -->
                            <div class="flex-1 min-w-0">
                                <div v-if="editingServerId === srv.id" class="flex items-center gap-2">
                                    <input v-model="editingName" ref="nameInputRef"
                                        class="input-textlike border border-default rounded px-2 py-0.5 text-sm flex-1"
                                        placeholder="Display name (optional)"
                                        @keydown.enter="saveServerName(srv)"
                                        @keydown.esc="editingServerId = null" />
                                    <button class="btn btn-sm btn-primary h-fit px-2" @click="saveServerName(srv)">Save</button>
                                    <button class="btn btn-sm btn-secondary h-fit px-2" @click="editingServerId = null">Cancel</button>
                                </div>
                                <div v-else class="flex items-center gap-2">
                                    <span class="text-sm font-medium truncate">
                                        {{ srv.name || srv.host }}
                                    </span>
                                    <span v-if="srv.name" class="text-xs text-muted">({{ srv.host }})</span>
                                    <button class="text-muted hover:text-default" title="Edit name"
                                        @click="startEditingName(srv)">
                                        <PencilIcon class="w-3.5 h-3.5" />
                                    </button>
                                </div>
                                <div class="text-xs text-muted mt-0.5">
                                    {{ srv.username }}
                                    <template v-if="srv.lastUsedAt">
                                        &middot; last used {{ formatRelative(srv.lastUsedAt) }}
                                    </template>
                                </div>
                            </div>

                            <!-- Delete -->
                            <button class="shrink-0 text-muted hover:text-danger" title="Remove saved server"
                                @click="confirmRemoveServer(srv)">
                                <TrashIcon class="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </template>

                <!-- ═══ Display ═══════════════════════════════════════ -->
                <template v-if="activeSection === 'display'">
                    <div class="divide-y divide-default">
                        <SettingRow label="Server display format" description="How servers appear in dropdowns and lists.">
                            <select v-model="draft.serverDisplayFormat"
                                class="input-textlike border border-default rounded px-2 py-1 text-sm min-w-[160px]">
                                <option value="both">Hostname (IP)</option>
                                <option value="hostname">Hostname only</option>
                                <option value="ip">IP only</option>
                            </select>
                        </SettingRow>

                        <SettingRow label="Show notification toasts" description="Display in-app notifications for backup events.">
                            <ToggleSwitch v-model="draft.showNotifications" />
                        </SettingRow>

                        <SettingRow label="Guided tours" description="Show step-by-step guided tours for new features and views.">
                            <ToggleSwitch v-model="draft.guidedToursEnabled" />
                        </SettingRow>

                        <SettingRow label="Reset guided tours" description="Re-show all onboarding walkthroughs and welcome screens.">
                            <button class="btn btn-sm btn-outline-shadow h-fit" :disabled="allOnboardingDone === false" @click="handleResetOnboarding">
                                Reset
                            </button>
                        </SettingRow>
                    </div>
                </template>

                <!-- ═══ Connection ════════════════════════════════════ -->
                <template v-if="activeSection === 'connection'">
                    <div class="divide-y divide-default">
                        <SettingRow label="Auto-connect favorites" description="Automatically connect when a favorite server is selected.">
                            <ToggleSwitch v-model="draft.autoConnectFavorites" />
                        </SettingRow>

                        <SettingRow label="SSH Connection timeout" description="Seconds to wait when connecting to a server.">
                            <input v-model.number="sshTimeoutSec" type="number" min="5" max="120" step="5"
                                class="input-textlike border border-default rounded px-2 py-1 text-sm w-16 text-right" />
                            <span class="text-xs text-muted ml-1">sec</span>
                        </SettingRow>

                        <SettingRow label="Fast SSH ciphers" description="Use AES-128-GCM for faster LAN transfers (requires AES-NI on both ends).">
                            <ToggleSwitch v-model="draft.sshFastCiphers" />
                        </SettingRow>

                        <SettingRow label="Fallback network scan" description="Scan the network when automatic discovery fails.">
                            <ToggleSwitch v-model="draft.discoveryFallbackEnabled" />
                        </SettingRow>
                    </div>

                    <!-- Discovery timing row -->
                    <p class="text-xs font-semibold text-muted uppercase tracking-wide mt-4 mb-2">Discovery Timing</p>
                    <div class="grid grid-cols-2 gap-3">
                        <div class="flex items-center justify-between gap-2 rounded-lg border border-default bg-default px-3 py-2">
                            <div class="min-w-0">
                                <div class="text-sm font-medium text-default">Scan interval</div>
                            </div>
                            <div class="flex items-center gap-1">
                                <input v-model.number="discoveryScanSec" type="number" min="2" max="60" step="1"
                                    class="input-textlike border border-default rounded px-2 py-1 text-sm w-16 text-right" />
                                <span class="text-xs text-muted">sec</span>
                            </div>
                        </div>
                        <div class="flex items-center justify-between gap-2 rounded-lg border border-default bg-default px-3 py-2">
                            <div class="min-w-0">
                                <div class="text-sm font-medium text-default">Inactivity timeout</div>
                            </div>
                            <div class="flex items-center gap-1">
                                <input v-model.number="inactivitySec" type="number" min="10" max="600" step="10"
                                    class="input-textlike border border-default rounded px-2 py-1 text-sm w-16 text-right" />
                                <span class="text-xs text-muted">sec</span>
                            </div>
                        </div>
                    </div>
                </template>

                <!-- ═══ Advanced ══════════════════════════════════════ -->
                <template v-if="activeSection === 'advanced'">
                    <div class="divide-y divide-default">
                        <SettingRow label="Log retention" description="How long to keep log files.">
                            <input v-model.number="draft.logRetentionDays" type="number" min="1" max="365" step="1"
                                class="input-textlike border border-default rounded px-2 py-1 text-sm w-20 text-right" />
                            <span class="text-xs text-muted ml-1">days</span>
                        </SettingRow>
                    </div>

                    <div class="pt-4 mt-4 border-t border-default">
                        <button class="btn btn-sm btn-secondary h-fit text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20" @click="confirmReset">
                            Reset All Settings
                        </button>
                        <p class="text-xs text-muted mt-1">This resets all preferences to their defaults. Saved servers are not affected.</p>
                    </div>
                </template>
                </div>
            </div>

            <!-- Footer -->
            <div class="flex items-center justify-between px-5 py-3 border-t border-default shrink-0">
                <div class="flex items-center gap-3">
                    <a href="https://github.com/45Drives/houston-client-manager/blob/main/docs/45Drives_Storage_Wizard_User_Guide.md"
                        target="_blank" rel="noopener noreferrer"
                        class="text-xs text-link inline-flex items-center gap-1 hover:underline">
                        <BookOpenIcon class="w-3.5 h-3.5" />
                        User Guide
                    </a>
                    <span v-if="dirty" class="text-xs text-muted">Unsaved changes</span>
                </div>
                <div class="flex items-center gap-2">
                    <button class="btn btn-sm btn-outline-shadow h-fit" @click="close">Cancel</button>
                    <button class="btn btn-sm btn-primary h-fit" :disabled="!dirty" @click="saveAndClose">
                        Save
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick } from 'vue';
import { reportSuccess } from '@45drives/houston-common-ui';
import { useSettings, type AppSettings } from '../../composables/useSettings';
import { useServers, type StoredServer } from '../../composables/useServers';
import { useOnboarding } from '../../composables/useOnboarding';
import { useTourManager, type TourStep } from '../../composables/useTourManager';
import {
    XMarkIcon, TrashIcon, PencilIcon,
    ServerStackIcon, SwatchIcon, BellIcon, SparklesIcon,
    WifiIcon, Cog6ToothIcon, BookOpenIcon,
} from '@heroicons/vue/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/vue/24/solid';
import { StarIcon as StarIconOutline } from '@heroicons/vue/24/outline';

// ── Props / Emits ────────────────────────────────────────────────────────

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
    close: [];
    saved: [];
    serversChanged: [];
}>();

const { settings, load, save, reset } = useSettings();
const { savedServers: servers, displayServers, refresh: refreshServerList, setFavorite, updateServer, removeServer: removeServerEntry } = useServers();
const { onboarding, markDone, resetAll: resetOnboarding } = useOnboarding();
const { requestTour } = useTourManager();

// ── Guided tour (first time Settings is opened) ──────────────────────────

const settingsTourSteps: TourStep[] = [
    {
        target: '[data-tour="settings-nav"]',
        message: 'Settings is grouped into four areas: your saved servers, how the client looks and behaves, how it connects to servers, and advanced maintenance options.',
        onEnter: () => { activeSection.value = 'servers'; },
    },
    {
        target: '[data-tour="settings-content"]',
        message: 'Saved holds every server you have chosen to remember.\n\nRename them so they are easier to recognise, star the ones you use most so they appear at the top of every server picker, or remove entries you no longer need.',
        onEnter: () => { activeSection.value = 'servers'; },
    },
    {
        target: '[data-tour="settings-content"]',
        message: 'Display controls how servers are labelled, whether backup notifications pop up, and whether guided tours like this one are shown.\n\nReset guided tours brings every walkthrough back \u2014 useful after an update adds new features.',
        onEnter: () => { activeSection.value = 'display'; },
    },
    {
        target: '[data-tour="settings-content"]',
        message: 'Connection tunes how the client reaches your servers: SSH timeout, faster ciphers for slow links, and how often the network is scanned for new servers.\n\nIf servers are slow to appear or connections time out on a busy network, this is the place to adjust it.',
        onEnter: () => { activeSection.value = 'connection'; },
    },
    {
        target: '[data-tour="settings-content"]',
        message: 'Advanced covers log retention and restoring everything to defaults.',
        onEnter: () => { activeSection.value = 'advanced'; },
    },
];

watch(() => props.open, (isOpen) => {
    if (!isOpen || onboarding.value.settingsTourDone) return;
    setTimeout(() => {
        requestTour('settings', settingsTourSteps, async () => {
            activeSection.value = 'servers';
            await markDone('settingsTourDone');
        });
    }, 350);
});

const allOnboardingDone = computed(() =>
    onboarding.value.backupManagerSeen || onboarding.value.backupManagerTourDone
);

async function handleResetOnboarding() {
    await resetOnboarding();
    // Sync draft so saving doesn't overwrite the reset with stale values
    if (settings.value) {
        Object.assign(draft.onboarding, settings.value.onboarding);
    }
    // Re-enable guided tours if they were off
    draft.guidedToursEnabled = true;
    reportSuccess('Guided tours have been reset');
}

// ── Section nav ──────────────────────────────────────────────────────────

type Section = 'servers' | 'display' | 'connection' | 'advanced';
const activeSection = ref<Section>('servers');

const navGroups = [
    {
        label: 'Servers',
        items: [
            { key: 'servers' as Section, label: 'Saved', icon: ServerStackIcon },
        ],
    },
    {
        label: 'Client',
        items: [
            { key: 'display' as Section, label: 'Display', icon: SwatchIcon },
        ],
    },
    {
        label: 'Network',
        items: [
            { key: 'connection' as Section, label: 'Connection', icon: WifiIcon },
        ],
    },
    {
        label: 'System',
        items: [
            { key: 'advanced' as Section, label: 'Advanced', icon: Cog6ToothIcon },
        ],
    },
];

// ── Draft state (for settings that require Save) ─────────────────────────

const draft = reactive<AppSettings>({
    serverDisplayFormat: 'both',
    autoConnectFavorites: true,
    discoveryScanIntervalMs: 5000,
    discoveryInactivityTimeoutMs: 60000,
    discoveryFallbackEnabled: true,
    sshTimeoutMs: 20000,
    sshFastCiphers: false,
    logRetentionDays: 14,
    showNotifications: true,
    guidedToursEnabled: true,
    onboarding: {
        dashboardTourDone: false,
        backupManagerSeen: false,
        backupManagerTourDone: false,
        createBackupTourDone: false,
        backupListTourDone: false,
        backupBrowserTourDone: false,
        editTaskTourDone: false,
        remoteBackupsTourDone: false,
        restoreBrowserTourDone: false,
        snapshotManagerTourDone: false,
        serverManageTourDone: false,
        smNetworkTabTourDone: false,
        smStorageTabTourDone: false,
        smUsersTabTourDone: false,
        smSambaTabTourDone: false,
        smSystemTabTourDone: false,
        bulkSetupTourDone: false,
        addExistingServerTourDone: false,
        settingsTourDone: false,
        topologyTourDone: false,
        vpnTunnelsTourDone: false,
    },
});

// Derived seconds fields (convert ms ↔ sec for display)
const sshTimeoutSec = computed({
    get: () => Math.round(draft.sshTimeoutMs / 1000),
    set: (v: number) => { draft.sshTimeoutMs = v * 1000; },
});
const discoveryScanSec = computed({
    get: () => Math.round(draft.discoveryScanIntervalMs / 1000),
    set: (v: number) => { draft.discoveryScanIntervalMs = v * 1000; },
});
const inactivitySec = computed({
    get: () => Math.round(draft.discoveryInactivityTimeoutMs / 1000),
    set: (v: number) => { draft.discoveryInactivityTimeoutMs = v * 1000; },
});

const dirty = computed(() => {
    if (!settings.value) return false;
    return (Object.keys(draft) as (keyof AppSettings)[]).some(k => {
        const a = draft[k];
        const b = settings.value![k];
        if (typeof a === 'object' && a !== null) return JSON.stringify(a) !== JSON.stringify(b);
        return a !== b;
    });
});

// ── Server list state ────────────────────────────────────────────────────

const editingServerId = ref<string | null>(null);
const editingName = ref('');
const nameInputRef = ref<HTMLInputElement[] | null>(null);

async function loadServers() {
    await refreshServerList();
}

async function toggleFavorite(srv: StoredServer) {
    await setFavorite(srv.id, !srv.favorite);
    emit('serversChanged');
}

function startEditingName(srv: StoredServer) {
    editingServerId.value = srv.id;
    editingName.value = srv.name || '';
    nextTick(() => {
        if (nameInputRef.value?.[0]) nameInputRef.value[0].focus();
    });
}

async function saveServerName(srv: StoredServer) {
    await updateServer(srv.id, { name: editingName.value.trim() });
    editingServerId.value = null;
    emit('serversChanged');
}

async function confirmRemoveServer(srv: StoredServer) {
    const ok = window.confirm(
        `Remove saved credentials for ${srv.name || srv.host} (${srv.username})?\n\nYou'll need to log in again next time.`
    );
    if (!ok) return;
    await removeServerEntry(srv.id);
    emit('serversChanged');
}

// ── Lifecycle ────────────────────────────────────────────────────────────

watch(() => props.open, async (isOpen) => {
    if (isOpen) {
        await load();
        if (settings.value) Object.assign(draft, settings.value);
        await loadServers();
        activeSection.value = 'servers';
    }
});

async function saveAndClose() {
    await save(JSON.parse(JSON.stringify(draft)));
    reportSuccess('Settings saved');
    emit('saved');
    emit('close');
}

function close() {
    emit('close');
}

async function confirmReset() {
    const ok = window.confirm('Reset all settings to defaults? This cannot be undone.');
    if (!ok) return;
    await reset();
    if (settings.value) Object.assign(draft, settings.value);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatRelative(epochMs: number): string {
    const diff = Date.now() - epochMs;
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    if (d < 30) return `${d}d ago`;
    return new Date(epochMs).toLocaleDateString();
}
</script>

<!-- ── Inline sub-components ────────────────────────────────────────────── -->

<script lang="ts">
import { defineComponent, h } from 'vue';

const SettingRow = defineComponent({
    props: {
        label: { type: String, required: true },
        description: { type: String, default: '' },
    },
    setup(props, { slots }) {
        return () => h('div', { class: 'grid grid-cols-[1fr_auto] gap-x-6 gap-y-0.5 items-start py-2' }, [
            h('div', { class: 'min-w-0' }, [
                h('div', { class: 'text-sm font-medium text-default' }, props.label),
                props.description
                    ? h('div', { class: 'text-xs text-muted mt-0.5' }, props.description)
                    : null,
            ]),
            h('div', { class: 'flex items-center gap-1 justify-end min-w-[160px]' }, slots.default?.()),
        ]);
    },
});

const ToggleSwitch = defineComponent({
    props: { modelValue: { type: Boolean, required: true } },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        return () => h('button', {
            type: 'button',
            role: 'switch',
            'aria-checked': props.modelValue,
            class: [
                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                props.modelValue ? 'bg-primary' : 'bg-muted/30',
            ],
            onClick: () => emit('update:modelValue', !props.modelValue),
        }, [
            h('span', {
                class: [
                    'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white dark:bg-gray-200 shadow ring-0 transition-transform',
                    props.modelValue ? 'translate-x-4' : 'translate-x-0',
                ],
            }),
        ]);
    },
});
</script>

<style scoped>
.nav-group-label {
    font-size: 0.625rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgb(156 163 175);
    padding: 0.5rem 0.75rem 0.25rem;
}
:root.dark .nav-group-label {
    color: rgb(107 114 128);
}
.nav-group-label:not(:first-child) {
    margin-top: 0.5rem;
}
.nav-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
    font-weight: 500;
    color: rgb(107 114 128);
    transition: all 0.15s ease;
    border-left: 2px solid transparent;
}
:root.dark .nav-btn {
    color: rgb(156 163 175);
}
.nav-btn:hover {
    color: rgb(55 65 81);
    background-color: rgb(249 250 251);
}
:root.dark .nav-btn:hover {
    color: rgb(209 213 219);
    background-color: rgba(255,255,255,0.05);
}
.nav-btn-active {
    color: rgb(71 85 105);
    background-color: rgba(71, 85, 105, 0.08);
    font-weight: 600;
    border-left-color: rgb(71 85 105);
}
:root.dark .nav-btn-active {
    color: rgb(148 163 184);
    background-color: rgba(148, 163, 184, 0.1);
    border-left-color: rgb(148 163 184);
}
</style>
