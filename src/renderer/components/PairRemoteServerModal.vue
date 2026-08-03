<template>
    <Modal :show="show" @clickOutside="close">
        <div class="w-full max-w-lg mx-auto bg-default p-6 rounded-xl shadow">
            <!-- Header -->
            <div class="flex items-center justify-between mb-4">
                <h2 class="text-lg font-semibold text-default">
                    {{ step === 'done' ? 'Tunnel Connected' : 'VPN Tunnel Pairing' }}
                </h2>
                <button @click="close" class="text-muted hover:text-default">
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <!-- Step: Choose role -->
            <div v-if="step === 'choose'" class="space-y-4">
                <p class="text-sm text-muted">
                    Create a secure WireGuard tunnel between
                    <strong class="text-default">{{ serverName }}</strong> and another server.
                </p>

                <div>
                    <label class="block text-sm font-medium text-default mb-1">Tunnel Name <span class="text-muted">(optional)</span></label>
                    <input v-model="tunnelName" type="text" maxlength="12" placeholder="e.g. offsite-bkp"
                        class="w-full input-textlike rounded-md px-3 py-2 text-sm bg-default" />
                    <p class="text-xs text-muted mt-1">Max 12 characters.</p>
                </div>

                <div>
                    <label class="block text-sm font-medium text-default mb-1">Code Timeout</label>
                    <select v-model="codeTtl" class="w-full input-textlike rounded-md px-3 py-2 text-sm bg-default">
                        <option :value="15">15 minutes</option>
                        <option :value="30">30 minutes</option>
                        <option :value="60">1 hour</option>
                        <option :value="120">2 hours</option>
                    </select>
                    <p class="text-xs text-muted mt-1">Increase if you need to physically visit the other server.</p>
                </div>

                <div class="grid grid-cols-2 gap-3 mt-2">
                    <button @click="doInitiate" :disabled="busy"
                        class="p-3 border-2 border-blue-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition h-fit text-left">
                        <div class="font-medium text-default text-sm">Create Code</div>
                        <div class="text-xs text-muted mt-0.5">Generate a code for the other server</div>
                    </button>
                    <button @click="step = 'join'" :disabled="busy"
                        class="p-3 border-2 border-neutral-200 dark:border-neutral-700 rounded-lg hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition h-fit text-left">
                        <div class="font-medium text-default text-sm">Enter Code</div>
                        <div class="text-xs text-muted mt-0.5">Join using a code from another server</div>
                    </button>
                </div>
            </div>

            <!-- Step: Initiator waiting -->
            <div v-else-if="step === 'initiate'" class="space-y-4">
                <p class="text-sm text-muted">Enter this code on the other server to pair.</p>
                <div class="text-4xl font-mono font-bold text-center tracking-widest text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg py-6">
                    {{ pairingCode }}
                </div>
                <p class="text-xs text-muted text-center">
                    Waiting for peer... Expires in {{ codeTtl }} minutes.
                </p>
                <div v-if="pollError" class="text-xs text-red-500 text-center">{{ pollError }}</div>
            </div>

            <!-- Step: Join -->
            <div v-else-if="step === 'join'" class="space-y-4">
                <p class="text-sm text-muted">Enter the 6-character code from the other server.</p>
                <div>
                    <label class="block text-sm font-medium text-default mb-1">Tunnel Name <span class="text-muted">(optional)</span></label>
                    <input v-model="tunnelName" type="text" maxlength="12" placeholder="e.g. main-srv"
                        class="w-full input-textlike rounded-md px-3 py-2 text-sm bg-default" />
                    <p class="text-xs text-muted mt-1">Max 12 characters.</p>
                </div>
                <input v-model="joinCode" type="text" maxlength="6" placeholder="ABC123"
                    class="w-full input-textlike rounded-md px-4 py-3 text-center text-2xl font-mono tracking-widest uppercase bg-default"
                    @keyup.enter="doJoin" />
                <div class="flex gap-2">
                    <button @click="step = 'choose'" class="btn btn-secondary h-fit">Back</button>
                    <button @click="doJoin" :disabled="busy || joinCode.length !== 6" class="btn btn-primary h-fit flex-1">
                        {{ busy ? 'Connecting...' : 'Join' }}
                    </button>
                </div>
            </div>

            <!-- Step: Configuring -->
            <div v-else-if="step === 'configuring'" class="space-y-4 text-center py-4">
                <div class="animate-spin h-8 w-8 border-4 border-blue-200 border-t-blue-600 rounded-full mx-auto"></div>
                <p class="text-sm text-default">Configuring WireGuard tunnel...</p>
            </div>

            <!-- Step: Done -->
            <div v-else-if="step === 'done'" class="space-y-4">
                <div class="text-center py-2">
                    <svg class="w-12 h-12 text-green-500 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>
                <div v-if="tunnelInfo" class="bg-neutral-50 dark:bg-neutral-800 rounded-lg p-3 text-sm space-y-1">
                    <div class="flex justify-between"><span class="text-muted">Interface:</span><span class="font-mono text-default">{{ tunnelInfo.interface }}</span></div>
                    <div class="flex justify-between"><span class="text-muted">Address:</span><span class="font-mono text-default">{{ tunnelInfo.address }}</span></div>
                    <div class="flex justify-between"><span class="text-muted">Peer:</span><span class="font-mono text-default">{{ tunnelInfo.peerEndpoint }}</span></div>
                </div>
                <button @click="close" class="btn btn-primary h-fit w-full">Done</button>
            </div>

            <!-- Error display -->
            <div v-if="error" class="mt-3 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-300">
                {{ error }}
            </div>
        </div>
    </Modal>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { Modal } from '@45drives/houston-common-ui'
import { useWireWizard, type PairCompleteResult, type PollResult } from '../composables/useWireWizard'

const props = defineProps<{
    show: boolean
    serverHost: string
    serverUsername: string
    serverName?: string
}>()

const emit = defineEmits<{
    close: []
    paired: [info: PairCompleteResult]
}>()

type Step = 'choose' | 'initiate' | 'join' | 'configuring' | 'done'

const step = ref<Step>('choose')
const tunnelName = ref('')
const codeTtl = ref(15)
const pairingCode = ref('')
const joinCode = ref('')
const error = ref('')
const pollError = ref('')
const tunnelInfo = ref<PairCompleteResult | null>(null)

let pollTimer: ReturnType<typeof setInterval> | null = null

const ww = useWireWizard(
    () => props.serverHost,
    () => props.serverUsername,
)
const busy = ww.busy

async function doInitiate() {
    error.value = ''
    const result = await ww.initiate({ name: tunnelName.value.trim() || undefined, ttl: codeTtl.value })
    if (!result) {
        error.value = ww.lastError.value || 'Failed to initiate pairing'
        return
    }
    pairingCode.value = result.code
    step.value = 'initiate'
    startPolling(result.code)
}

function startPolling(code: string) {
    let failures = 0
    pollTimer = setInterval(async () => {
        const pollResult = await ww.poll(code)
        if (!pollResult) {
            failures++
            if (failures > 5) {
                pollError.value = 'Lost connection to server. Is it still online?'
            }
            return
        }
        failures = 0
        pollError.value = ''
        if (pollResult.claimed && pollResult.claimer) {
            stopPolling()
            step.value = 'configuring'
            await doComplete(code, pollResult.claimer)
        }
    }, 3000)
}

async function doComplete(code: string, claimer: NonNullable<PollResult['claimer']>) {
    const result = await ww.complete(code, {
        publicKey: claimer.publicKey,
        endpoint: claimer.endpoint,
        localEndpoint: claimer.localEndpoint,
        natEndpoint: claimer.natEndpoint,
    })
    if (!result) {
        error.value = ww.lastError.value || 'Failed to complete pairing'
        step.value = 'initiate'
        return
    }
    tunnelInfo.value = result
    step.value = 'done'
    emit('paired', result)
}

async function doJoin() {
    error.value = ''
    const result = await ww.join(joinCode.value.trim(), { name: tunnelName.value.trim() || undefined })
    if (!result) {
        error.value = ww.lastError.value || 'Failed to join'
        return
    }
    tunnelInfo.value = result
    step.value = 'done'
    emit('paired', result)
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
    }
}

function close() {
    stopPolling()
    emit('close')
}

onUnmounted(stopPolling)
</script>
