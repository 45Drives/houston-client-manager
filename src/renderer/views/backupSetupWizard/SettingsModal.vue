<template>
    <div v-if="open" class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40"
        @keydown.esc="close" tabindex="-1" ref="overlayRef">
        <div class="bg-well border border-default rounded-lg shadow-xl w-full sm:w-[40rem] max-w-[calc(100vw-2rem)] max-h-[80vh] flex flex-col"
            @click.stop>
            <!-- Header -->
            <div class="flex items-center justify-between px-5 py-3 border-b border-default shrink-0">
                <h2 class="text-lg font-semibold">Settings</h2>
                <button class="text-muted hover:text-default" @click="close">
                    <XMarkIcon class="w-5 h-5" />
                </button>
            </div>

            <!-- Tabs -->
            <div class="flex border-b border-default px-5 shrink-0 gap-4">
                <button v-for="t in tabs" :key="t.key"
                    class="py-2 text-sm font-medium border-b-2 transition-colors -mb-px"
                    :class="activeSection === t.key
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted hover:text-default'"
                    @click="activeSection = t.key">
                    {{ t.label }}
                </button>
            </div>

            <!-- Body (scrollable) -->
            <div class="flex-1 overflow-y-auto px-5 py-4">

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
                                    <button class="btn btn-primary text-xs h-fit px-2" @click="saveServerName(srv)">Save</button>
                                    <button class="btn btn-secondary text-xs h-fit px-2" @click="editingServerId = null">Cancel</button>
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
                    </div>
                </template>

                <!-- ═══ Connection ════════════════════════════════════ -->
                <template v-if="activeSection === 'connection'">
                    <div class="divide-y divide-default">
                        <SettingRow label="Auto-connect favorites" description="Automatically connect when a favorite server is selected.">
                            <ToggleSwitch v-model="draft.autoConnectFavorites" />
                        </SettingRow>

                        <SettingRow label="SSH timeout" description="How long to wait for SSH connections (seconds).">
                            <input v-model.number="sshTimeoutSec" type="number" min="5" max="120" step="5"
                                class="input-textlike border border-default rounded px-2 py-1 text-sm w-20 text-right" />
                            <span class="text-xs text-muted ml-1">sec</span>
                        </SettingRow>

                        <SettingRow label="Discovery scan interval" description="How often to scan for servers (seconds).">
                            <input v-model.number="discoveryScanSec" type="number" min="2" max="60" step="1"
                                class="input-textlike border border-default rounded px-2 py-1 text-sm w-20 text-right" />
                            <span class="text-xs text-muted ml-1">sec</span>
                        </SettingRow>

                        <SettingRow label="Server inactivity timeout" description="How long to show offline servers (seconds).">
                            <input v-model.number="inactivitySec" type="number" min="10" max="600" step="10"
                                class="input-textlike border border-default rounded px-2 py-1 text-sm w-20 text-right" />
                            <span class="text-xs text-muted ml-1">sec</span>
                        </SettingRow>

                        <SettingRow label="Fallback network scan" description="Scan the subnet when mDNS discovery fails.">
                            <ToggleSwitch v-model="draft.discoveryFallbackEnabled" />
                        </SettingRow>
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
                        <button class="btn btn-danger text-sm" @click="confirmReset">
                            Reset All Settings
                        </button>
                        <p class="text-xs text-muted mt-1">This resets all preferences to their defaults. Saved servers are not affected.</p>
                    </div>
                </template>
            </div>

            <!-- Footer -->
            <div class="flex items-center justify-between px-5 py-3 border-t border-default shrink-0">
                <div v-if="dirty" class="text-xs text-muted">Unsaved changes</div>
                <div v-else />
                <div class="flex items-center gap-2">
                    <button class="btn btn-secondary text-sm" @click="close">Cancel</button>
                    <button class="btn btn-primary text-sm" :disabled="!dirty" @click="saveAndClose">
                        Save
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick } from 'vue';
import { useSettings, type AppSettings, type SavedServer } from '../../composables/useSettings';
import {
    XMarkIcon, TrashIcon, PencilIcon,
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

const { settings, load, save, reset, listServers, setServerName, setServerFavorite, removeServer } = useSettings();

// ── Section tabs ─────────────────────────────────────────────────────────

type Section = 'servers' | 'display' | 'connection' | 'advanced';
const activeSection = ref<Section>('servers');
const tabs: { key: Section; label: string }[] = [
    { key: 'servers', label: 'Servers' },
    { key: 'display', label: 'Display' },
    { key: 'connection', label: 'Connection' },
    { key: 'advanced', label: 'Advanced' },
];

// ── Draft state (for settings that require Save) ─────────────────────────

const draft = reactive<AppSettings>({
    serverDisplayFormat: 'both',
    autoConnectFavorites: true,
    discoveryScanIntervalMs: 5000,
    discoveryInactivityTimeoutMs: 60000,
    discoveryFallbackEnabled: true,
    sshTimeoutMs: 20000,
    logRetentionDays: 14,
    showNotifications: true,
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
    return (Object.keys(draft) as (keyof AppSettings)[]).some(
        k => draft[k] !== settings.value![k]
    );
});

// ── Server list state ────────────────────────────────────────────────────

const servers = ref<SavedServer[]>([]);
const editingServerId = ref<string | null>(null);
const editingName = ref('');
const nameInputRef = ref<HTMLInputElement[] | null>(null);

async function loadServers() {
    servers.value = await listServers();
    // Sort: favorites first, then by last used
    servers.value.sort((a, b) =>
        (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) ||
        (b.lastUsedAt || 0) - (a.lastUsedAt || 0)
    );
}

async function toggleFavorite(srv: SavedServer) {
    await setServerFavorite(srv.id, !srv.favorite);
    await loadServers();
    emit('serversChanged');
}

function startEditingName(srv: SavedServer) {
    editingServerId.value = srv.id;
    editingName.value = srv.name || '';
    nextTick(() => {
        if (nameInputRef.value?.[0]) nameInputRef.value[0].focus();
    });
}

async function saveServerName(srv: SavedServer) {
    await setServerName(srv.id, editingName.value.trim());
    editingServerId.value = null;
    await loadServers();
    emit('serversChanged');
}

async function confirmRemoveServer(srv: SavedServer) {
    const ok = window.confirm(
        `Remove saved credentials for ${srv.name || srv.host} (${srv.username})?\n\nYou'll need to log in again next time.`
    );
    if (!ok) return;
    await removeServer(srv.id);
    await loadServers();
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
    await save({ ...draft });
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
