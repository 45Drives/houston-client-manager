<template>
    <Modal :show="show" @clickOutside="close">
        <div class="w-full max-w-md mx-auto bg-default p-5 rounded-xl shadow">
            <!-- Step 1: Choose action -->
            <template v-if="step === 'choose'">
                <h2 class="text-lg font-semibold text-default mb-4">Add Backup Server</h2>
                <div class="space-y-3">
                    <button
                        class="w-full flex items-center gap-3 p-4 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-hover transition-colors text-left"
                        @click="$emit('go-setup'); close()">
                        <WrenchScrewdriverIcon class="w-6 h-6 text-primary shrink-0" />
                        <div>
                            <div class="text-sm font-medium text-default">Set Up New Server</div>
                            <div class="text-xs text-gray-400">Configure storage, shares, and install server software</div>
                        </div>
                    </button>
                    <button
                        class="w-full flex items-center gap-3 p-4 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-hover transition-colors text-left"
                        @click="step = 'form'">
                        <ServerStackIcon class="w-6 h-6 text-primary shrink-0" />
                        <div>
                            <div class="text-sm font-medium text-default">Add Existing Backup Server</div>
                            <div class="text-xs text-gray-400">Connect to a server that's already set up</div>
                        </div>
                    </button>
                </div>
                <div class="flex justify-end mt-4">
                    <button class="btn btn-sm btn-outline-shadow h-fit" @click="close">Cancel</button>
                </div>
            </template>

            <!-- Step 2: Add existing server form -->
            <template v-else-if="step === 'form'">
                <h2 class="text-lg font-semibold text-default mb-1">Add Existing Backup Server</h2>
                <p class="text-xs text-gray-400 mb-4">Enter the connection details for your backup server and its share.</p>

                <!-- Discovered servers hint -->
                <div v-if="discoveredUnregistered.length > 0" class="mb-4">
                    <label class="text-xs font-medium text-gray-500 mb-1 block">Discovered on network</label>
                    <div class="flex flex-wrap gap-1.5">
                        <button v-for="srv in discoveredUnregistered" :key="srv.ip"
                            class="text-xs px-2 py-1 rounded-md border border-neutral-200 dark:border-neutral-600 hover:bg-hover transition-colors"
                            :class="host === srv.ip ? 'bg-selected border-primary text-primary' : 'text-default'"
                            @click="selectDiscovered(srv)">
                            {{ srv.name || srv.ip }}
                        </button>
                    </div>
                </div>

                <div class="flex flex-col gap-3">
                    <div>
                        <label class="text-xs font-medium text-gray-500 mb-1 block">Host / IP</label>
                        <input v-model="host" type="text"
                            class="w-full p-2 input-textlike rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="e.g. 192.168.2.100 or myserver.local" />
                    </div>
                    <div>
                        <label class="text-xs font-medium text-gray-500 mb-1 block">Username</label>
                        <input v-model="username" type="text"
                            class="w-full p-2 input-textlike rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="root" />
                    </div>
                    <div class="relative">
                        <label class="text-xs font-medium text-gray-500 mb-1 block">Password</label>
                        <input v-model="password" :type="showPassword ? 'text' : 'password'"
                            class="w-full p-2 pr-10 input-textlike rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Enter password" @keyup.enter="submit" />
                        <button type="button" @click="showPassword = !showPassword"
                            class="absolute right-3 bottom-2 text-muted">
                            <EyeIcon v-if="!showPassword" class="w-4 h-4" />
                            <EyeSlashIcon v-if="showPassword" class="w-4 h-4" />
                        </button>
                    </div>
                    <div>
                        <label class="text-xs font-medium text-gray-500 mb-1 block">Samba Share Name</label>
                        <input v-model="shareName" type="text"
                            class="w-full p-2 input-textlike rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="e.g. backups" />
                        <p class="text-[11px] text-gray-400 mt-0.5">The SMB share on the server used for backups.</p>
                    </div>
                    <div>
                        <label class="text-xs font-medium text-gray-500 mb-1 block">Nickname <span class="text-gray-400">(optional)</span></label>
                        <input v-model="nickname" type="text"
                            class="w-full p-2 input-textlike rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="e.g. Office NAS" />
                    </div>
                </div>

                <div v-if="error" class="mt-3 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded-md">
                    {{ error }}
                </div>

                <div class="flex justify-between mt-5">
                    <button class="btn btn-sm btn-outline-shadow h-fit" @click="step = 'choose'; error = ''">Back</button>
                    <div class="flex gap-2">
                        <button class="btn btn-sm btn-outline-shadow h-fit" @click="close">Cancel</button>
                        <button class="btn btn-sm btn-primary h-fit" :disabled="!canSubmit || testing"
                            @click="submit">
                            <span v-if="testing" class="flex items-center gap-1.5">
                                <svg class="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                                </svg>
                                Testing…
                            </span>
                            <span v-else>Add Server</span>
                        </button>
                    </div>
                </div>
            </template>

            <!-- Step 3: Configuring server -->
            <template v-else-if="step === 'configuring'">
                <h2 class="text-lg font-semibold text-default mb-1">Configuring Server</h2>
                <p class="text-xs text-gray-400 mb-4">
                    Installing required software and registering the server. This may take a few minutes.
                </p>

                <div class="space-y-2 mb-4">
                    <!-- Progress steps -->
                    <div v-for="(ps, i) in progressSteps" :key="i"
                        class="flex items-start gap-2 text-xs"
                        :class="ps.status === 'error' ? 'text-red-500' : ps.status === 'done' ? 'text-green-600 dark:text-green-400' : 'text-default'">
                        <span class="shrink-0 mt-0.5">
                            <svg v-if="ps.status === 'active'" class="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                            </svg>
                            <CheckCircleIcon v-else-if="ps.status === 'done'" class="w-3.5 h-3.5" />
                            <ExclamationCircleIcon v-else-if="ps.status === 'error'" class="w-3.5 h-3.5" />
                            <span v-else class="inline-block w-3.5 h-3.5 rounded-full border border-current opacity-40" />
                        </span>
                        <span>{{ ps.label }}</span>
                    </div>
                </div>

                <!-- Log output (collapsed by default) -->
                <details v-if="setupLogs.length > 0" class="mb-4">
                    <summary class="text-xs text-gray-400 cursor-pointer hover:text-default">
                        Show detailed log ({{ setupLogs.length }} lines)
                    </summary>
                    <div class="mt-2 max-h-32 overflow-y-auto rounded-md bg-neutral-100 dark:bg-neutral-900 p-2 text-[11px] font-mono text-gray-600 dark:text-gray-400 space-y-0.5">
                        <div v-for="(log, i) in setupLogs" :key="i">{{ log }}</div>
                    </div>
                </details>

                <div v-if="error" class="mt-3 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded-md">
                    {{ error }}
                </div>

                <div class="flex justify-end mt-4 gap-2">
                    <button v-if="error" class="btn btn-sm btn-outline-shadow h-fit" @click="close">Close</button>
                    <button v-if="error" class="btn btn-sm btn-primary h-fit" @click="retrySetup">Retry</button>
                </div>
            </template>
        </div>
    </Modal>
</template>

<script setup lang="ts">
import { ref, computed, inject } from 'vue'
import { EyeIcon, EyeSlashIcon } from '@heroicons/vue/20/solid'
import { WrenchScrewdriverIcon, ServerStackIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/vue/24/outline'
import { Modal } from '@45drives/houston-common-ui'
import { discoveryStateInjectionKey } from '../../keys/injection-keys'
import type { DiscoveryState, Server } from '../../types'
import { useServers } from '../../composables/useServers'

const emit = defineEmits<{
    'go-setup': []
    'added': []
}>()

const discoveryState = inject<DiscoveryState>(discoveryStateInjectionKey)!
const { addServer, refresh } = useServers()

const show = ref(false)
const step = ref<'choose' | 'form' | 'configuring'>('choose')
const host = ref('')
const username = ref('root')
const password = ref('')
const shareName = ref('')
const nickname = ref('')
const showPassword = ref(false)
const testing = ref(false)
const error = ref('')

// Configuring step state
interface ProgressStep {
    label: string
    status: 'pending' | 'active' | 'done' | 'error'
}
const progressSteps = ref<ProgressStep[]>([])
const setupLogs = ref<string[]>([])

const canSubmit = computed(() => host.value.trim() && username.value.trim() && password.value && shareName.value.trim())

// Show discovered servers not already saved
const discoveredUnregistered = computed(() => {
    return discoveryState.servers.filter(s => s.status === 'complete' || s.setupComplete)
})

function selectDiscovered(srv: Server) {
    host.value = srv.ip
    if (srv.name) nickname.value = srv.name
    if (srv.shareName) shareName.value = srv.shareName
}

function setStepStatus(index: number, status: ProgressStep['status']) {
    if (progressSteps.value[index]) progressSteps.value[index].status = status
}

async function submit() {
    if (!canSubmit.value || testing.value) return
    error.value = ''
    testing.value = true

    try {
        // Test SSH connection
        const result = await window.electron.ipcRenderer.invoke('verify-ssh-credentials', {
            host: host.value.trim(),
            username: username.value.trim(),
            password: password.value,
        })

        if (!result?.success) {
            error.value = result?.error || 'Could not connect to server. Check the host, username, and password.'
            return
        }

        // SSH succeeded — move to configuring step
        testing.value = false
        await runServerSetup()
    } catch (e: any) {
        error.value = e?.message || 'An unexpected error occurred.'
    } finally {
        testing.value = false
    }
}

async function runServerSetup() {
    step.value = 'configuring'
    error.value = ''
    setupLogs.value = []
    progressSteps.value = [
        { label: 'Checking & installing server dependencies…', status: 'active' },
        { label: 'Waiting for server API to become available…', status: 'pending' },
        { label: 'Registering application on server…', status: 'pending' },
        { label: 'Saving credentials & finalizing…', status: 'pending' },
    ]

    const h = host.value.trim()
    const u = username.value.trim()
    const p = password.value
    const share = shareName.value.trim()
    const name = nickname.value.trim() || h

    try {
        // Step 1: Install server dependencies (SSH bootstrap)
        const installResult = await window.electron.ipcRenderer.invoke('setup-existing-server', {
            host: h,
            username: u,
            password: p,
        })

        if (!installResult?.success) {
            setStepStatus(0, 'error')
            error.value = installResult?.error || 'Failed to install server dependencies.'
            return
        }
        if (installResult.logs) setupLogs.value = installResult.logs
        setStepStatus(0, 'done')

        // Step 2: Wait for broadcaster API to become available
        setStepStatus(1, 'active')
        const apiReady = await window.electron.ipcRenderer.invoke('wait-for-server-api', { host: h })
        if (!apiReady?.success) {
            setStepStatus(1, 'error')
            error.value = apiReady?.error || 'Server API did not become available. The server software may not have started correctly.'
            return
        }
        setStepStatus(1, 'done')

        // Step 3: Login and register app
        setStepStatus(2, 'active')
        const registerResult = await window.electron.ipcRenderer.invoke('register-server-app', {
            host: h,
            username: u,
            password: p,
        })
        if (!registerResult?.success) {
            setStepStatus(2, 'error')
            error.value = registerResult?.error || 'Failed to register application on server.'
            return
        }
        setStepStatus(2, 'done')

        // Step 4: Save unified server entry and inject into discovery
        setStepStatus(3, 'active')

        await addServer({
            host: h,
            shareName: share,
            username: u,
            password: p,
            name: name,
            favorite: false,
        })

        await window.electron.ipcRenderer.invoke('add-manual-server', {
            ip: h,
            name,
            shareName: share,
        })

        setStepStatus(3, 'done')
        emit('added')

        // Auto-close after brief success display
        setTimeout(() => close(), 1200)
    } catch (e: any) {
        error.value = e?.message || 'An unexpected error occurred during server setup.'
        // Mark current active step as error
        const activeIdx = progressSteps.value.findIndex(s => s.status === 'active')
        if (activeIdx >= 0) setStepStatus(activeIdx, 'error')
    }
}

function retrySetup() {
    runServerSetup()
}

function open() {
    step.value = 'choose'
    host.value = ''
    username.value = 'root'
    password.value = ''
    shareName.value = ''
    nickname.value = ''
    showPassword.value = false
    error.value = ''
    testing.value = false
    progressSteps.value = []
    setupLogs.value = []
    show.value = true
}

function openForServer(srv: { ip: string; name?: string; shareName?: string }) {
    step.value = 'form'
    host.value = srv.ip
    username.value = 'root'
    password.value = ''
    shareName.value = srv.shareName || ''
    nickname.value = srv.name || ''
    showPassword.value = false
    error.value = ''
    testing.value = false
    progressSteps.value = []
    setupLogs.value = []
    show.value = true
}

function close() {
    show.value = false
}

defineExpose({ open, openForServer })
</script>
