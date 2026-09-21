<template>
    <div class="h-full flex flex-col min-h-0 overflow-hidden p-4 ui-texture-surface ui-texture-surface--soft">
        <!-- Header -->
        <div class="flex items-center justify-between mb-3 shrink-0">
            <div class="flex items-center gap-3">
                <button class="btn btn-sm btn-secondary h-fit flex items-center gap-1.5 text-gray-500 hover:text-default" @click="proceedToPreviousStep">
                    <ArrowLeftIcon class="w-4 h-4" />
                    Backups
                </button>
                <h2 class="text-sm font-semibold text-default">Backup Browser</h2>
            </div>
            <!-- Backup selector (multi-backup mode) -->
            <div v-if="!singleMode" class="flex items-center gap-2" data-tour="backup-selector">
                <label class="text-sm text-muted">Backup:</label>
                <select
                    class="bg-well border border-default rounded px-2 py-1 text-sm text-default min-w-[200px]"
                    :value="selectedBackup?.uuid ?? ''"
                    @change="onBackupDropdownChange($event)">
                    <option value="" disabled>Select a backup…</option>
                    <option v-for="b in filteredBackups" :key="b.uuid" :value="b.uuid">
                        {{ b.folder }} ({{ b.client }} → {{ b.server }})
                    </option>
                </select>
                <div class="flex items-center gap-1 ml-2">
                    <MagnifyingGlassIcon class="w-4 h-4 text-muted shrink-0" />
                    <input v-model="search" type="text" placeholder="Filter…"
                        class="w-32 bg-well border border-default rounded px-2 py-1 text-sm text-default placeholder:text-muted outline-none" />
                </div>
            </div>
        </div>

        <!-- Main two-column content -->
        <div class="flex-1 min-h-0 flex gap-4">
            <!-- LEFT: Files in backup -->
            <div class="w-3/5 flex flex-col min-h-0 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden" data-tour="file-panel">
                <!-- File panel header -->
                <div class="px-3 py-2 border-b border-default shrink-0 flex flex-col gap-1.5">
                    <span class="text-sm font-medium text-default truncate block w-full text-left"
                        :title="selectedBackup ? selectedBackup.folder : ''">
                        {{ selectedBackup ? `Files in "${selectedBackup.folder}"` : 'Select a backup to browse files' }}
                    </span>
                    <div v-if="selectedBackup" class="flex items-center gap-2">
                        <button class="text-xs text-muted hover:text-default transition-colors" @click="selectAll">
                            Select All
                        </button>
                        <span class="text-muted">|</span>
                        <button class="text-xs text-muted hover:text-default transition-colors" @click="deselectAll">
                            Deselect All
                        </button>
                        <span v-if="selectedFilesCount > 0"
                            class="ml-auto text-xs bg-primary text-white px-2 py-0.5 rounded-full shrink-0">
                            {{ selectedFilesCount }} selected
                        </span>
                    </div>
                </div>

                <!-- No backup selected -->
                <div v-if="!selectedBackup" class="flex-1 flex flex-col items-center justify-center text-muted gap-2 p-4">
                    <DocumentMagnifyingGlassIcon class="w-10 h-10 opacity-30" />
                    <p class="text-sm">{{ singleMode ? 'Loading backup…' : 'Select a backup above to view its files.' }}</p>
                </div>

                <!-- Loading files -->
                <div v-else-if="filesLoading" class="flex-1 flex items-center justify-center">
                    <div class="spinner"></div>
                </div>

                <!-- Empty file list -->
                <div v-else-if="!selectedBackup.files || selectedBackup.files.length === 0"
                    class="flex-1 flex flex-col items-center justify-center text-muted gap-2 p-4">
                    <DocumentIcon class="w-10 h-10 opacity-30" />
                    <p class="text-sm">No files found in this backup.</p>
                </div>

                <!-- File list -->
                <div v-else class="flex-1 overflow-y-auto">
                    <template v-for="node in fileTree" :key="node.key">
                        <!-- Folder row -->
                        <div v-if="node.type === 'folder'"
                            class="flex items-center gap-2 px-3 py-1.5 border-b border-neutral-100 dark:border-neutral-700/50 cursor-pointer transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-700/30"
                            :style="{ paddingLeft: `${node.depth * 20 + 12}px` }"
                            @click="toggleFolder(node.key)">
                            <input type="checkbox" class="shrink-0"
                                :checked="node.fileCount > 0 && node.selectedCount === node.fileCount"
                                :ref="(el) => setFolderCheckboxRef(el, node)"
                                @click.stop="toggleFolderSelection(node)" />
                            <ChevronRightIcon v-if="collapsedFolders.has(node.key)" class="w-3.5 h-3.5 text-muted shrink-0" />
                            <ChevronDownIcon v-else class="w-3.5 h-3.5 text-muted shrink-0" />
                            <FolderIcon class="w-4 h-4 text-primary shrink-0" />
                            <span class="text-sm text-default truncate font-medium" :title="node.name">{{ node.name }}</span>
                            <span class="ml-auto text-xs text-muted shrink-0">
                                {{ node.selectedCount > 0 ? `${node.selectedCount}/` : '' }}{{ node.fileCount }} file{{ node.fileCount === 1 ? '' : 's' }}
                            </span>
                        </div>

                        <!-- File row -->
                        <div v-else
                            class="flex items-center gap-3 px-3 py-1.5 border-b border-neutral-100 dark:border-neutral-700/50 cursor-pointer transition-colors border-l-2"
                            :style="{ paddingLeft: `${node.depth * 20 + 12}px` }"
                            :class="[
                                node.file?.selected ? 'bg-slate-600/5 dark:bg-slate-400/5 border-l-slate-600 dark:border-l-slate-400' : 'border-l-transparent hover:bg-neutral-50 dark:hover:bg-neutral-700/30',
                                focusedFile === node.file ? 'ring-1 ring-inset ring-slate-500' : ''
                            ]"
                            @click="onFileClick(node.file)">
                            <input type="checkbox" v-model="node.file.selected" class="shrink-0" @click.stop />
                            <DocumentIcon class="w-4 h-4 text-muted shrink-0" />
                            <span class="text-sm text-default truncate" :title="node.file.path">{{ node.name }}</span>
                            <span v-if="node.file.size != null" class="ml-auto text-xs text-muted shrink-0">{{ formatFileSize(node.file.size) }}</span>
                        </div>
                    </template>
                </div>
            </div>

            <!-- RIGHT: Info & restore controls -->
            <div class="w-2/5 flex flex-col min-h-0 gap-4">
                <!-- Backup info card -->
                <div v-if="selectedBackup" class="bg-accent rounded-lg border border-default overflow-hidden shrink-0">
                    <div class="px-3 py-2 border-b border-default">
                        <span class="text-sm font-medium text-default">Backup Info</span>
                    </div>
                    <div class="px-3 py-2 space-y-2 text-sm">
                        <div class="flex justify-between gap-2">
                            <span class="text-muted shrink-0">Server</span>
                            <span class="text-default text-right truncate" :title="selectedBackup.server">{{ selectedBackup.server || '—' }}</span>
                        </div>
                        <div class="flex justify-between gap-2">
                            <span class="text-muted shrink-0">Source (Client)</span>
                            <span class="text-default text-right truncate" :title="selectedBackup.client">{{ selectedBackup.client || '—' }}</span>
                        </div>
                        <div class="flex justify-between gap-2">
                            <span class="text-muted shrink-0">Destination</span>
                            <span class="text-default text-right truncate" :title="selectedBackup.folder">{{ selectedBackup.folder || '—' }}</span>
                        </div>
                        <div v-if="selectedBackup.__task?.smb_user" class="flex justify-between gap-2">
                            <span class="text-muted shrink-0">Server User</span>
                            <span class="text-default text-right truncate"
                                :title="selectedBackup.__task.smb_user">{{ selectedBackup.__task.smb_user }}</span>
                        </div>
                        <div v-if="selectedBackup.__task?.share" class="flex justify-between gap-2">
                            <span class="text-muted shrink-0">Share</span>
                            <span class="text-default text-right truncate"
                                :title="selectedBackup.__task.share">{{ selectedBackup.__task.share }}</span>
                        </div>
                        <div v-if="selectedBackup.lastBackup" class="flex justify-between gap-2">
                            <span class="text-muted shrink-0">Last Backup</span>
                            <span class="text-default text-right">{{ selectedBackup.lastBackup }}</span>
                        </div>
                        <div class="flex justify-between gap-2">
                            <span class="text-muted shrink-0">Status</span>
                            <span class="text-right text-xs font-medium px-1.5 py-0.5 rounded"
                                :class="backupStatusClass">
                                {{ backupStatusLabel }}
                            </span>
                        </div>
                        <div class="flex justify-between gap-2">
                            <span class="text-muted shrink-0">Total Files</span>
                            <span class="text-default text-right">{{ selectedBackup.files?.length ?? 0 }}</span>
                        </div>
                    </div>
                </div>

                <!-- Multi-file selection summary -->
                <div v-if="selectedFilesCount > 1" class="bg-accent rounded-lg border border-default overflow-hidden shrink-0">
                    <div class="px-3 py-2 border-b border-default">
                        <span class="text-sm font-medium text-default">Selection Summary</span>
                    </div>
                    <div class="px-3 py-2 space-y-2 text-sm">
                        <div class="flex justify-between gap-2">
                            <span class="text-muted">Files Selected</span>
                            <span class="text-default font-medium">{{ selectedFilesCount }}</span>
                        </div>
                        <div class="flex justify-between gap-2">
                            <span class="text-muted">Total Size</span>
                            <span class="text-default font-medium">{{ formatFileSize(selectedTotalSize) }}</span>
                        </div>
                    </div>
                </div>

                <!-- Single file details card -->
                <div v-if="focusedFile && selectedFilesCount <= 1" class="bg-accent rounded-lg border border-default overflow-hidden shrink-0">
                    <div class="px-3 py-2 border-b border-default">
                        <span class="text-sm font-medium text-default">File Details</span>
                    </div>
                    <div class="px-3 py-2 space-y-2 text-sm">
                        <div>
                            <span class="text-muted text-xs">File Path</span>
                            <p class="text-default break-all">{{ focusedFile.path }}</p>
                        </div>
                        <div>
                            <span class="text-muted text-xs">Backup Location</span>
                            <p class="text-default break-all text-xs">{{ selectedBackup?.folder }}/{{ focusedFile.path }}</p>
                        </div>
                        <div>
                            <span class="text-muted text-xs">Restores To</span>
                            <p class="text-default break-all text-xs">{{ resolveRestorePath(focusedFile.path) }}</p>
                        </div>
                        <div v-if="focusedFile.size != null" class="flex justify-between gap-2">
                            <span class="text-muted">Size</span>
                            <span class="text-default">{{ formatFileSize(focusedFile.size) }}</span>
                        </div>
                        <div v-if="focusedFile.mtime" class="flex justify-between gap-2">
                            <span class="text-muted">Last Modified</span>
                            <span class="text-default text-right">{{ formatTimestamp(focusedFile.mtime) }}</span>
                        </div>
                        <div v-if="focusedFile.atime" class="flex justify-between gap-2">
                            <span class="text-muted">Last Accessed</span>
                            <span class="text-default text-right">{{ formatTimestamp(focusedFile.atime) }}</span>
                        </div>
                        <div v-if="focusedFile.birthtime" class="flex justify-between gap-2">
                            <span class="text-muted">Created</span>
                            <span class="text-default text-right">{{ formatTimestamp(focusedFile.birthtime) }}</span>
                        </div>
                    </div>
                </div>

                <!-- No file focused placeholder -->
                <div v-else-if="selectedFilesCount === 0 && selectedBackup && !filesLoading && selectedBackup.files?.length"
                    class="bg-well rounded-lg border border-default p-4 flex flex-col items-center justify-center text-muted gap-2">
                    <InformationCircleIcon class="w-8 h-8 opacity-30" />
                    <p class="text-sm text-center">Click a file to view its details</p>
                </div>

                <!-- Spacer to push actions to bottom -->
                <div class="flex-1 min-h-0"></div>

                <!-- Restore progress -->
                <div v-if="isRestoring"
                    class="p-3 rounded-lg border border-default bg-accent shrink-0">
                    <div class="flex items-center justify-between text-sm mb-1">
                        <span class="text-default">Restoring {{ restoreProgress.current + 1 }}/{{ restoreProgress.total }}…</span>
                        <span class="text-muted text-xs shrink-0 ml-2">{{ activeFilePercent }}%</span>
                    </div>
                    <p class="text-xs text-muted truncate mb-2" :title="restoreProgress.lastFile">
                        {{ activeFileName || restoreProgress.lastFile }}
                    </p>
                    <div class="w-full h-2 bg-well rounded-full overflow-hidden">
                        <div class="h-full bg-primary rounded-full transition-all"
                            :style="{ width: `${activeFilePercent}%` }" />
                    </div>
                    <div v-if="restoreProgress.totalBytes > 0" class="flex justify-between text-xs text-muted mt-1">
                        <span>{{ formatFileSize(restoreProgress.copiedBytes) }} / {{ formatFileSize(restoreProgress.totalBytes) }}</span>
                        <span>{{ restoreProgress.current }} of {{ restoreProgress.total }} done</span>
                    </div>
                    <button class="btn btn-sm btn-outline-shadow h-fit w-full mt-2"
                        :disabled="restoreProgress.cancelling" @click="cancelRestore">
                        {{ restoreProgress.cancelling ? 'Stopping…' : 'Cancel Restore' }}
                    </button>
                </div>

                <!-- Restore finished -->
                <div v-if="!isRestoring && restoreProgress.finishedAt !== null"
                    class="p-3 rounded-lg border border-default bg-accent shrink-0 text-sm text-center"
                    :class="restoreProgress.cancelled ? 'text-amber-600 dark:text-amber-400' : 'text-default'">
                    <template v-if="restoreProgress.cancelled">
                        Restore cancelled after {{ restoreProgress.current }} of {{ restoreProgress.total }} file(s).
                    </template>
                    <template v-else>
                        Restored {{ restoreProgress.current }} of {{ restoreProgress.total }} file(s).
                    </template>
                    <button v-if="!showOpenFolderPrompt" class="btn btn-sm btn-secondary h-fit mt-2 w-full"
                        @click="dismissRestoreResult">Dismiss</button>
                </div>

                <!-- Open restored folders prompt -->
                <div v-if="showOpenFolderPrompt"
                    class="p-3 rounded-lg border border-default bg-accent shrink-0">
                    <p class="text-sm text-default mb-2 text-center">
                        Restore complete. Open the restored folder{{ restoredFolders.length > 1 ? 's' : '' }}?
                    </p>
                    <div class="flex items-center justify-center gap-2">
                        <button class="btn btn-sm btn-primary h-fit flex items-center gap-1.5" @click="openRestoredFolders">
                            <FolderOpenIcon class="w-4 h-4" />
                            Open {{ restoredFolders.length > 1 ? 'All' : 'Folder' }}
                        </button>
                        <button class="btn btn-sm btn-secondary h-fit" @click="dismissRestoreResult">Dismiss</button>
                    </div>
                </div>

                <!-- Action buttons -->
                <div v-if="selectedBackup" class="shrink-0 flex flex-col gap-2" data-tour="restore-actions">
                    <button class="btn btn-primary w-full h-fit flex items-center justify-center gap-1.5 py-2.5"
                        :disabled="selectedFilesCount === 0 || isRestoring"
                        @click="restoreSelected">
                        <ArrowDownTrayIcon class="w-4 h-4" />
                        {{ isRestoring ? 'Restore in progress…' : `Restore Selected (${selectedFilesCount})` }}
                    </button>
                    <div class="flex gap-2">
                        <button class="btn btn-sm btn-outline-shadow flex-1 h-fit flex items-center justify-center gap-1.5"
                            @click="openSelectedBackupFolder">
                            <FolderOpenIcon class="w-4 h-4" />
                            Open Folder
                        </button>
                        <button class="btn btn-sm btn-secondary flex-1 h-fit flex items-center justify-center gap-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                            @click="deleteSingleBackup">
                            <TrashIcon class="w-4 h-4" />
                            Delete
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onUnmounted, onMounted, watch } from 'vue'
import { confirm, useEnterToAdvance } from '@45drives/houston-common-ui'
import { IPCRouter, type BackupEntry, type FileEntry, type BackUpTask } from '@45drives/houston-common-lib'
import { useRouter } from 'vue-router'
import { useHeader } from '../../composables/useHeader'
import {
    ArrowLeftIcon, FolderOpenIcon, TrashIcon, ArrowDownTrayIcon,
    MagnifyingGlassIcon, DocumentIcon, DocumentMagnifyingGlassIcon,
    InformationCircleIcon, FolderIcon, ChevronRightIcon, ChevronDownIcon
} from '@heroicons/vue/24/outline'
import { useOnboarding } from '../../composables/useOnboarding'
import { useRestoreProgress } from '../../composables/useRestoreProgress'
import { useTourManager, type TourStep } from '../../composables/useTourManager'
useHeader('View Selected Backups')
const router = useRouter();

const { onboarding, markDone } = useOnboarding();
const { requestTour } = useTourManager();

const browserTourSteps: TourStep[] = [
    {
        target: '[data-tour="file-panel"]',
        message: 'This panel shows all files in the selected backup.\n\nClick files to select them, or use the Select All / Deselect All buttons at the top.',
    },
    {
        target: '[data-tour="restore-actions"]',
        message: 'Use these buttons to restore selected files, open the backup folder on disk, or delete the entire backup.\n\nRestored files go back to their original locations.',
    },
];

onMounted(() => {
    if (!onboarding.value.backupBrowserTourDone) {
        setTimeout(() => {
            requestTour('backup-browser', browserTourSteps, () => markDone('backupBrowserTourDone'));
        }, 600);
    }
});

// Extended file entry with metadata from the backend
interface RichFileEntry extends FileEntry {
    /** Original path relative to UUID folder (includes hostname prefix), used for restore */
    rawPath: string;
    size?: number;
    mtime?: string;
    atime?: string;
    birthtime?: string;
}

// Extended BackupEntry using rich files
type RichBackupEntry = Omit<BackupEntry, 'files'> & { files: RichFileEntry[]; __task?: BackUpTask }

const props = defineProps<{
    ids?: string[];
    tasks?: BackUpTask[];
}>()

// Wizard back button
const proceedToPreviousStep = () => router.push({ name: 'backup-manage' })

// UI state
const loading = ref<boolean>(false)
const filesLoading = ref<boolean>(false)
const search = ref('')
const focusedFile = ref<RichFileEntry | null>(null)

// Backups (derived from the provided tasks), plus runtime fields
const backups = ref<RichBackupEntry[]>([])
const selectedBackup = ref<RichBackupEntry | null>(null)

// Multi-select map for delete
const multiSelectedMap = ref<Record<string, boolean>>({})
const multiSelectedUuids = computed(() => Object.entries(multiSelectedMap.value).filter(([, v]) => v).map(([k]) => k))

const filteredBackups = computed(() => {
    const q = search.value.toLowerCase()
    return backups.value.filter(b =>
        `${b.folder} ${b.client} ${b.server}`.toLowerCase().includes(q)
    )
})

const selectedFilesCount = computed(() => selectedBackup.value?.files?.filter(f => f.selected).length ?? 0)

const selectedTotalSize = computed(() => {
    if (!selectedBackup.value) return 0
    return selectedBackup.value.files
        .filter(f => f.selected)
        .reduce((sum, f) => sum + (f.size ?? 0), 0)
})

// Derive a meaningful status label — if files loaded successfully, the connection is working
const backupStatusLabel = computed(() => {
    const task = selectedBackup.value?.__task
    if (!task) return '—'
    const s = task.status
    if (!s || s === 'checking') {
        // If we already have files, the connection clearly worked
        if (selectedBackup.value?.files?.length) return 'Connected'
        if (filesLoading.value) return 'Connecting…'
        return 'Unknown'
    }
    const labels: Record<string, string> = {
        online: 'Online',
        offline_unreachable: 'Unreachable',
        offline_invalid_credentials: 'Login Failed — Check Username/Password',
        offline_connection_error: 'Connection Error',
        missing_folder: 'Missing Folder',
        offline_insufficient_permissions: 'Insufficient Permissions',
    }
    return labels[s] ?? s
})

const backupStatusClass = computed(() => {
    const task = selectedBackup.value?.__task
    const s = task?.status
    if (!s || s === 'checking') {
        if (selectedBackup.value?.files?.length) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
        if (filesLoading.value) return 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-400'
        return 'bg-neutral-100 text-neutral-600 dark:bg-neutral-500/20 dark:text-neutral-400'
    }
    if (s === 'online') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
    return 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400'
})

// Single-backup mode: skip the backup dropdown
const singleMode = computed(() => backups.value.length === 1)

function onFileClick(file: RichFileEntry) {
    focusedFile.value = file
    file.selected = !file.selected
}

function onBackupDropdownChange(event: Event) {
    const uuid = (event.target as HTMLSelectElement).value
    const backup = backups.value.find(b => b.uuid === uuid)
    if (backup) selectBackup(backup)
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatTimestamp(iso: string): string {
    try {
        return new Date(iso).toLocaleString()
    } catch {
        return iso
    }
}

/**
 * Strip the hostname prefix from a backup file path.
 * Backend returns paths relative to the UUID folder: "hostname/actual/path/file.ext"
 * We want to display just the actual path portion.
 * The client source (e.g. "/home/user/Pictures") tells us what the real path looks like.
 */
function stripHostnamePrefix(rawPath: string, clientSource: string): string {
    // Normalise separators
    const p = rawPath.replace(/\\/g, '/')
    const parts = p.split('/').filter(Boolean)
    if (parts.length < 2) return p

    // The first segment is the hostname directory.
    // Everything after that is the absolute source path + filename.
    // Strip the hostname prefix to get the real file path.
    const withoutHost = parts.slice(1).join('/')

    // If clientSource is present, also strip it to show only the relative part
    const normClient = clientSource.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
    if (normClient && withoutHost.startsWith(normClient)) {
        const rel = withoutHost.slice(normClient.length).replace(/^\/+/, '')
        return rel || withoutHost
    }

    return withoutHost
}

function resolveRestorePath(filePath: string): string {
    if (!selectedBackup.value) return filePath
    // The file will be restored to its original absolute location (client source + relative path)
    const client = selectedBackup.value.client?.replace(/\/+$/, '') ?? ''
    if (client) return `${client}/${filePath}`
    return filePath
}

function taskToBackupEntry(task: BackUpTask): RichBackupEntry {
    return {
        uuid: task.uuid,
        server: task.host ?? '',
        client: task.source || task.target,
        folder: task.target,
        lastBackup: '',
        files: [],
        onSystem: false,
        __task: task
    }
}

function resolveConnForTask(task: BackUpTask) {
    const smb_host = task.host ?? ''
    const smb_share = task.share ?? ''
    const smb_user = task.smb_user ?? ''
    return { smb_host, smb_share, smb_user, smb_pass: '' }
}

function applyTasks(tasks: BackUpTask[]) {
    multiSelectedMap.value = {}
    backups.value = tasks.map(taskToBackupEntry)
    selectedBackup.value = backups.value[0] || null
    if (selectedBackup.value) fetchBackupFiles(selectedBackup.value)
}

function onBackupRowClick(backup: RichBackupEntry) {
    selectBackup(backup)
}

// When tasks prop changes, rebuild the list
watch(
    () => props.tasks,
    (tasks) => {
        if (tasks && tasks.length) applyTasks(tasks)
    },
    { immediate: true }
)

// When only ids are provided (route navigation), fetch those specific tasks from backend
watch(
    () => props.ids,
    (ids) => {
        if (ids && ids.length && (!props.tasks || !props.tasks.length)) {
            loading.value = true
            const handler = (raw: string) => {
                try {
                    const msg = JSON.parse(raw)
                    if (msg.type === 'sendBackupTasksByIds') {
                        IPCRouter.getInstance().removeEventListener('action', handler)
                        const tasks = (msg.tasks || []).map((t: BackUpTask) => {
                            if (t.schedule?.startDate) t.schedule.startDate = new Date(t.schedule.startDate)
                            return t
                        })
                        applyTasks(tasks)
                        loading.value = false
                    }
                } catch { /* ignore parse errors from other messages */ }
            }
            IPCRouter.getInstance().addEventListener('action', handler)
            IPCRouter.getInstance().send('backend', 'action', JSON.stringify({
                type: 'requestBackUpTasksByIds',
                ids
            }))
        }
    },
    { immediate: true }
)

const ipcActionHandler = (raw: string) => {
    try {
        const response = JSON.parse(raw)

        if (response.type === 'fetchFilesFromBackupResult' && selectedBackup.value) {
            const rawResult = response.result || []
            // The client field is the source path (e.g. "/home/user/Pictures").
            // Files from the backend are relative to the UUID folder and include
            // the hostname directory prefix (e.g. "keo-pc/home/user/Pictures/file.png").
            // We need to strip the hostname prefix from the path but NOT from the filename.
            const clientDir = selectedBackup.value.client
            const files: RichFileEntry[] = rawResult.map((file: any) => {
                const rawPath = typeof file === 'string' ? file : (file.path || '')
                // Strip leading hostname directory: paths look like "hostname/actual/path/file.ext"
                // The hostname is the first path segment, and the rest should start with the client source path
                const cleanPath = stripHostnamePrefix(rawPath, clientDir)
                const entry: RichFileEntry = {
                    path: cleanPath,
                    rawPath: rawPath,
                    selected: false,
                }
                if (typeof file !== 'string') {
                    entry.size = file.size
                    entry.mtime = file.mtime
                    entry.atime = file.atime
                    entry.birthtime = file.birthtime
                }
                return entry
            })
            selectedBackup.value.files = files
            focusedFile.value = null
            filesLoading.value = false
        } else if (response.type === 'deleteBackupsCompleted') {
            // Remove deleted backups from the list
            const deleted: string[] = response.uuids || []
            backups.value = backups.value.filter(b => !deleted.includes(b.uuid))
            for (const id of deleted) delete multiSelectedMap.value[id]
            if (selectedBackup.value && deleted.includes(selectedBackup.value.uuid)) selectedBackup.value = null
        }
    } catch (e) { console.debug('BackupBrowser action parse error:', e); }
}

// Register listener immediately (before watchers fire) so responses aren't missed
IPCRouter.getInstance().addEventListener('action', ipcActionHandler)

onUnmounted(() => {
    IPCRouter.getInstance().removeEventListener('action', ipcActionHandler)
    backups.value = []
    selectedBackup.value = null
    focusedFile.value = null
    multiSelectedMap.value = {}
    // Restore state deliberately survives: it is shared and the run may still be going.
})

async function selectBackup(backup: RichBackupEntry) {
    selectedBackup.value = { ...backup, files: backup.files || [], __task: backup.__task }
    focusedFile.value = null
    await fetchBackupFiles(backup)
}

async function fetchBackupFiles(backup: RichBackupEntry) {
    const task = backup.__task
    if (!task) return
    const { smb_host, smb_share, smb_user, smb_pass } = resolveConnForTask(task)

    filesLoading.value = true
    IPCRouter.getInstance().send('backend', 'action', JSON.stringify({
        type: 'fetchFilesFromBackup',
        data: { smb_host, smb_share, smb_user, smb_pass, uuid: backup.uuid }
    }))
}

function selectAll() {
    selectedBackup.value?.files.forEach(f => (f.selected = true))
}
function deselectAll() {
    selectedBackup.value?.files.forEach(f => (f.selected = false))
}

// ── File tree (groups flat file paths into folders/files for display) ──────
interface TreeFolderNode {
    type: 'folder'
    key: string
    name: string
    depth: number
    fileCount: number
    selectedCount: number
}
interface TreeFileNode {
    type: 'file'
    key: string
    name: string
    depth: number
    file: RichFileEntry
}
type TreeNode = TreeFolderNode | TreeFileNode

const collapsedFolders = reactive(new Set<string>())

function toggleFolder(key: string) {
    if (collapsedFolders.has(key)) collapsedFolders.delete(key)
    else collapsedFolders.add(key)
}

function setFolderCheckboxRef(el: Element | null, node: TreeFolderNode) {
    if (el instanceof HTMLInputElement) {
        el.indeterminate = node.selectedCount > 0 && node.selectedCount < node.fileCount
    }
}

function toggleFolderSelection(node: TreeFolderNode) {
    const shouldSelect = node.selectedCount < node.fileCount
    selectedBackup.value?.files.forEach(f => {
        if (f.path === node.key || f.path.startsWith(`${node.key}/`)) f.selected = shouldSelect
    })
}

const fileTree = computed<TreeNode[]>(() => {
    const files = selectedBackup.value?.files ?? []
    if (!files.length) return []

    interface FolderAgg { name: string; path: string; depth: number; files: RichFileEntry[]; childFolders: Set<string> }
    const folderMap = new Map<string, FolderAgg>()
    const rootFolderPaths = new Set<string>()
    const rootFiles: RichFileEntry[] = []

    function ensureFolder(path: string, name: string, depth: number): FolderAgg {
        let agg = folderMap.get(path)
        if (!agg) {
            agg = { name, path, depth, files: [], childFolders: new Set() }
            folderMap.set(path, agg)
        }
        return agg
    }

    for (const file of files) {
        const parts = file.path.split('/').filter(Boolean)
        if (parts.length <= 1) {
            rootFiles.push(file)
            continue
        }
        let currentPath = ''
        for (let i = 0; i < parts.length - 1; i++) {
            const parentPath = currentPath
            currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]
            ensureFolder(currentPath, parts[i], i)
            if (parentPath === '') rootFolderPaths.add(currentPath)
            else folderMap.get(parentPath)!.childFolders.add(currentPath)
        }
        folderMap.get(currentPath)!.files.push(file)
    }

    const countCache = new Map<string, { total: number; selected: number }>()
    function countFolder(path: string): { total: number; selected: number } {
        const cached = countCache.get(path)
        if (cached) return cached
        const agg = folderMap.get(path)!
        let total = agg.files.length
        let selected = agg.files.filter(f => f.selected).length
        for (const childPath of agg.childFolders) {
            const c = countFolder(childPath)
            total += c.total
            selected += c.selected
        }
        const result = { total, selected }
        countCache.set(path, result)
        return result
    }

    const rows: TreeNode[] = []

    function pushFolder(path: string) {
        const agg = folderMap.get(path)!
        const counts = countFolder(path)
        rows.push({
            type: 'folder',
            key: path,
            name: agg.name,
            depth: agg.depth,
            fileCount: counts.total,
            selectedCount: counts.selected,
        })
        if (collapsedFolders.has(path)) return
        const childFolders = [...agg.childFolders].sort((a, b) => folderMap.get(a)!.name.localeCompare(folderMap.get(b)!.name))
        for (const childPath of childFolders) pushFolder(childPath)
        const sortedFiles = [...agg.files].sort((a, b) => a.path.localeCompare(b.path))
        for (const file of sortedFiles) {
            const name = file.path.split('/').filter(Boolean).pop() ?? file.path
            rows.push({ type: 'file', key: file.rawPath, name, depth: agg.depth + 1, file })
        }
    }

    const sortedRootFolders = [...rootFolderPaths].sort((a, b) => folderMap.get(a)!.name.localeCompare(folderMap.get(b)!.name))
    for (const path of sortedRootFolders) pushFolder(path)

    const sortedRootFiles = [...rootFiles].sort((a, b) => a.path.localeCompare(b.path))
    for (const file of sortedRootFiles) rows.push({ type: 'file', key: file.rawPath, name: file.path, depth: 0, file })

    return rows
})

const isConfirmOpen = ref(false)

const {
    restore: restoreProgress, isRestoring, activeFileName, activeFilePercent,
    beginRestore, dismissRestoreResult, cancelRestore,
} = useRestoreProgress()

const restoredFolders = computed(() => restoreProgress.value.folders)
const showOpenFolderPrompt = computed(
    () => restoreProgress.value.finishedAt !== null && restoreProgress.value.folders.length > 0
)

const restoreSelected = async () => {
    if (!selectedBackup.value || !selectedBackup.value.__task) return
    if (isRestoring.value) return

    isConfirmOpen.value = true
    const confirmed = await confirm({
        header: 'Proceed with Restoring Selected Files',
        body: 'Restoring these files will overwrite existing files if they exist.',
        dangerous: true,
        confirmButtonText: 'Restore Now'
    }).unwrapOr(false)
    isConfirmOpen.value = false
    if (!confirmed) return
    // The dialog is async, so re-check rather than trusting the pre-dialog result.
    if (isRestoring.value) return

    const filesToRestore = (selectedBackup.value.files || []).filter(f => f.selected)
    beginRestore({
        uuid: selectedBackup.value.uuid,
        label: selectedBackup.value.folder || selectedBackup.value.client || selectedBackup.value.uuid,
        total: filesToRestore.length,
        client: selectedBackup.value.client,
    })

    const { smb_host, smb_share, smb_user, smb_pass } = resolveConnForTask(selectedBackup.value.__task)

    IPCRouter.getInstance().send('backend', 'action', JSON.stringify({
        type: 'restoreBackups',
        data: {
            smb_host,
            smb_share,
            smb_user,
            smb_pass,
            uuid: selectedBackup.value.uuid,
            client: selectedBackup.value.client,
            files: filesToRestore.map(f => f.rawPath)
        }
    }))
}

function openSelectedBackupFolder() {
    if (!selectedBackup.value || !selectedBackup.value.__task) return
    const { smb_host, smb_share, smb_user, smb_pass } = resolveConnForTask(selectedBackup.value.__task)
    IPCRouter.getInstance().send('backend', 'action', JSON.stringify({
        type: 'openBackupFolder',
        data: {
            smb_host,
            smb_share,
            smb_user,
            smb_pass,
            uuid: selectedBackup.value.uuid,
            client: selectedBackup.value.client
        }
    }))
}

async function deleteSingleBackup() {
    if (!selectedBackup.value || !selectedBackup.value.__task) return
    const confirmed = await confirm({
        header: 'Permanently Delete This Backup?',
        body: 'This will permanently delete the backed up directory on the server. This cannot be undone.',
        dangerous: true,
        confirmButtonText: 'Delete Backup'
    }).unwrapOr(false)
    if (!confirmed) return

    const conn = resolveConnForTask(selectedBackup.value.__task)
    multiSelectedMap.value[selectedBackup.value.uuid] = true
    IPCRouter.getInstance().send('backend', 'action', JSON.stringify({
        type: 'deleteBackups',
        data: { ...conn, uuids: [selectedBackup.value.uuid] }
    }))
}

useEnterToAdvance(
    () => {
        if (!isConfirmOpen.value && selectedBackup.value && selectedFilesCount.value > 0) restoreSelected()
    },
    200,
    () => {
        if (!isConfirmOpen.value && selectedBackup.value && selectedFilesCount.value > 0) restoreSelected()
    },
    () => {
        if (!isConfirmOpen.value) proceedToPreviousStep()
    }
)

// Open restored folders after operation completes
const openRestoredFolders = () => {
    for (const folder of restoredFolders.value) {
        const fixedFolder = folder.replace(/\\/g, '/')
        const normalizedPath = fixedFolder.match(/^([A-Za-z]:\/|\/)/) ? fixedFolder : `/${fixedFolder}`
        IPCRouter.getInstance().send('backend', 'action', JSON.stringify({ type: 'openFolder', path: normalizedPath }))
    }
    dismissRestoreResult()
}
</script>

<style scoped>
.spinner {
    border: 3px solid rgba(128, 128, 128, 0.2);
    border-left-color: currentColor;
    border-radius: 50%;
    width: 32px;
    height: 32px;
    animation: spin 0.8s linear infinite;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}
</style>
