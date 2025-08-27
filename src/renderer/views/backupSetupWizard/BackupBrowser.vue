<template>
    <CardContainer class="overflow-y-auto min-h-0">
        <div class="w-full">
            <p class="text-1xl font-semibold text-center">
                This page shows only the backup tasks you selected.
                <br />
                Click a backup on the left to see its files. Select files on the right and click
                <em>Restore Selected Files</em>.
                <br />
                You can also <em>Open Folder</em> for a backup (mounts + opens on the server), or select one or more
                backups and click <em>Delete Selected Backups</em>.
            </p>

            <div class="flex justify-between mt-1 gap-2">
                <!-- LEFT: Selected backups list -->
                <div class="w-1/2 pr-2">
                    <div class="mb-2">
                        <input v-model="search" type="text" placeholder="Type to search backups"
                            class="w-full p-2 border rounded bg-white text-black" />
                    </div>

                    <table v-if="!loading" class="max-h-96 overflow-y-auto w-full border text-left">
                        <thead>
                            <tr class="bg-primary">
                                <th class="p-2 w-10">Select</th>
                                <th class="p-2">Folder</th>
                                <th class="p-2">Client</th>
                                <th class="p-2">Server</th>
                                <th class="p-2">Last Backup</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="backup in filteredBackups" :key="backup.uuid" :class="[
                                'cursor-pointer',
                                selectedBackup?.uuid === backup.uuid
                                    ? 'bg-yellow-100 hover:bg-yellow-200 text-black'
                                    : 'bg-default text-default'
                            ]" @click="selectBackup(backup)">
                                <td class="p-2" @click.stop>
                                    <input type="checkbox" v-model="multiSelectedMap[backup.uuid]" />
                                </td>
                                <td class="p-2">{{ backup.folder }}</td>
                                <td class="p-2">{{ backup.client }}</td>
                                <td class="p-2">{{ backup.server }}</td>
                                <td class="p-2">{{ backup.lastBackup }}</td>
                            </tr>
                        </tbody>
                    </table>
                    <div v-else>
                        <div class="w-full h-[300px] flex justify-center items-center">
                            <div class="spinner"></div>
                        </div>
                    </div>
                </div>

                <!-- RIGHT: Files in selected backup -->
                <div class="w-1/2 pl-2">
                    <div class="text-center mb-2">
                        <input class="bg-well w-full p-2 border rounded text-default" disabled
                            :placeholder="selectedBackup ? 'Click files to select/deselect' : 'Select a backup to see files'" />
                    </div>

                    <div class="max-h-96 overflow-y-auto text-default" v-if="selectedBackup">
                        <table v-if="!filesLoading" class="w-full border text-left">
                            <thead>
                                <tr class="bg-secondary">
                                    <th class="p-2">File</th>
                                    <th class="p-2 w-20">Select</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="(file, index) in selectedBackup.files" :key="index" class="cursor-pointer"
                                    :class="[
                                        'cursor-pointer',
                                        file?.selected ? 'bg-yellow-100 hover:bg-yellow-200 text-black' : 'bg-default text-default'
                                    ]" @click="toggleFileSelection(file)">
                                    <td class="p-2 truncate max-w-[30ch]" :title="file.path">{{ file.path }}</td>
                                    <td class="p-2" @click.stop>
                                        <input type="checkbox" v-model="file.selected" />
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                        <div v-else>
                            <div class="w-full h-[300px] flex justify-center items-center">
                                <div class="spinner"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Progress -->
            <div v-if="restoreProgress.total > 0 && restoreProgress.current < restoreProgress.total"
                class="my-4 text-center">
                <p>Restoring file {{ restoreProgress.current }} of {{ restoreProgress.total }}...</p>
                <p><strong>{{ restoreProgress.lastFile }}</strong></p>
                <progress :value="restoreProgress.current" :max="restoreProgress.total" class="w-full"></progress>
            </div>
            <div v-if="restoreProgress.total > 0 && restoreProgress.current == restoreProgress.total">
                <p>Restored {{ restoreProgress.current }} of {{ restoreProgress.total }} file(s).</p>
                <p><strong>{{ restoreProgress.lastFile }}</strong></p>
            </div>

            <!-- Open restored folders prompt -->
            <div v-if="showOpenFolderPrompt" class="text-center my-4 p-4 border rounded bg-yellow-100 text-black z-11">
                <p>Restore complete. Would you like to open the folder{{ restoredFolders.length > 1 ? 's' : '' }}?</p>
                <div class="flex justify-center gap-2 mt-2">
                    <button class="btn btn-primary" @click="openRestoredFolders">
                        Open {{ restoredFolders.length > 1 ? 'All' : 'Folder' }}
                    </button>
                    <button class="btn btn-secondary" @click="showOpenFolderPrompt = false">Dismiss</button>
                </div>
            </div>
        </div>

        <!-- Footer Buttons -->
        <template #footer>
            <div class="button-group-row justify-between w-full">
                <button @click="proceedToPreviousStep" class="btn btn-secondary h-20 w-40">Back</button>

                <div class="button-group-row justify-end gap-3">
                    <button class="btn btn-secondary px-4 py-2" :disabled="!selectedBackup"
                        @click="deselectAll">Deselect All</button>
                    <button class="btn btn-secondary px-4 py-2" :disabled="!selectedBackup" @click="selectAll">Select
                        All</button>
                    <button class="btn btn-secondary px-4 py-2" :disabled="!selectedBackup"
                        @click="openSelectedBackupFolder">
                        Open Folder
                    </button>
                    <button class="btn btn-danger px-4 py-2" :disabled="multiSelectedUuids.length === 0"
                        @click="deleteSelectedBackups">
                        Delete Selected Backups
                    </button>
                    <button class="btn btn-primary px-4 py-2" :disabled="!selectedBackup || selectedFilesCount === 0"
                        @click="restoreSelected">
                        Restore Selected Files
                    </button>
                </div>
            </div>
        </template>
    </CardContainer>
</template>

<script setup lang="ts">
import { ref, computed, onActivated, onDeactivated, watch } from 'vue'
import { useWizardSteps, confirm, CardContainer, useEnterToAdvance } from '@45drives/houston-common-ui'
import { IPCRouter, type BackupEntry, type FileEntry, type BackUpTask } from '@45drives/houston-common-lib'
import { useRouter } from 'vue-router'
import { useHeader } from '../../composables/useHeader'
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
// const { prevStep } = useWizardSteps('backup-root')
// const proceedToPreviousStep = () => prevStep()
// const proceedToPreviousStep = () => router.push('/backup')
let proceedToPreviousStep = () => router.back()
try {
    const { prevStep } = useWizardSteps('backup-root')
    proceedToPreviousStep = () => prevStep()
} catch {
    router.push('/backup')
}

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

function toggleFileSelection(file: FileEntry) {
    file.selected = !file.selected
}

/**
 * Map incoming tasks to our local BackupEntry shape.
 * NOTE: Adjust field extraction as needed for your BackUpTask.
 */
function taskToBackupEntry(task: BackUpTask): BackupEntry & { __task: BackUpTask } {
    // --- Heuristics/guesses about task fields ---
    // Prefer explicit fields if present; otherwise fall back to common names.
    const server = (task as any).serverName || (task as any).host || (task as any).server || ''
    const shareName = (task as any).shareName || (task as any).share || ''
    const client = (task as any).client || (task as any).source || (task as any).target || ''
    const folder = (task as any).folder || (task as any).target || (task as any).backupFolder || ''
    const lastBackup = (task as any).lastRun || (task as any).lastBackup || ''

    return {
        uuid: (task as any).uuid,
        server,
        client,
        folder,
        lastBackup,
        files: [],
        __task: task
    } as any
}

function resolveConnForTask(task: BackUpTask) {
    // Construct SMB connection fields for backend actions
    // Adjust these to match your actual BackUpTask structure.
    const serverName = (task as any).serverName || (task as any).host || (task as any).server || ''
    const smb_host = serverName ? `${serverName}.local` : ''
    const smb_share = (task as any).shareName || (task as any).share || ''
    const smb_user = (task as any).username || (task as any).smbUser || ''
    const smb_pass = (task as any).password || (task as any).smbPass || ''
    return { smb_host, smb_share, smb_user, smb_pass }
}

// When tasks prop changes, rebuild the list
watch(
    () => props.tasks,
    (tasks) => {
        multiSelectedMap.value = {}
        backups.value = (tasks || []).map(taskToBackupEntry)
        // Preselect the first backup for convenience
        selectedBackup.value = backups.value[0] || null
        if (selectedBackup.value) fetchBackupFiles(selectedBackup.value)
    },
    { immediate: true }
)

onActivated(() => {
    // Listen for backend events
    IPCRouter.getInstance().addEventListener('action', (raw) => {
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
        } catch { }
    })
})

onDeactivated(() => {
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
table {
    border-collapse: collapse;
}

th,
td {
    border: 1px solid #ccc;
}

/* Loading spinner */
.spinner {
    border: 4px solid rgba(0, 0, 0, 0.1);
    border-left-color: #2c3e50;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    animation: spin 1s linear infinite;
    margin: 20px;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}
</style>
