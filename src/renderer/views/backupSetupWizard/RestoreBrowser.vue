<template>
    <div class="h-full flex flex-col min-h-0">
        <!-- Source type selector + path breadcrumb -->
        <div class="px-3 py-2 border-b border-default flex items-center gap-3 shrink-0">
            <select v-model="restore.sourceType.value"
                class="input-textlike border border-default rounded px-2 py-1 text-sm min-w-[140px]"
                @change="onSourceTypeChange">
                <option value="cloud">Cloud Storage</option>
                <option value="s2s">Server-to-Server Backups</option>
                <option value="snapshot">Snapshots</option>
            </select>

            <!-- Cloud: remote picker -->
            <template v-if="restore.sourceType.value === 'cloud'">
                <select v-model="selectedRemote"
                    class="input-textlike border border-default rounded px-2 py-1 text-sm min-w-[160px]"
                    @change="onRemoteSelected">
                    <option value="">Select remote…</option>
                    <option v-for="r in restore.remotes.value" :key="r.name" :value="r.name">
                        {{ r.name }} ({{ r.type }})
                    </option>
                </select>
            </template>

            <!-- S2S: task picker -->
            <template v-if="restore.sourceType.value === 's2s'">
                <select v-model="selectedTaskName"
                    class="input-textlike border border-default rounded px-2 py-1 text-sm min-w-[200px]"
                    @change="onS2STaskSelected">
                    <option value="">Select backup task…</option>
                    <option v-for="t in restore.s2sTasks.value" :key="t.name" :value="t.name">
                        {{ t.name }} — {{ t.direction === 'push' ? `→ ${t.remoteHost}:${t.remotePath}` : `← ${t.remoteHost}:${t.remotePath}` }}
                    </option>
                </select>
            </template>

            <!-- Breadcrumb -->
            <div v-if="restore.files.value.length > 0 || restore.currentPath.value.length > 0"
                class="flex items-center gap-1 text-sm text-muted ml-2 overflow-x-auto">
                <button v-for="(crumb, i) in restore.breadcrumb.value" :key="i"
                    class="hover:text-default transition-colors whitespace-nowrap"
                    @click="restore.navigateToBreadcrumb(i)">
                    {{ crumb }}
                </button>
                <template v-if="restore.breadcrumb.value.length > 1">
                    <span class="mx-1 text-muted/50">/</span>
                </template>
            </div>

            <div class="flex-1" />

            <!-- Refresh -->
            <button v-if="restore.sourceType.value === 'cloud' || restore.sourceType.value === 's2s'"
                class="btn btn-secondary text-sm h-fit"
                :disabled="restore.loading.value"
                @click="restore.sourceType.value === 'cloud' ? restore.loadRemotes() : restore.loadS2STasks()">
                <ArrowPathIcon class="w-4 h-4" />
            </button>
        </div>

        <!-- Error banner -->
        <div v-if="restore.error.value" class="mx-3 mt-2 p-2 bg-danger/10 border border-danger/30 rounded text-sm text-danger">
            {{ restore.error.value }}
        </div>

        <!-- ── SNAPSHOT mode ────────────────────────────────────────── -->
        <template v-if="restore.sourceType.value === 'snapshot'">
            <div class="flex-1 min-h-0 flex gap-4 p-3">
                <!-- Dataset list -->
                <div class="w-2/5 flex flex-col min-h-0 bg-well rounded-lg border border-default overflow-hidden">
                    <div class="px-3 py-2 border-b border-default text-sm font-medium">ZFS Datasets</div>
                    <div v-if="restore.loading.value" class="flex-1 flex items-center justify-center">
                        <div class="spinner"></div>
                    </div>
                    <div v-else-if="restore.datasets.value.length === 0"
                        class="flex-1 flex items-center justify-center text-muted text-sm">
                        No datasets found.
                    </div>
                    <div v-else class="flex-1 overflow-y-auto">
                        <div v-for="ds in restore.datasets.value" :key="ds.name"
                            class="px-3 py-2 border-b border-default cursor-pointer transition-colors"
                            :class="selectedDataset === ds.name ? 'bg-primary/10' : 'hover:bg-accent'"
                            @click="onDatasetSelected(ds.name)">
                            <div class="text-sm font-medium text-default">{{ ds.name }}</div>
                            <div class="text-xs text-muted">{{ ds.mountpoint }} — {{ ds.used }} used, {{ ds.available }} free</div>
                        </div>
                    </div>
                </div>

                <!-- Snapshot list -->
                <div class="w-3/5 flex flex-col min-h-0 bg-well rounded-lg border border-default overflow-hidden">
                    <div class="px-3 py-2 border-b border-default flex items-center justify-between">
                        <span class="text-sm font-medium">
                            {{ selectedDataset ? `Snapshots for ${selectedDataset}` : 'Select a dataset' }}
                        </span>
                    </div>
                    <div v-if="!selectedDataset"
                        class="flex-1 flex items-center justify-center text-muted text-sm">
                        Select a dataset to view its snapshots.
                    </div>
                    <div v-else-if="restore.loading.value" class="flex-1 flex items-center justify-center">
                        <div class="spinner"></div>
                    </div>
                    <div v-else-if="restore.snapshots.value.length === 0"
                        class="flex-1 flex items-center justify-center text-muted text-sm">
                        No snapshots found.
                    </div>
                    <div v-else class="flex-1 overflow-y-auto">
                        <div v-for="snap in restore.snapshots.value" :key="snap.name"
                            class="px-3 py-2 border-b border-default flex items-center justify-between hover:bg-accent transition-colors">
                            <div>
                                <div class="text-sm font-medium text-default">{{ snap.snapName }}</div>
                                <div class="text-xs text-muted">{{ snap.creation }} — {{ snap.used }} used, {{ snap.referenced }} referenced</div>
                            </div>
                            <button class="btn btn-danger text-xs h-fit" :disabled="restore.restoring.value"
                                @click="confirmRollback(snap)">
                                Rollback
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </template>

        <!-- ── CLOUD / SERVER mode: file browser ────────────────────── -->
        <template v-else>
            <div class="flex-1 min-h-0 flex gap-4 p-3">
                <!-- LEFT: File list -->
                <div class="w-3/5 flex flex-col min-h-0 bg-well rounded-lg border border-default overflow-hidden">
                    <div class="px-3 py-2 border-b border-default flex items-center justify-between shrink-0">
                        <span class="text-sm font-medium text-default">Files</span>
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
                    <div v-else class="flex-1 overflow-y-auto">
                        <div v-for="(file, index) in restore.files.value" :key="index"
                            class="flex items-center gap-3 px-3 py-2 border-b border-default cursor-pointer transition-colors"
                            :class="file.selected ? 'bg-primary/10' : 'hover:bg-accent'"
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
                <div class="w-2/5 flex flex-col gap-3 min-h-0">
                    <!-- Destination card -->
                    <div class="bg-well rounded-lg border border-default p-3">
                        <h3 class="text-sm font-medium mb-2">Restore Destination</h3>

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

                        <!-- Server destination path -->
                        <div v-if="restoreTarget === 'server'" class="mt-3">
                            <label class="text-xs text-muted mb-1 block">Server destination path</label>
                            <input v-model="destPath" type="text" placeholder="/data/restored"
                                class="input-textlike w-full border border-default rounded px-2 py-1 text-sm" />
                        </div>

                        <!-- Client destination -->
                        <div v-if="restoreTarget === 'client'" class="mt-3 space-y-2">
                            <label class="text-xs text-muted mb-1 block">Download to</label>
                            <div class="flex items-center gap-2">
                                <input :value="destPath" type="text" readonly
                                    class="input-textlike flex-1 border border-default rounded px-2 py-1 text-sm bg-well"
                                    placeholder="Choose folder…" />
                                <button class="btn btn-secondary text-sm h-fit" @click="pickLocalFolder">Browse</button>
                            </div>
                            <div class="text-xs text-muted">
                                Files will be staged on the server's SMB share, then downloaded to your machine.
                            </div>
                        </div>
                    </div>

                    <!-- Progress card (during restore) -->
                    <div v-if="restore.restoring.value || restore.progress.phase === 'complete'"
                        class="bg-well rounded-lg border border-default p-3">
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
                            <button class="btn btn-danger text-xs h-fit mt-2" @click="restore.cancelRestore()">
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

                    <!-- Restore button -->
                    <button class="btn btn-primary text-sm h-fit w-full flex items-center justify-center gap-2"
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

                    <!-- Info card: selection summary or single-file details -->
                    <div v-if="restore.selectedFiles.value.length > 1"
                        class="bg-well rounded-lg border border-default p-3 flex-1 overflow-y-auto">
                        <h3 class="text-sm font-medium mb-2">Selection</h3>
                        <dl class="text-xs space-y-1">
                            <div class="flex justify-between">
                                <dt class="text-muted">Files selected</dt>
                                <dd class="text-default">{{ restore.selectedFiles.value.length }}</dd>
                            </div>
                            <div class="flex justify-between">
                                <dt class="text-muted">Total size</dt>
                                <dd class="text-default">{{ formatSize(selectedTotalSize) }}</dd>
                            </div>
                        </dl>
                    </div>
                    <div v-else-if="focusedFile" class="bg-well rounded-lg border border-default p-3 flex-1 overflow-y-auto">
                        <h3 class="text-sm font-medium mb-2">Details</h3>
                        <dl class="text-xs space-y-1">
                            <div class="flex justify-between">
                                <dt class="text-muted">Name</dt>
                                <dd class="text-default truncate ml-4">{{ fileName(focusedFile) }}</dd>
                            </div>
                            <div class="flex justify-between">
                                <dt class="text-muted">Size</dt>
                                <dd class="text-default">{{ formatSize(fileSize(focusedFile)) }}</dd>
                            </div>
                            <div class="flex justify-between">
                                <dt class="text-muted">Modified</dt>
                                <dd class="text-default">{{ formatDate(fileModTime(focusedFile)) }}</dd>
                            </div>
                            <div class="flex justify-between">
                                <dt class="text-muted">Type</dt>
                                <dd class="text-default">{{ isDir(focusedFile) ? 'Folder' : fileMimeType(focusedFile) }}</dd>
                            </div>
                        </dl>
                    </div>
                </div>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRestore, type RemoteFileEntry, type ServerFileEntry, type ZfsSnapshot, type S2STask } from '../../composables/useRestore';
import {
    ArrowLeftIcon, ArrowPathIcon, ArrowDownTrayIcon,
    FolderIcon, FolderOpenIcon, DocumentIcon,
} from '@heroicons/vue/24/outline';

const props = defineProps<{
    serverIp: string;
    username: string;
}>();

const restore = useRestore(
    () => props.serverIp,
    () => props.username,
);

// ── Local state ──────────────────────────────────────────────────────────

const selectedRemote = ref('');
const selectedTaskName = ref('');
const restoreTarget = ref<'server' | 'client'>('server');
const destPath = ref('');
const focusedFile = ref<RemoteFileEntry | ServerFileEntry | null>(null);
const selectedDataset = ref('');

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
    } else if (restore.sourceType.value === 'snapshot') {
        await restore.loadDatasets();
    }
}, { immediate: true });

// ── Event handlers ───────────────────────────────────────────────────────

function onSourceTypeChange() {
    restore.resetBrowse();
    selectedRemote.value = '';
    selectedTaskName.value = '';
    selectedDataset.value = '';

    if (restore.sourceType.value === 'cloud') {
        restore.loadRemotes();
    } else if (restore.sourceType.value === 's2s') {
        restore.loadS2STasks();
    } else if (restore.sourceType.value === 'snapshot') {
        restore.loadDatasets();
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

async function onDatasetSelected(name: string) {
    selectedDataset.value = name;
    await restore.loadSnapshots(name);
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

async function pickLocalFolder() {
    const folder = await window.electron.selectFolder();
    if (folder) destPath.value = folder;
}

async function confirmRollback(snap: ZfsSnapshot) {
    const ok = window.confirm(
        `Are you sure you want to rollback "${snap.dataset}" to snapshot "${snap.snapName}"?\n\n` +
        `This will DESTROY all data created after this snapshot. This cannot be undone.`
    );
    if (!ok) return;
    await restore.rollbackSnapshot(snap.name);
}

async function onRestoreClick() {
    if (!canRestore.value) return;
    await restore.startRestore({
        destPath: destPath.value,
        target: restoreTarget.value,
        smbSharePath: restoreTarget.value === 'client' ? destPath.value : undefined,
    });
}

// ── Computed ─────────────────────────────────────────────────────────────

const canRestore = computed(() => {
    if (restore.restoring.value) return false;
    if (!destPath.value.trim()) return false;
    // In file-browse mode, need files selected or navigated into a folder
    if (restore.sourceType.value !== 'snapshot') {
        // Allow restore of entire directory (no individual selection required)
        if (restore.files.value.length === 0 && restore.currentPath.value.length === 0) return false;
    }
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
