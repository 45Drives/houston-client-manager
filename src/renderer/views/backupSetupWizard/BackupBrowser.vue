<template>
    <div class="h-full flex flex-col min-h-0 overflow-hidden p-4">
        <!-- Header -->
        <div class="flex items-center justify-between mb-4 shrink-0">
            <div class="flex items-center gap-3">
                <button class="btn btn-secondary text-sm h-8 flex items-center gap-1.5" @click="proceedToPreviousStep">
                    <ArrowLeftIcon class="w-4 h-4" />
                    Back
                </button>
                <h2 class="text-lg font-semibold text-default">Backup Browser</h2>
            </div>
            <!-- Backup selector (multi-backup mode) -->
            <div v-if="!singleMode" class="flex items-center gap-2">
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
            <div class="w-3/5 flex flex-col min-h-0 bg-well rounded-lg border border-default overflow-hidden">
                <!-- File panel header -->
                <div class="px-3 py-2 border-b border-default flex items-center justify-between shrink-0">
                    <span class="text-sm font-medium text-default">
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
                            class="ml-2 text-xs bg-primary text-white px-2 py-0.5 rounded-full">
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
                    <div v-for="(file, index) in selectedBackup.files" :key="index"
                        class="flex items-center gap-3 px-3 py-2 border-b border-default cursor-pointer transition-colors"
                        :class="[
                            file?.selected ? 'bg-primary/10' : 'hover:bg-accent',
                            focusedFile === file ? 'ring-1 ring-inset ring-primary' : ''
                        ]"
                        @click="onFileClick(file)">
                        <input type="checkbox" v-model="file.selected" class="shrink-0" @click.stop />
                        <DocumentIcon class="w-4 h-4 text-muted shrink-0" />
                        <span class="text-sm text-default truncate" :title="file.path">{{ file.path }}</span>
                        <span v-if="file.size != null" class="ml-auto text-xs text-muted shrink-0">{{ formatFileSize(file.size) }}</span>
                    </div>
                </div>
            </div>

            <!-- RIGHT: Info & restore controls -->
            <div class="w-2/5 flex flex-col min-h-0 gap-4">
                <!-- Backup info card -->
                <div v-if="selectedBackup" class="bg-well rounded-lg border border-default overflow-hidden shrink-0">
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
                            <span class="text-muted shrink-0">SMB User</span>
                            <span class="text-default text-right truncate">{{ selectedBackup.__task.smb_user }}</span>
                        </div>
                        <div v-if="selectedBackup.__task?.share" class="flex justify-between gap-2">
                            <span class="text-muted shrink-0">Share</span>
                            <span class="text-default text-right truncate">{{ selectedBackup.__task.share }}</span>
                        </div>
                        <div v-if="selectedBackup.lastBackup" class="flex justify-between gap-2">
                            <span class="text-muted shrink-0">Last Backup</span>
                            <span class="text-default text-right">{{ selectedBackup.lastBackup }}</span>
                        </div>
                        <div v-if="selectedBackup.__task?.status" class="flex justify-between gap-2">
                            <span class="text-muted shrink-0">Status</span>
                            <span class="text-right text-xs px-1.5 py-0.5 rounded"
                                :class="selectedBackup.__task.status === 'online' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'">
                                {{ selectedBackup.__task.status }}
                            </span>
                        </div>
                        <div class="flex justify-between gap-2">
                            <span class="text-muted shrink-0">Total Files</span>
                            <span class="text-default text-right">{{ selectedBackup.files?.length ?? 0 }}</span>
                        </div>
                    </div>
                </div>

                <!-- Selected file details card -->
                <div v-if="focusedFile" class="bg-well rounded-lg border border-default overflow-hidden shrink-0">
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
                <div v-else-if="selectedBackup && !filesLoading && selectedBackup.files?.length"
                    class="bg-well rounded-lg border border-default p-4 flex flex-col items-center justify-center text-muted gap-2">
                    <InformationCircleIcon class="w-8 h-8 opacity-30" />
                    <p class="text-sm text-center">Click a file to view its details</p>
                </div>

                <!-- Spacer to push actions to bottom -->
                <div class="flex-1 min-h-0"></div>

                <!-- Restore progress -->
                <div v-if="restoreProgress.total > 0 && restoreProgress.current < restoreProgress.total"
                    class="p-3 rounded-lg border border-default bg-accent shrink-0">
                    <div class="flex items-center justify-between text-sm mb-2">
                        <span class="text-default">Restoring {{ restoreProgress.current }}/{{ restoreProgress.total }}…</span>
                        <span class="text-muted font-mono text-xs truncate ml-2 max-w-[60%]">{{ restoreProgress.lastFile }}</span>
                    </div>
                    <div class="w-full h-2 bg-well rounded-full overflow-hidden">
                        <div class="h-full bg-primary rounded-full transition-all"
                            :style="{ width: `${(restoreProgress.current / restoreProgress.total) * 100}%` }" />
                    </div>
                </div>

                <!-- Restore complete -->
                <div v-if="restoreProgress.total > 0 && restoreProgress.current === restoreProgress.total"
                    class="p-3 rounded-lg border border-default bg-accent shrink-0 text-sm text-default">
                    Restored {{ restoreProgress.current }} of {{ restoreProgress.total }} file(s).
                </div>

                <!-- Open restored folders prompt -->
                <div v-if="showOpenFolderPrompt"
                    class="p-3 rounded-lg border border-default bg-accent shrink-0">
                    <p class="text-sm text-default mb-2">
                        Restore complete. Open the restored folder{{ restoredFolders.length > 1 ? 's' : '' }}?
                    </p>
                    <div class="flex items-center gap-2">
                        <button class="btn btn-primary text-sm h-8 flex items-center gap-1.5" @click="openRestoredFolders">
                            <FolderOpenIcon class="w-4 h-4" />
                            Open {{ restoredFolders.length > 1 ? 'All' : 'Folder' }}
                        </button>
                        <button class="btn btn-secondary text-sm h-8" @click="showOpenFolderPrompt = false">Dismiss</button>
                    </div>
                </div>

                <!-- Action buttons -->
                <div v-if="selectedBackup" class="shrink-0 flex flex-col gap-2">
                    <button class="btn btn-primary w-full text-sm h-9 flex items-center justify-center gap-1.5"
                        :disabled="selectedFilesCount === 0"
                        @click="restoreSelected">
                        <ArrowDownTrayIcon class="w-4 h-4" />
                        Restore Selected ({{ selectedFilesCount }})
                    </button>
                    <div class="flex gap-2">
                        <button class="btn btn-secondary flex-1 text-sm h-8 flex items-center justify-center gap-1.5"
                            @click="openSelectedBackupFolder">
                            <FolderOpenIcon class="w-4 h-4" />
                            Open Folder
                        </button>
                        <button class="btn btn-danger flex-1 text-sm h-8 flex items-center justify-center gap-1.5"
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
import { ref, computed, onUnmounted, watch } from 'vue'
import { confirm, useEnterToAdvance } from '@45drives/houston-common-ui'
import { IPCRouter, type BackupEntry, type FileEntry, type BackUpTask } from '@45drives/houston-common-lib'
import { useRouter } from 'vue-router'
import { useHeader } from '../../composables/useHeader'
import {
    ArrowLeftIcon, FolderOpenIcon, TrashIcon, ArrowDownTrayIcon,
    MagnifyingGlassIcon, DocumentIcon, DocumentMagnifyingGlassIcon,
    InformationCircleIcon
} from '@heroicons/vue/24/outline'
useHeader('View Selected Backups')
const router = useRouter();

// Extended file entry with metadata from the backend
interface RichFileEntry extends FileEntry {
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

function resolveRestorePath(filePath: string): string {
    if (!selectedBackup.value) return filePath
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
            const files: RichFileEntry[] = rawResult.map((file: any) => {
                if (typeof file === 'string') {
                    // Legacy: backend returned plain strings
                    return {
                        path: file.replace(`${selectedBackup.value!.client}/`, '').replace(/^\/+/, ''),
                        selected: false
                    }
                }
                // New format: objects with metadata
                return {
                    path: (file.path || '').replace(`${selectedBackup.value!.client}/`, '').replace(/^\/+/, ''),
                    selected: false,
                    size: file.size,
                    mtime: file.mtime,
                    atime: file.atime,
                    birthtime: file.birthtime,
                }
            })
            selectedBackup.value.files = files
            focusedFile.value = null
            filesLoading.value = false
        } else if (response.type === 'restoreBackupsResult') {
            restoreProgress.value.current++
            restoreProgress.value.lastFile = response.value.file
            if (response.value.error) console.error(`Error restoring ${response.value.file}: ${response.value.error}`)
        } else if (response.type === 'restoreCompleted') {
            restoredFolders.value = response.allFolders ?? [response.folder]
            showOpenFolderPrompt.value = true
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
    restoreProgress.value = { current: 0, total: 0, lastFile: '' }
    restoredFolders.value = []
    showOpenFolderPrompt.value = false
    multiSelectedMap.value = {}
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

const isConfirmOpen = ref(false)
const showOpenFolderPrompt = ref(false)
const restoredFolders = ref<string[]>([])

const restoreProgress = ref<{ current: number; total: number; lastFile: string }>({
    current: 0,
    total: 0,
    lastFile: ''
})

const restoreSelected = async () => {
    if (!selectedBackup.value || !selectedBackup.value.__task) return

    isConfirmOpen.value = true
    const confirmed = await confirm({
        header: 'Proceed with Restoring Selected Files',
        body: 'Restoring these files will overwrite existing files if they exist.',
        dangerous: true,
        confirmButtonText: 'Restore Now'
    }).unwrapOr(false)
    isConfirmOpen.value = false
    if (!confirmed) return

    const filesToRestore = (selectedBackup.value.files || []).filter(f => f.selected)
    restoreProgress.value = { current: 0, total: filesToRestore.length, lastFile: '' }

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
            files: filesToRestore.map(f => f.path)
        }
    }))
}

function openSelectedBackupFolder() {
    if (!selectedBackup.value || !selectedBackup.value.__task) return
    const { smb_host, smb_share, smb_user, smb_pass } = resolveConnForTask(selectedBackup.value.__task)
    // Backend should ensure mount & open behavior for this backup root folder
    IPCRouter.getInstance().send('backend', 'action', JSON.stringify({
        type: 'openBackupFolder',
        data: {
            smb_host,
            smb_share,
            smb_user,
            smb_pass,
            uuid: selectedBackup.value.uuid
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
    showOpenFolderPrompt.value = false
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
