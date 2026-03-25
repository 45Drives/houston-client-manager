<template>
    <div class="h-full flex flex-col min-h-0">
        <!-- ── Top bar: server info + actions ─────────────────────────── -->
        <div class="px-3 py-2 border-b border-default flex items-center gap-3 shrink-0">
            <span class="text-sm text-muted whitespace-nowrap">
                <ServerIcon class="w-4 h-4 inline -mt-0.5 mr-1" />
                {{ serverIp }}
            </span>

            <div class="flex-1" />

            <!-- Create snapshot -->
            <button class="btn btn-sm btn-primary btn-with-icon h-fit"
                :disabled="!snap.selectedDataset.value || snap.operating.value" @click="showCreateModal = true">
                <PlusIcon class="w-4 h-4" />
                New Snapshot
            </button>

            <!-- Refresh -->
            <button class="w-8 h-8 p-0 rounded-md bg-transparent inline-flex items-center justify-center text-gray-500 hover:text-default hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors" title="Refresh"
                :disabled="snap.loading.value" @click="refresh">
                <ArrowPathIcon class="w-4 h-4" />
            </button>
        </div>

        <!-- Error banner -->
        <div v-if="snap.error.value"
            class="mx-3 mt-2 p-2 bg-danger/10 border border-danger/30 rounded text-sm text-danger flex items-center gap-2">
            <ExclamationTriangleIcon class="w-4 h-4 shrink-0" />
            {{ snap.error.value }}
            <button class="ml-auto text-xs underline" @click="snap.clearError()">Dismiss</button>
        </div>

        <!-- ── Main content: 3-panel layout ───────────────────────────── -->
        <div class="flex-1 min-h-0 flex gap-3 p-3">

            <!-- LEFT: Dataset list ─────────────────────────────────────── -->
            <div class="w-1/5 min-w-[180px] flex flex-col min-h-0 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
                <div class="px-3 py-2 border-b border-neutral-200 dark:border-neutral-700 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 text-left">Datasets</div>
                <div v-if="snap.loading.value" class="flex-1 flex items-center justify-center">
                    <div class="spinner"></div>
                </div>
                <div v-else-if="snap.datasets.value.length === 0"
                    class="flex-1 flex items-start text-muted text-sm p-3">
                    No datasets found on this server.
                </div>
                <div v-else class="flex-1 overflow-y-auto text-left">
                    <div v-for="ds in snap.datasets.value" :key="ds.name"
                        class="px-3 py-2 border-b border-neutral-100 dark:border-neutral-700/50 cursor-pointer transition-colors border-l-2"
                        :class="snap.selectedDataset.value === ds.name ? 'bg-slate-600/5 dark:bg-slate-400/5 border-l-slate-600 dark:border-l-slate-400' : 'border-l-transparent hover:bg-neutral-50 dark:hover:bg-neutral-700/30'"
                        @click="snap.selectDataset(ds.name)">
                        <div class="text-sm font-medium text-default truncate" :title="ds.name">{{ ds.name }}</div>
                        <div class="text-xs text-muted truncate">{{ ds.mountpoint }} — {{ ds.used }} used</div>
                    </div>
                </div>
            </div>

            <!-- CENTER: Snapshot list ──────────────────────────────────── -->
            <div class="w-2/5 flex flex-col min-h-0 bg-neutral-50 dark:bg-neutral-850 rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden text-left">
                <div class="px-3 py-2 border-b border-default flex items-center justify-between">
                    <button v-if="snap.selectedDataset.value"
                        class="text-sm font-medium flex items-center gap-1 hover:text-muted transition-colors"
                        @click="snapSortAsc = !snapSortAsc">
                        Snapshots
                        <ChevronUpIcon v-if="snapSortAsc" class="w-3.5 h-3.5" />
                        <ChevronDownIcon v-else class="w-3.5 h-3.5" />
                    </button>
                    <span v-else class="text-sm font-medium">Select a dataset</span>
                    <span v-if="snap.snapshots.value.length > 0" class="text-xs text-muted">
                        {{ snap.snapshots.value.length }} snapshot{{ snap.snapshots.value.length !== 1 ? 's' : '' }}
                    </span>
                </div>

                <div v-if="!snap.selectedDataset.value"
                    class="flex-1 flex items-center justify-center text-muted text-sm">
                    Select a dataset to view its snapshots.
                </div>
                <div v-else-if="snap.snapshotsLoading.value" class="flex-1 flex items-center justify-center">
                    <div class="spinner"></div>
                </div>
                <div v-else-if="snap.snapshots.value.length === 0"
                    class="flex-1 flex flex-col items-center justify-center text-muted gap-2 p-3 text-center">
                    <CameraIcon class="w-8 h-8 opacity-30" />
                    <p class="text-sm">No snapshots found.</p>
                    <p class="text-xs">Create one using the button above.</p>
                </div>
                <div v-else class="flex-1 overflow-y-auto">
                    <div v-for="s in sortedSnapshots" :key="s.name"
                        class="group px-3 py-2 border-b border-neutral-100 dark:border-neutral-700/50 transition-colors border-l-2"
                        :class="snap.selectedSnapshot.value?.name === s.name ? 'bg-slate-600/5 dark:bg-slate-400/5 border-l-slate-600 dark:border-l-slate-400' : 'border-l-transparent hover:bg-white dark:hover:bg-neutral-800/60'">
                        <div class="flex items-start justify-between gap-2">
                            <div class="min-w-0 flex-1 cursor-pointer"
                                @click="snap.browseSnapshot(s)">
                                <div class="text-sm font-medium text-default truncate" :title="s.snapName">
                                    {{ s.snapName }}
                                </div>
                                <div class="text-xs text-gray-400">
                                    {{ s.creation }} — {{ s.used }} used
                                </div>
                            </div>
                            <!-- Icon-only actions: browse + kebab for destructive -->
                            <div class="flex items-center gap-0.5 shrink-0 mt-0.5">
                                <button class="w-7 h-7 p-0 rounded-md bg-transparent inline-flex items-center justify-center text-gray-500 hover:text-default hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors" title="Browse files"
                                    :disabled="snap.operating.value"
                                    @click="snap.browseSnapshot(s)">
                                    <FolderOpenIcon class="w-3.5 h-3.5" />
                                </button>
                                <button class="w-7 h-7 p-0 rounded-md bg-transparent inline-flex items-center justify-center text-amber-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors" title="Rollback"
                                    :disabled="snap.operating.value"
                                    @click="confirmRollback(s)">
                                    <ArrowUturnLeftIcon class="w-3.5 h-3.5" />
                                </button>
                                <button class="w-7 h-7 p-0 rounded-md bg-transparent inline-flex items-center justify-center opacity-0 group-hover:opacity-100 hover:!opacity-100 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors" title="Delete"
                                    :disabled="snap.operating.value"
                                    @click="confirmDelete(s)">
                                    <TrashIcon class="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- RIGHT: File browser / detail panel ──────────────────── -->
            <div class="flex-1 flex flex-col min-h-0 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
                <!-- File browser header -->
                <div class="px-3 py-2 border-b border-default flex flex-wrap items-center gap-1 shrink-0">
                    <template v-if="snap.selectedSnapshot.value">
                        <!-- Breadcrumb -->
                        <template v-for="(crumb, i) in snap.breadcrumb.value" :key="i">
                            <span v-if="i > 0" class="text-muted/40 text-xs">/</span>
                            <button
                                class="text-sm hover:text-default transition-colors"
                                :class="i === snap.breadcrumb.value.length - 1 ? 'text-default font-medium' : 'text-muted'"
                                @click="snap.navigateToBreadcrumb(i)">
                                {{ crumb }}
                            </button>
                        </template>

                        <div class="flex-1 min-w-[2rem]" />

                        <!-- Selection actions -->
                        <template v-if="snap.files.value.length > 0">
                            <button class="text-xs text-muted hover:text-default" @click="snap.selectAll()">Select All</button>
                            <span class="text-muted text-xs">|</span>
                            <button class="text-xs text-muted hover:text-default" @click="snap.deselectAll()">Deselect</button>
                            <span v-if="snap.selectedFiles.value.length > 0"
                                class="ml-1 text-xs bg-primary text-white px-2 py-0.5 rounded-full">
                                {{ snap.selectedFiles.value.length }}
                            </span>
                        </template>
                    </template>
                    <template v-else>
                        <span class="text-sm text-muted">Select a snapshot to browse its files</span>
                    </template>
                </div>

                <!-- No snapshot selected -->
                <div v-if="!snap.selectedSnapshot.value"
                    class="flex-1 flex flex-col items-center justify-center text-muted gap-2 p-4">
                    <FolderOpenIcon class="w-10 h-10 opacity-30" />
                    <p class="text-sm">Click on a snapshot or its browse button to see files.</p>
                </div>

                <!-- Loading -->
                <div v-else-if="snap.browsing.value" class="flex-1 flex items-center justify-center">
                    <div class="spinner"></div>
                </div>

                <!-- File list -->
                <template v-else>
                    <!-- Back row -->
                    <div v-if="snap.filePath.value.length > 0"
                        class="px-3 py-1.5 border-b border-default hover:bg-accent cursor-pointer flex items-center gap-2 text-sm text-muted"
                        @click="snap.navigateUp()">
                        <ArrowLeftIcon class="w-3.5 h-3.5" />
                        ..
                    </div>

                    <div v-if="snap.files.value.length === 0"
                        class="flex-1 flex items-center justify-center text-muted text-sm">
                        This directory is empty.
                    </div>

                    <div v-else class="flex-1 overflow-y-auto">
                        <div v-for="file in snap.files.value" :key="file.path"
                            class="flex items-center gap-3 px-3 py-1.5 border-b border-neutral-100 dark:border-neutral-700/50 cursor-pointer transition-colors border-l-2"
                            :class="file.selected ? 'bg-slate-600/5 dark:bg-slate-400/5 border-l-slate-600 dark:border-l-slate-400' : 'border-l-transparent hover:bg-neutral-50 dark:hover:bg-neutral-700/30'"
                            @click="file.isDir ? snap.navigateInto(file) : snap.toggleFileSelection(file)">
                            <!-- Checkbox for files -->
                            <input v-if="!file.isDir" type="checkbox" :checked="file.selected"
                                class="shrink-0" @click.stop="snap.toggleFileSelection(file)" />
                            <div v-else class="w-4 shrink-0" />

                            <FolderIcon v-if="file.isDir" class="w-4 h-4 text-primary shrink-0" />
                            <DocumentIcon v-else class="w-4 h-4 text-muted shrink-0" />

                            <span class="text-sm text-default truncate flex-1">{{ file.name }}</span>

                            <span class="text-xs text-muted whitespace-nowrap">
                                {{ file.isDir ? '—' : formatSize(file.size) }}
                            </span>
                            <span class="text-xs text-muted whitespace-nowrap w-28 text-right">
                                {{ formatDate(file.modTime) }}
                            </span>
                        </div>
                    </div>

                    <!-- Restore bar (shown when files selected) -->
                    <div v-if="snap.selectedFiles.value.length > 0"
                        class="px-3 py-2 border-t border-neutral-200 dark:border-neutral-700 flex items-center gap-3 shrink-0 bg-neutral-50 dark:bg-neutral-850">
                        <span class="text-sm text-default">
                            {{ snap.selectedFiles.value.length }} file{{ snap.selectedFiles.value.length !== 1 ? 's' : '' }} selected
                        </span>
                        <div class="flex-1" />
                        <input v-model="restoreDestPath" type="text" placeholder="Restore to path (e.g. /data/restored)"
                            class="input-textlike border border-default rounded px-2 py-1 text-sm w-64" />
                        <button class="btn btn-sm btn-primary h-fit"
                            :disabled="snap.operating.value || !restoreDestPath.trim()"
                            @click="doRestoreFiles">
                            <ArrowDownTrayIcon class="w-4 h-4 mr-1 inline" />
                            Restore
                        </button>
                    </div>
                </template>
            </div>
        </div>

        <!-- ── Create Snapshot Modal ──────────────────────────────────── -->
        <Teleport to="body">
            <div v-if="showCreateModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
                @click.self="showCreateModal = false">
                <div class="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-xl w-full max-w-md p-5 text-default">
                    <h3 class="text-base font-semibold mb-4">Create Snapshot</h3>

                    <div class="space-y-3">
                        <div>
                            <label class="text-sm text-accent mb-1 block">Dataset</label>
                            <div class="text-sm font-medium">{{ snap.selectedDataset.value }}</div>
                        </div>
                        <div>
                            <label class="text-sm text-accent mb-1 block">Snapshot Name</label>
                            <input v-model="createName" type="text" :placeholder="defaultSnapName"
                                class="input-textlike w-full border border-default rounded px-2 py-1.5 text-sm"
                                @keydown.enter="doCreate" />
                            <p v-if="createNameError" class="text-xs text-danger mt-1">{{ createNameError }}</p>
                            <p class="text-xs text-muted mt-1">Alphanumeric, dots, underscores, hyphens, colons. Leave blank for auto-name.</p>
                        </div>
                        <div>
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input v-model="createRecursive" type="checkbox" />
                                <span class="text-sm">Recursive (include child datasets)</span>
                            </label>
                        </div>
                    </div>

                    <div class="flex justify-end gap-2 mt-5">
                        <button class="btn btn-sm btn-outline-shadow h-fit" @click="showCreateModal = false">Cancel</button>
                        <button class="btn btn-sm btn-primary h-fit" :disabled="snap.operating.value || !!createNameError"
                            @click="doCreate">
                            {{ snap.operating.value ? 'Creating…' : 'Create' }}
                        </button>
                    </div>
                </div>
            </div>
        </Teleport>

        <!-- ── Confirm Rollback Modal ─────────────────────────────────── -->
        <Teleport to="body">
            <div v-if="rollbackTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
                @click.self="rollbackTarget = null">
                <div class="bg-default border border-default rounded-lg shadow-xl w-full max-w-md p-5">
                    <h3 class="text-base font-semibold mb-2 text-warning">Rollback Snapshot</h3>
                    <p class="text-sm text-muted mb-3">
                        This will roll back <strong class="text-default">{{ rollbackTarget.dataset }}</strong>
                        to snapshot <strong class="text-default">{{ rollbackTarget.snapName }}</strong>.
                    </p>
                    <div class="p-3 bg-danger/10 border border-danger/30 rounded text-sm text-danger mb-4">
                        <strong>Warning:</strong> All data and snapshots created after
                        <strong>{{ rollbackTarget.snapName }}</strong> will be permanently destroyed.
                        This action cannot be undone.
                    </div>
                    <div class="flex justify-end gap-2">
                        <button class="btn btn-sm btn-outline-shadow h-fit" @click="rollbackTarget = null">Cancel</button>
                        <button class="btn btn-sm btn-danger h-fit" :disabled="snap.operating.value"
                            @click="doRollback">
                            {{ snap.operating.value ? 'Rolling back…' : 'Rollback' }}
                        </button>
                    </div>
                </div>
            </div>
        </Teleport>

        <!-- ── Confirm Delete Modal ───────────────────────────────────── -->
        <Teleport to="body">
            <div v-if="deleteTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
                @click.self="deleteTarget = null">
                <div class="bg-default border border-default rounded-lg shadow-xl w-full max-w-md p-5">
                    <h3 class="text-base font-semibold mb-2 text-danger">Delete Snapshot</h3>
                    <p class="text-sm text-muted mb-4">
                        Are you sure you want to permanently delete snapshot
                        <strong class="text-default">{{ deleteTarget.snapName }}</strong>
                        from dataset <strong class="text-default">{{ deleteTarget.dataset }}</strong>?
                    </p>
                    <div class="flex justify-end gap-2">
                        <button class="btn btn-sm btn-outline-shadow h-fit" @click="deleteTarget = null">Cancel</button>
                        <button class="btn btn-sm btn-danger h-fit" :disabled="snap.operating.value"
                            @click="doDelete">
                            {{ snap.operating.value ? 'Deleting…' : 'Delete' }}
                        </button>
                    </div>
                </div>
            </div>
        </Teleport>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useSnapshotManager, type ZfsSnapshot } from '../../composables/useSnapshotManager';
import { Notification, pushNotification, reportError } from '@45drives/houston-common-ui';
import {
    ArrowLeftIcon, ArrowPathIcon, ArrowDownTrayIcon, ArrowUturnLeftIcon,
    PlusIcon, TrashIcon, FolderIcon, FolderOpenIcon, DocumentIcon,
    ServerIcon, ExclamationTriangleIcon, CameraIcon,
    ChevronUpIcon, ChevronDownIcon,
} from '@heroicons/vue/24/outline';

const props = defineProps<{
    serverIp: string;
    username: string;
}>();

const snap = useSnapshotManager(
    () => props.serverIp,
    () => props.username,
);

// ── Local state ──────────────────────────────────────────────────────────

const showCreateModal = ref(false);
const createName = ref('');
const createRecursive = ref(false);
const rollbackTarget = ref<ZfsSnapshot | null>(null);
const deleteTarget = ref<ZfsSnapshot | null>(null);
const restoreDestPath = ref('');
const snapSortAsc = ref(false); // false = newest first (descending), true = oldest first (ascending)

const sortedSnapshots = computed(() => {
    const list = [...snap.snapshots.value];
    list.sort((a, b) => {
        // creation is a string from `zfs list -o creation` — parse to Date for comparison
        const da = new Date(a.creation).getTime();
        const db = new Date(b.creation).getTime();
        return snapSortAsc.value ? da - db : db - da;
    });
    return list;
});

// ── Computed ─────────────────────────────────────────────────────────────

const defaultSnapName = computed(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `manual-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
});

const createNameError = computed(() => {
    const name = createName.value.trim();
    if (!name) return ''; // will use default
    if (!/^[A-Za-z0-9._:-]+$/.test(name)) return 'Only alphanumeric characters, dots, underscores, hyphens, and colons are allowed.';
    if (name.length > 255) return 'Name is too long (max 255 characters).';
    return '';
});

// ── Lifecycle ────────────────────────────────────────────────────────────

onMounted(() => {
    snap.loadDatasets();
});

watch(() => props.serverIp, () => {
    snap.reset();
    snap.loadDatasets();
});

// ── Actions ──────────────────────────────────────────────────────────────

function refresh() {
    if (snap.selectedDataset.value) {
        snap.loadSnapshots();
    }
    snap.loadDatasets();
}

async function doCreate() {
    if (!snap.selectedDataset.value) return;
    const name = createName.value.trim() || defaultSnapName.value;
    const result = await snap.createSnapshot(snap.selectedDataset.value, name, createRecursive.value);
    if (result.success) {
        showCreateModal.value = false;
        createName.value = '';
        createRecursive.value = false;
        pushNotification(new Notification('Snapshot Created', `"${name}" created successfully.`, 'success', 6000));
    } else {
        reportError(new Error(result.error ?? 'Failed to create snapshot'));
    }
}

function confirmRollback(s: ZfsSnapshot) {
    rollbackTarget.value = s;
}

async function doRollback() {
    if (!rollbackTarget.value) return;
    const result = await snap.rollbackSnapshot(rollbackTarget.value.name);
    if (result.success) {
        rollbackTarget.value = null;
        pushNotification(new Notification('Rollback Complete', `Rolled back to "${result.snapshot}" successfully.`, 'success', 6000));
        // Refresh snapshots since newer ones were destroyed
        snap.loadSnapshots();
    } else {
        rollbackTarget.value = null;
        reportError(new Error(result.error ?? 'Rollback failed'));
    }
}

function confirmDelete(s: ZfsSnapshot) {
    deleteTarget.value = s;
}

async function doDelete() {
    if (!deleteTarget.value) return;
    const name = deleteTarget.value.snapName;
    const result = await snap.destroySnapshot(deleteTarget.value.name);
    if (result.success) {
        deleteTarget.value = null;
        pushNotification(new Notification('Snapshot Deleted', `"${name}" deleted.`, 'success', 6000));
    } else {
        deleteTarget.value = null;
        reportError(new Error(result.error ?? 'Failed to delete snapshot'));
    }
}

async function doRestoreFiles() {
    const dest = restoreDestPath.value.trim();
    if (!dest) return;
    const result = await snap.restoreFiles(dest);
    if (result.success) {
        pushNotification(new Notification('Files Restored', `${result.filesRestored ?? 0} file(s) restored to ${dest}.`, 'success', 8000));
        snap.deselectAll();
    } else {
        reportError(new Error(result.error ?? 'File restore failed'));
    }
}

// ── Formatting helpers ───────────────────────────────────────────────────

function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatDate(d: number): string {
    if (!d) return '—';
    try {
        const date = new Date(d * 1000);
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
            + ' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch {
        return String(d);
    }
}
</script>
