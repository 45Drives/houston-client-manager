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
            <div class="flex items-center gap-2">
                <button class="btn btn-secondary text-sm h-8 flex items-center gap-1.5"
                    :disabled="!selectedBackup"
                    @click="openSelectedBackupFolder">
                    <FolderOpenIcon class="w-4 h-4" />
                    Open Folder
                </button>
                <button class="btn btn-danger text-sm h-8 flex items-center gap-1.5"
                    :disabled="multiSelectedUuids.length === 0"
                    @click="deleteSelectedBackups">
                    <TrashIcon class="w-4 h-4" />
                    Delete
                </button>
            </div>
        </div>

        <!-- Main content -->
        <div class="flex-1 min-h-0 flex gap-4">
            <!-- LEFT: Backup tasks list (hidden in single-backup mode) -->
            <div v-if="!singleMode" class="w-2/5 flex flex-col min-h-0 bg-well rounded-lg border border-default overflow-hidden">
                <div class="px-3 py-2 border-b border-default shrink-0">
                    <div class="flex items-center gap-2">
                        <MagnifyingGlassIcon class="w-4 h-4 text-muted shrink-0" />
                        <input v-model="search" type="text" placeholder="Search backups…"
                            class="w-full bg-transparent text-sm text-default placeholder:text-muted outline-none" />
                    </div>
                </div>

                <div v-if="loading" class="flex-1 flex items-center justify-center">
                    <div class="spinner"></div>
                </div>
                <div v-else-if="filteredBackups.length === 0" class="flex-1 flex flex-col items-center justify-center text-muted gap-2 p-4">
                    <CircleStackIcon class="w-10 h-10 opacity-30" />
                    <p class="text-sm">No backups found.</p>
                </div>
                <div v-else class="flex-1 overflow-y-auto">
                    <div v-for="backup in filteredBackups" :key="backup.uuid"
                        class="flex items-start gap-3 px-3 py-2.5 border-b border-default cursor-pointer transition-colors border-l-2"
                        :class="selectedBackup?.uuid === backup.uuid
                            ? 'bg-primary/15 border-l-primary text-default'
                            : 'border-l-transparent hover:bg-accent'"
                        @click="onBackupRowClick(backup)">
                        <input type="checkbox" v-model="multiSelectedMap[backup.uuid]"
                            class="mt-1 shrink-0" @click.stop />
                        <div class="min-w-0 flex-1">
                            <p class="text-sm font-medium text-default truncate" :title="backup.folder">
                                {{ backup.folder }}
                            </p>
                            <p class="text-xs text-muted truncate">
                                {{ backup.client }} &rarr; {{ backup.server }}
                            </p>
                            <p v-if="backup.lastBackup" class="text-xs text-muted mt-0.5">
                                Last: {{ backup.lastBackup }}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- RIGHT: Files in selected backup -->
            <div :class="singleMode ? 'w-full' : 'w-3/5'" class="flex flex-col min-h-0 bg-well rounded-lg border border-default overflow-hidden">
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
                    <p class="text-sm">{{ singleMode ? 'Loading backup…' : 'Click a backup on the left to view its files.' }}</p>
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
                        :class="file?.selected ? 'bg-primary/10' : 'hover:bg-accent'"
                        @click="toggleFileSelection(file)">
                        <input type="checkbox" v-model="file.selected" class="shrink-0" @click.stop />
                        <DocumentIcon class="w-4 h-4 text-muted shrink-0" />
                        <span class="text-sm text-default truncate" :title="file.path">{{ file.path }}</span>
                    </div>
                </div>

                <!-- Restore action bar -->
                <div v-if="selectedBackup && selectedFilesCount > 0"
                    class="px-3 py-2.5 border-t border-default bg-accent shrink-0 flex items-center justify-between">
                    <span class="text-sm text-muted">{{ selectedFilesCount }} file{{ selectedFilesCount !== 1 ? 's' : '' }} selected</span>
                    <button class="btn btn-primary text-sm h-8 flex items-center gap-1.5" @click="restoreSelected">
                        <ArrowDownTrayIcon class="w-4 h-4" />
                        Restore Selected
                    </button>
                </div>
            </div>
        </div>

        <!-- Restore progress -->
        <div v-if="restoreProgress.total > 0 && restoreProgress.current < restoreProgress.total"
            class="mt-4 p-3 rounded-lg border border-default bg-accent shrink-0">
            <div class="flex items-center justify-between text-sm mb-2">
                <span class="text-default">Restoring file {{ restoreProgress.current }} of {{ restoreProgress.total }}…</span>
                <span class="text-muted font-mono text-xs truncate ml-4 max-w-[50%]">{{ restoreProgress.lastFile }}</span>
            </div>
            <div class="w-full h-2 bg-well rounded-full overflow-hidden">
                <div class="h-full bg-primary rounded-full transition-all"
                    :style="{ width: `${(restoreProgress.current / restoreProgress.total) * 100}%` }" />
            </div>
        </div>

        <!-- Restore complete -->
        <div v-if="restoreProgress.total > 0 && restoreProgress.current === restoreProgress.total"
            class="mt-4 p-3 rounded-lg border border-default bg-accent shrink-0 text-sm text-default">
            Restored {{ restoreProgress.current }} of {{ restoreProgress.total }} file(s).
        </div>

        <!-- Open restored folders prompt -->
        <div v-if="showOpenFolderPrompt"
            class="mt-4 p-3 rounded-lg border border-default bg-accent shrink-0 flex items-center justify-between">
            <span class="text-sm text-default">
                Restore complete. Open the restored folder{{ restoredFolders.length > 1 ? 's' : '' }}?
            </span>
            <div class="flex items-center gap-2">
                <button class="btn btn-primary text-sm h-8 flex items-center gap-1.5" @click="openRestoredFolders">
                    <FolderOpenIcon class="w-4 h-4" />
                    Open {{ restoredFolders.length > 1 ? 'All' : 'Folder' }}
                </button>
                <button class="btn btn-secondary text-sm h-8" @click="showOpenFolderPrompt = false">Dismiss</button>
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
    MagnifyingGlassIcon, CircleStackIcon, DocumentIcon, DocumentMagnifyingGlassIcon
} from '@heroicons/vue/24/outline'
useHeader('View Selected Backups')
const router = useRouter();
/**
 * Props: a list of tasks. The component ONLY shows these.
 * Expect each task to contain enough info to resolve SMB host/share and client path.
 * If your BackUpTask fields differ, adjust resolveConnForTask() below.
 */
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

// Backups (derived from the provided tasks), plus runtime fields
const backups = ref<(BackupEntry & { __task?: BackUpTask })[]>([])
const selectedBackup = ref<(BackupEntry & { __task?: BackUpTask }) | null>(null)

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

// Single-backup mode: skip the left panel entirely
const singleMode = computed(() => backups.value.length === 1)

function toggleFileSelection(file: FileEntry) {
    file.selected = !file.selected
}

function taskToBackupEntry(task: BackUpTask): BackupEntry & { __task: BackUpTask } {
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

function onBackupRowClick(backup: BackupEntry & { __task?: BackUpTask }) {
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
            const files = (response.result || []).map((file: string) => ({
                path: file.replace(`${selectedBackup.value!.client}/`, '').replace(/^\/+/, ''),
                selected: false
            })) as FileEntry[]
            selectedBackup.value.files = files
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
    restoreProgress.value = { current: 0, total: 0, lastFile: '' }
    restoredFolders.value = []
    showOpenFolderPrompt.value = false
    multiSelectedMap.value = {}
})

async function selectBackup(backup: BackupEntry & { __task?: BackUpTask }) {
    selectedBackup.value = { ...backup, files: backup.files || [], __task: backup.__task }
    await fetchBackupFiles(backup)
}

async function fetchBackupFiles(backup: BackupEntry & { __task?: BackUpTask }) {
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

async function deleteSelectedBackups() {
    if (multiSelectedUuids.value.length === 0) return
    const confirmed = await confirm({
        header: 'Permanently Delete Selected Backups?',
        body: 'This will permanently delete the backed up directory (or directories) on the server. This cannot be undone.',
        dangerous: true,
        confirmButtonText: 'Delete Backups'
    }).unwrapOr(false)
    if (!confirmed) return

    // We may have mixed tasks from different servers/shares. Group by connection for backend efficiency.
    const byConn: Record<string, { conn: any; uuids: string[] }> = {}
    for (const b of backups.value) {
        if (!multiSelectedMap.value[b.uuid] || !b.__task) continue
        const conn = resolveConnForTask(b.__task)
        const key = JSON.stringify(conn)
        if (!byConn[key]) byConn[key] = { conn, uuids: [] }
        byConn[key].uuids.push(b.uuid)
    }

    for (const { conn, uuids } of Object.values(byConn)) {
        IPCRouter.getInstance().send('backend', 'action', JSON.stringify({
            type: 'deleteBackups',
            data: { ...conn, uuids }
        }))
    }
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
