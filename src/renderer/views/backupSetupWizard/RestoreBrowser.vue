<template>
    <div class="h-full flex flex-col min-h-0 overflow-hidden p-4">
        <!-- Header -->
        <div class="flex items-center justify-between mb-3 shrink-0">
            <!-- <h2 class="text-sm font-semibold text-default">Restore Browser</h2> -->
            <div class="flex items-center gap-3" data-tour="restore-source-picker">
                <select v-model="restore.sourceType.value"
                    class="input-textlike border border-default rounded px-2 py-1 text-sm min-w-[210px]"
                    @change="onSourceTypeChange">
                    <option value="s2s">Server Backups</option>
                    <option value="cloud">Cloud Backups</option>
                </select>

                <!-- Cloud: remote picker -->
                <template v-if="restore.sourceType.value === 'cloud'">
                    <select v-model="selectedRemote"
                        class="input-textlike border border-default rounded px-2 py-1 text-sm min-w-[210px]"
                        @change="onRemoteSelected">
                        <option value="">Select cloud account…</option>
                        <option v-for="r in restore.remotes.value" :key="r.name" :value="r.name">
                            {{ r.name }} ({{ r.type }})
                        </option>
                    </select>
                </template>

                <!-- S2S: task picker -->
                <template v-if="restore.sourceType.value === 's2s'">
                    <select v-model="selectedTaskName"
                        class="input-textlike border border-default rounded px-2 py-1 text-sm min-w-[400px]"
                        @change="onS2STaskSelected">
                        <option value="">Select backup task…</option>
                        <option v-for="t in restore.s2sTasks.value" :key="t.name" :value="t.name">
                            {{ t.name }} {{ t.direction === 'push' ? `→ ${t.remoteHost}:${t.remotePath}` : `← ${t.remoteHost}:${t.remotePath}` }}
                        </option>
                    </select>
                </template>

                <!-- Refresh -->
                <button v-if="restore.sourceType.value === 'cloud' || restore.sourceType.value === 's2s'"
                    class="w-8 h-8 p-0 rounded-md bg-transparent inline-flex items-center justify-center text-gray-500 hover:text-default hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                    title="Refresh"
                    :disabled="restore.loading.value"
                    @click="restore.sourceType.value === 'cloud' ? restore.loadRemotes() : restore.loadS2STasks()">
                    <ArrowPathIcon class="w-4 h-4" />
                </button>
            </div>
        </div>

        <!-- Breadcrumb -->
        <div v-if="restore.files.value.length > 0 || restore.currentPath.value.length > 0"
            class="flex items-center gap-1 text-sm text-muted mb-2 overflow-x-auto shrink-0">
            <button v-for="(crumb, i) in restore.breadcrumb.value" :key="i"
                class="hover:text-default transition-colors whitespace-nowrap"
                @click="restore.navigateToBreadcrumb(i)">
                {{ crumb }}
            </button>
            <template v-if="restore.breadcrumb.value.length > 1">
                <span class="mx-1 text-muted/50">/</span>
            </template>
        </div>

        <!-- Error banner -->
        <div v-if="restore.error.value" class="mb-2 p-2 bg-danger/10 border border-danger/30 rounded text-sm text-danger shrink-0">
            {{ restore.error.value }}
        </div>

        <!-- Main two-column content -->
        <div class="flex-1 min-h-0 flex gap-4">
                <!-- LEFT: File list -->
                <div class="w-3/5 flex flex-col min-h-0 rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden bg-white dark:bg-neutral-800">
                    <div class="px-3 py-2 border-b border-default flex items-center justify-between shrink-0">
                        <button class="text-sm font-medium text-default flex items-center gap-1 hover:text-primary transition-colors"
                            @click="toggleSort">
                            Name
                            <span class="text-xs">{{ sortDir === 'asc' ? '▲' : '▼' }}</span>
                        </button>
                        <div v-if="restore.files.value.length > 0" class="flex items-center gap-2">
                            <button class="text-xs text-muted hover:text-default" @click="restore.selectAll()">Select All</button>
                            <span class="text-muted">|</span>
                            <button class="text-xs text-muted hover:text-default" @click="restore.deselectAll()">Deselect All</button>
                            <span v-if="restore.selectedFiles.value.length > 0"
                                class="ml-2 text-xs bg-primary text-white px-2 py-0.5 rounded-full">
                                {{ restore.selectedFiles.value.length }} selected
                            </span>
                        </div>
                    </div>

                    <!-- Back navigation row -->
                    <div v-if="restore.currentPath.value.length > 0"
                        class="px-3 py-1.5 border-b border-default hover:bg-accent cursor-pointer flex items-center gap-2 text-sm text-muted"
                        @click="restore.navigateUp()">
                        <ArrowLeftIcon class="w-3.5 h-3.5" />
                        ..
                    </div>

                    <!-- Loading -->
                    <div v-if="restore.browsing.value" class="flex-1 flex items-center justify-center">
                        <div class="spinner"></div>
                    </div>

                    <!-- Empty -->
                    <div v-else-if="restore.files.value.length === 0"
                        class="flex-1 flex flex-col items-center justify-center text-muted gap-2 p-4">
                        <FolderOpenIcon class="w-10 h-10 opacity-30" />
                        <p class="text-sm">
                            <template v-if="restore.sourceType.value === 'cloud' && !selectedRemote">
                                Select a cloud remote to browse.
                            </template>
                            <template v-else-if="restore.sourceType.value === 's2s' && !selectedTaskName">
                                Select a backup task to browse remote files.
                            </template>
                            <template v-else>No files found at this location.</template>
                        </p>
                    </div>

                    <!-- File list -->
                    <div v-else class="flex-1 overflow-y-auto text-left">
                        <div v-for="(file, index) in sortedFiles" :key="index"
                            class="flex items-center gap-3 px-3 py-1.5 border-b border-neutral-100 dark:border-neutral-700/50 cursor-pointer transition-colors border-l-2"
                            :class="file.selected ? 'bg-slate-600/5 dark:bg-slate-400/5 border-l-slate-600 dark:border-l-slate-400' : 'border-l-transparent hover:bg-neutral-50 dark:hover:bg-neutral-700/30'"
                            @click="onFileClick(file)"
                            @dblclick="onFileDblClick(file)">
                            <!-- Checkbox (files only) -->
                            <input v-if="!isDir(file)" type="checkbox" :checked="file.selected"
                                class="shrink-0" @click.stop="restore.toggleFileSelection(file)" />
                            <div v-else class="w-4 shrink-0" />

                            <!-- Icon -->
                            <FolderIcon v-if="isDir(file)" class="w-4 h-4 text-primary shrink-0" />
                            <DocumentIcon v-else class="w-4 h-4 text-muted shrink-0" />

                            <!-- Name -->
                            <span class="text-sm text-default truncate flex-1">{{ fileName(file) }}</span>

                            <!-- Size -->
                            <span class="text-xs text-muted whitespace-nowrap">
                                {{ isDir(file) ? '—' : formatSize(fileSize(file)) }}
                            </span>

                            <!-- Date -->
                            <span class="text-xs text-muted whitespace-nowrap w-32 text-right">
                                {{ formatDate(fileModTime(file)) }}
                            </span>
                        </div>
                    </div>
                </div>

                <!-- RIGHT: Restore controls -->
                <div class="w-2/5 flex flex-col min-h-0 gap-4" data-tour="restore-controls">
                    <!-- Destination card -->
                    <div class="bg-accent rounded-lg border border-default overflow-hidden shrink-0">
                        <div class="px-3 py-2 border-b border-default">
                            <span class="text-sm font-medium text-default">Restore Destination</span>
                        </div>
                        <div class="px-3 py-2">

                        <div class="space-y-2">
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input type="radio" v-model="restoreTarget" value="server" />
                                <span class="text-sm">Restore to Server</span>
                            </label>
                            <label class="flex items-center gap-2 cursor-pointer">
                                <input type="radio" v-model="restoreTarget" value="client" />
                                <span class="text-sm">Download to this Computer</span>
                            </label>
                        </div>

                        <!-- Server destination path with autocomplete -->
                        <div v-if="restoreTarget === 'server'" class="mt-3">
                            <label v-if="restore.originalLocalPath.value" class="flex items-center gap-2 cursor-pointer mb-2">
                                <input type="checkbox" v-model="restoreToOriginalPath" />
                                <span class="text-xs text-muted">Restore to original path</span>
                            </label>

                            <template v-if="restoreToOriginalPath && restore.originalLocalPath.value">
                                <div class="text-xs text-muted bg-accent/50 rounded p-2 border border-default">
                                    Files will be restored to their original location:
                                    <strong class="text-default block mt-1">{{ restore.originalLocalPath.value }}</strong>
                                    <span class="text-danger mt-1 block">⚠ Existing files at this path will be overwritten.</span>
                                </div>
                            </template>

                            <template v-else>
                                <label class="text-xs text-muted mb-1 block">Server destination path</label>
                                <input v-model="destPath" type="text" placeholder="/data/restored"
                                    list="dest-path-suggestions"
                                    class="input-textlike w-full border border-default rounded px-2 py-1 text-sm"
                                    @input="onDestPathInput" />
                                <datalist id="dest-path-suggestions">
                                    <option v-for="s in restore.destSuggestions.value" :key="s" :value="s" />
                                </datalist>

                                <!-- Create options -->
                                <div class="mt-2 space-y-1.5">
                                    <label class="flex items-center gap-2 cursor-pointer">
                                        <input type="checkbox" v-model="createDirOnRestore" />
                                        <span class="text-xs text-muted">Create folder if it doesn't exist</span>
                                    </label>
                                    <label class="flex items-center gap-2 cursor-pointer">
                                        <input type="checkbox" v-model="createZfsDataset" />
                                        <span class="text-xs text-muted">Create as ZFS dataset</span>
                                    </label>
                                    <div v-if="createZfsDataset" class="ml-5 space-y-1">
                                        <label class="text-xs text-muted block">Parent dataset (e.g. tank/data)</label>
                                        <input v-model="zfsParentDataset" type="text" placeholder="tank/data"
                                            class="input-textlike w-full border border-default rounded px-2 py-1 text-xs" />
                                    </div>
                                </div>
                            </template>
                        </div>

                        <!-- Client destination -->
                        <div v-if="restoreTarget === 'client'" class="mt-3 space-y-2">
                            <label class="text-xs text-muted mb-1 block">Download to</label>
                            <div class="flex items-center gap-2">
                                <input :value="destPath" type="text" readonly
                                    class="input-textlike flex-1 border border-default rounded px-2 py-1 text-sm bg-default"
                                    placeholder="Choose folder…" />
                                <button class="btn btn-sm btn-outline-shadow h-fit" @click="pickLocalFolder">Browse</button>
                            </div>
                            <div class="text-xs text-muted">
                                Files will be staged on the server's SMB share, then downloaded to your machine.
                            </div>
                        </div>
                        </div>
                    </div>

                    <!-- Progress card (during restore) -->
                    <div v-if="restore.restoring.value || restore.progress.phase === 'complete'"
                        class="p-3 rounded-lg border border-default bg-accent shrink-0">
                        <h3 class="text-sm font-medium mb-2">
                            {{ restore.progress.phase === 'complete' ? 'Restore Complete' : 'Restoring…' }}
                        </h3>

                        <div v-if="restore.progress.phase !== 'complete' && restore.progress.phase !== 'error'">
                            <!-- Progress bar -->
                            <div class="w-full bg-accent rounded-full h-2 mb-2">
                                <div class="bg-primary h-2 rounded-full transition-all"
                                    :style="{ width: progressPercent + '%' }"></div>
                            </div>
                            <div class="text-xs text-muted">
                                {{ restore.progress.message || restore.progress.phase }}
                            </div>
                            <div v-if="restore.progress.currentFile" class="text-xs text-muted truncate mt-1">
                                {{ restore.progress.currentFile }}
                            </div>
                            <button class="btn btn-sm btn-ghost h-fit text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 mt-2" @click="restore.cancelRestore()">
                                Cancel
                            </button>
                        </div>

                        <div v-else-if="restore.progress.phase === 'complete'" class="text-sm text-success">
                            ✓ {{ restore.progress.message || 'Files restored successfully.' }}
                        </div>

                        <div v-else-if="restore.progress.phase === 'error'" class="text-sm text-danger">
                            ✗ {{ restore.progress.error || 'Restore failed.' }}
                        </div>
                    </div>

                    <!-- Restore summary -->
                    <div v-if="(destPath.trim() || restoreToOriginalPath) && (restore.files.value.length > 0 || restore.currentPath.value.length > 0)"
                        class="bg-accent rounded-lg border border-default p-3 text-xs space-y-1 shrink-0">
                        <div class="flex gap-2">
                            <span class="text-muted shrink-0">From:</span>
                            <span class="text-default truncate">{{ restoreSourceLabel }}</span>
                        </div>
                        <div class="flex gap-2">
                            <span class="text-muted shrink-0">To:</span>
                            <span class="text-default truncate">{{ restoreToOriginalPath && restore.originalLocalPath.value ? restore.originalLocalPath.value : destPath }}</span>
                        </div>
                        <div v-if="restore.selectedFiles.value.length > 0 && restore.selectedFiles.value.length < restore.files.value.length"
                            class="flex gap-2">
                            <span class="text-muted shrink-0">Files:</span>
                            <span class="text-default">{{ restore.selectedFiles.value.length }} of {{ restore.files.value.length }}</span>
                        </div>
                        <div v-else class="flex gap-2">
                            <span class="text-muted shrink-0">Files:</span>
                            <span class="text-default">All ({{ restore.files.value.length }})</span>
                        </div>
                    </div>

                    <!-- Info card: selection summary or single-file details -->
                    <div v-if="restore.selectedFiles.value.length > 1"
                        class="bg-accent rounded-lg border border-default overflow-hidden shrink-0">
                        <div class="px-3 py-2 border-b border-default">
                            <span class="text-sm font-medium text-default">Selection Summary</span>
                        </div>
                        <div class="px-3 py-2 space-y-2 text-sm">
                            <div class="flex justify-between gap-2">
                                <span class="text-muted">Files Selected</span>
                                <span class="text-default font-medium">{{ restore.selectedFiles.value.length }}</span>
                            </div>
                            <div class="flex justify-between gap-2">
                                <span class="text-muted">Total Size</span>
                                <span class="text-default font-medium">{{ formatSize(selectedTotalSize) }}</span>
                            </div>
                        </div>
                    </div>
                    <div v-else-if="focusedFile" class="bg-accent rounded-lg border border-default overflow-hidden shrink-0">
                        <div class="px-3 py-2 border-b border-default">
                            <span class="text-sm font-medium text-default">File Details</span>
                        </div>
                        <div class="px-3 py-2 space-y-2 text-sm">
                            <div>
                                <span class="text-muted text-xs">Name</span>
                                <p class="text-default break-all">{{ fileName(focusedFile) }}</p>
                            </div>
                            <div v-if="!isDir(focusedFile)">
                                <span class="text-muted text-xs">Size</span>
                                <p class="text-default">{{ formatSize(fileSize(focusedFile)) }}</p>
                            </div>
                            <div>
                                <span class="text-muted text-xs">Modified</span>
                                <p class="text-default">{{ formatDate(fileModTime(focusedFile)) }}</p>
                            </div>
                            <div>
                                <span class="text-muted text-xs">Type</span>
                                <p class="text-default">{{ isDir(focusedFile) ? 'Folder' : fileMimeType(focusedFile) }}</p>
                            </div>
                        </div>
                    </div>

                    <!-- Spacer to push actions to bottom -->
                    <div class="flex-1 min-h-0"></div>

                    <!-- Restore button -->
                    <button class="btn btn-primary w-full h-fit flex items-center justify-center gap-1.5 py-2.5"
                        :disabled="!canRestore" @click="onRestoreClick">
                        <ArrowDownTrayIcon class="w-4 h-4" />
                        <template v-if="restore.restoring.value">Restoring…</template>
                        <template v-else>
                            Restore
                            <template v-if="restore.selectedFiles.value.length > 0">
                                ({{ restore.selectedFiles.value.length }} files)
                            </template>
                        </template>
                    </button>
                </div>
            </div>
    </div>


    <!-- ── Confirmation dialog ──────────────────────────────────── -->
    <div v-if="confirmDialog.open" class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40"
        @keydown.esc="confirmDialog.resolve(false)">
        <div class="bg-well border border-default rounded-lg p-5 w-[26rem] shadow-xl space-y-3">
            <h3 class="text-base font-semibold text-default">{{ confirmDialog.title }}</h3>
            <p class="text-sm text-muted whitespace-pre-line">{{ confirmDialog.message }}</p>
            <div class="flex justify-end gap-2 pt-1">
                <button class="btn btn-sm btn-outline-shadow h-fit" @click="confirmDialog.resolve(false)">Cancel</button>
                <button class="btn btn-sm btn-primary h-fit" :class="confirmDialog.danger ? 'btn-danger' : 'btn-primary'"
                    @click="confirmDialog.resolve(true)">
                    {{ confirmDialog.confirmLabel || 'Continue' }}
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useRestore, type RemoteFileEntry, type ServerFileEntry, type S2STask } from '../../composables/useRestore';
import {
    ArrowLeftIcon, ArrowPathIcon, ArrowDownTrayIcon,
    FolderIcon, FolderOpenIcon, DocumentIcon,
} from '@heroicons/vue/24/outline';
import { useOnboarding } from '../../composables/useOnboarding';
import { useTourManager, type TourStep } from '../../composables/useTourManager';

const props = defineProps<{
    serverIp: string;
    username: string;
}>();

const restore = useRestore(
    () => props.serverIp,
    () => props.username,
);

// ── Guided tour ──────────────────────────────────────────────────────────
const { onboarding, markDone } = useOnboarding();
const { requestTour } = useTourManager();

const restoreTourSteps: TourStep[] = [
    {
        target: '[data-tour="restore-source-picker"]',
        message: 'Choose the backup source type here.\n\nServer-to-Server shows backups synced between servers.\nCloud Storage shows backups from rclone remotes (S3, B2, etc.).',
    },
    {
        target: '[data-tour="restore-controls"]',
        message: 'Configure where to restore files.\n\nYou can restore to the server itself or download to your local machine. Browse folders, select files, and hit Restore.',
    },
];

onMounted(() => {
    if (!onboarding.value.restoreBrowserTourDone) {
        setTimeout(() => {
            requestTour('restore-browser', restoreTourSteps, () => markDone('restoreBrowserTourDone'));
        }, 400);
    }
});

// ── Local state ──────────────────────────────────────────────────────────

const selectedRemote = ref('');
const selectedTaskName = ref('');
const restoreTarget = ref<'server' | 'client'>('server');
const destPath = ref('');
const focusedFile = ref<RemoteFileEntry | ServerFileEntry | null>(null);
const sortDir = ref<'asc' | 'desc'>('asc');
const createDirOnRestore = ref(true);
const createZfsDataset = ref(false);
const zfsParentDataset = ref('');
const restoreToOriginalPath = ref(false);

// ── Confirmation dialog state ────────────────────────────────────────────

const confirmDialog = reactive({
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Continue',
    danger: false,
    resolve: (_val: boolean) => {},
});

function showConfirm(opts: { title: string; message: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
    return new Promise((resolve) => {
        confirmDialog.open = true;
        confirmDialog.title = opts.title;
        confirmDialog.message = opts.message;
        confirmDialog.confirmLabel = opts.confirmLabel || 'Continue';
        confirmDialog.danger = opts.danger || false;
        confirmDialog.resolve = (val: boolean) => {
            confirmDialog.open = false;
            resolve(val);
        };
    });
}

// ── Init: load remotes when component mounts with valid server ───────────

watch(() => props.serverIp, async (ip) => {
    if (!ip) return;
    restore.resetBrowse();
    selectedRemote.value = '';
    selectedTaskName.value = '';
    if (restore.sourceType.value === 'cloud') {
        await restore.loadRemotes();
    } else if (restore.sourceType.value === 's2s') {
        await restore.loadS2STasks();
    }
}, { immediate: true });

// ── Event handlers ───────────────────────────────────────────────────────

function onSourceTypeChange() {
    restore.resetBrowse();
    restore.progress.phase = 'listing';
    restore.progress.operationId = '';
    selectedRemote.value = '';
    selectedTaskName.value = '';

    if (restore.sourceType.value === 'cloud') {
        restore.loadRemotes();
    } else if (restore.sourceType.value === 's2s') {
        restore.loadS2STasks();
    }
}

async function onRemoteSelected() {
    if (!selectedRemote.value) return;
    restore.currentPath.value = [];
    await restore.browseRemote(selectedRemote.value, '/');
}

async function onS2STaskSelected() {
    if (!selectedTaskName.value) return;
    const task = restore.s2sTasks.value.find(t => t.name === selectedTaskName.value);
    if (!task) return;
    restore.currentPath.value = [];
    // For push tasks, browse the remote server at the remote path (where backups land)
    // For pull tasks, browse the remote server at the remote path (where data comes from)
    await restore.browseS2SRemote(task, task.remotePath);
}

function onFileClick(file: RemoteFileEntry | ServerFileEntry) {
    focusedFile.value = file;
    if (!isDir(file)) {
        restore.toggleFileSelection(file);
    }
}

function onFileDblClick(file: RemoteFileEntry | ServerFileEntry) {
    if (isDir(file)) {
        restore.navigateInto(file);
    }
}

function onDestPathInput() {
    restore.fetchDirSuggestions(destPath.value);
}

function toggleSort() {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
}

async function pickLocalFolder() {
    const folder = await window.electron.selectFolder();
    if (folder) destPath.value = folder;
}

async function onRestoreClick() {
    if (!canRestore.value) return;

    const selCount = restore.selectedFiles.value.length;
    const totalCount = restore.files.value.length;

    // Warn if restoring everything (no selection or all selected)
    if (selCount === 0 || selCount === totalCount) {
        const confirmed = await showConfirm({
            title: 'Restore all files?',
            message: selCount === 0
                ? `No individual files are selected. This will restore ALL ${totalCount} items in the current directory.`
                : `All ${totalCount} files are selected. This will restore everything in the current directory.`,
            confirmLabel: 'Restore All',
        });
        if (!confirmed) return;
    }

    // Determine effective destination
    let effectiveDest = destPath.value;
    if (restoreTarget.value === 'server' && restoreToOriginalPath.value && restore.originalLocalPath.value) {
        effectiveDest = restore.originalLocalPath.value;
        // Warn about overwrite
        const confirmed = await showConfirm({
            title: 'Overwrite warning',
            message: `Restoring to the original path:\n${effectiveDest}\n\nExisting files at this location will be overwritten. This cannot be undone.`,
            confirmLabel: 'Overwrite & Restore',
            danger: true,
        });
        if (!confirmed) return;
    }

    // Warn about overwrite for client downloads
    if (restoreTarget.value === 'client') {
        const confirmed = await showConfirm({
            title: 'Download to this computer',
            message: `Files will be downloaded to:\n${destPath.value}\n\nIf files with the same names already exist there, they will be overwritten.`,
            confirmLabel: 'Download',
        });
        if (!confirmed) return;
    }

    // Create ZFS dataset if requested
    if (restoreTarget.value === 'server' && !restoreToOriginalPath.value && createZfsDataset.value && zfsParentDataset.value.trim()) {
        const leafName = effectiveDest.split('/').filter(Boolean).pop() || 'restored';
        const datasetName = `${zfsParentDataset.value.replace(/\/$/, '')}/${leafName}`;
        const result = await restore.createZfsDataset(datasetName, effectiveDest);
        if (!result.success) {
            restore.error.value = `Failed to create ZFS dataset: ${result.error}`;
            return;
        }
    }
    // Create directory if requested (and not creating a ZFS dataset, which handles its own mountpoint)
    else if (restoreTarget.value === 'server' && !restoreToOriginalPath.value && createDirOnRestore.value) {
        const result = await restore.createDirectory(effectiveDest);
        if (!result.success) {
            restore.error.value = `Failed to create directory: ${result.error}`;
            return;
        }
    }

    await restore.startRestore({
        destPath: effectiveDest,
        target: restoreTarget.value,
    });
}

// ── Computed ─────────────────────────────────────────────────────────────

const canRestore = computed(() => {
    if (restore.restoring.value) return false;
    // Need a destination path, unless restoring to original path
    if (restoreTarget.value === 'server' && restoreToOriginalPath.value) {
        // Just need files browsed
        if (restore.files.value.length === 0 && restore.currentPath.value.length === 0) return false;
        return true;
    }
    if (!destPath.value.trim()) return false;
    // Allow restore of entire directory (no individual selection required)
    if (restore.files.value.length === 0 && restore.currentPath.value.length === 0) return false;
    return true;
});

const progressPercent = computed(() => {
    const p = restore.progress;
    if (p.bytesTotal && p.bytesTotal > 0 && p.bytesProcessed != null) {
        return Math.min(100, Math.round((p.bytesProcessed / p.bytesTotal) * 100));
    }
    if (p.filesTotal && p.filesTotal > 0 && p.filesProcessed != null) {
        return Math.min(100, Math.round((p.filesProcessed / p.filesTotal) * 100));
    }
    return 0;
});

const selectedTotalSize = computed(() =>
    restore.selectedFiles.value.reduce((sum, f) => sum + fileSize(f), 0)
);

const sortedFiles = computed(() => {
    const sorted = [...restore.files.value];
    sorted.sort((a, b) => {
        const aIsDir = isDir(a);
        const bIsDir = isDir(b);
        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;

        const aName = fileName(a).toLowerCase();
        const bName = fileName(b).toLowerCase();
        const cmp = aName.localeCompare(bName);
        return sortDir.value === 'asc' ? cmp : -cmp;
    });
    return sorted;
});

const restoreSourceLabel = computed(() => {
    const navPath = restore.pathString.value;
    if (restore.sourceType.value === 'cloud') {
        return `${restore.currentRemote.value}${navPath}`;
    }
    if (restore.sourceType.value === 's2s' && restore.selectedS2STask.value) {
        const task = restore.selectedS2STask.value;
        const basePath = task.direction === 'push' ? task.remotePath : task.localPath;
        const fullPath = basePath.replace(/\/$/, '') + navPath;
        return `${task.remoteUser}@${task.remoteHost}:${fullPath}`;
    }
    return navPath;
});

// ── Helpers ──────────────────────────────────────────────────────────────

type AnyFile = RemoteFileEntry | ServerFileEntry;

function isDir(f: AnyFile): boolean {
    return 'IsDir' in f ? f.IsDir : f.isDir;
}
function fileName(f: AnyFile): string {
    return 'Name' in f ? f.Name : f.name;
}
function fileSize(f: AnyFile): number {
    return 'Size' in f ? f.Size : f.size;
}
function fileModTime(f: AnyFile): string {
    return 'ModTime' in f ? f.ModTime : f.modTime;
}
function fileMimeType(f: AnyFile): string {
    return 'MimeType' in f ? (f as RemoteFileEntry).MimeType : 'file';
}

function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatDate(d: string | number): string {
    if (!d) return '—';
    try {
        const date = typeof d === 'number' ? new Date(d * 1000) : new Date(d);
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
            + ' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch {
        return String(d);
    }
}
</script>
