<template>
    <Modal :show="show" @clickOutside="close">
        <div class="w-full max-w-2xl mx-auto bg-default p-6 rounded-xl shadow">
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
                    <label class="block text-sm font-medium text-default mb-1">Tunnel Name <span class="text-red-500">*</span></label>
                    <input v-model="tunnelName" type="text" maxlength="15" placeholder="e.g. offsite-bkp"
                        class="w-full input-textlike rounded-md px-3 py-2 text-sm bg-default" />
                    <p class="text-xs mt-1" :class="tunnelName.length > 0 && !nameValid ? 'text-red-500' : 'text-muted'">
                        Letters, numbers and dashes, up to 15 characters. The other server reuses this name.
                    </p>
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

                <!-- Advanced Options -->
                <details class="mt-1" @toggle="(e: Event) => advancedOpen = (e.target as HTMLDetailsElement).open">
                    <summary class="text-xs text-muted cursor-pointer hover:text-default select-none">Advanced Options</summary>
                    <div class="mt-2 space-y-3 pl-1">
                        <div>
                            <label class="block text-xs text-muted mb-1">Listen Port <span class="text-muted">(optional)</span></label>
                            <input v-model.number="listenPort" type="number" min="1024" max="65535" placeholder="Auto"
                                class="w-32 input-textlike rounded-md px-3 py-1.5 text-sm bg-default font-mono" />
                            <p class="text-xs text-muted mt-0.5">Default: auto-selects next available from 51820.</p>
                        </div>
                        <div>
                            <label class="block text-xs text-muted mb-1">Endpoint Override <span class="text-muted">(optional)</span></label>
                            <input v-model="endpointOverride" type="text" placeholder="IP:port or hostname:port"
                                class="w-full input-textlike rounded-md px-3 py-1.5 text-sm bg-default font-mono" />
                            <p class="text-xs text-muted mt-0.5">Override the auto-detected public endpoint.</p>
                        </div>
                    </div>
                </details>

                <div class="grid grid-cols-2 gap-3 mt-2">
                    <button @click="doInitiate" :disabled="busy || !nameValid"
                        class="p-3 border-2 border-blue-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition h-fit text-left disabled:opacity-50 disabled:cursor-not-allowed">
                        <div class="font-medium text-default text-sm">Create Code</div>
                        <div class="text-xs text-muted mt-0.5">Generate a code for the other server</div>
                    </button>
                    <button @click="tunnelName = ''; step = 'join'" :disabled="busy"
                        class="p-3 border-2 border-neutral-200 dark:border-neutral-700 rounded-lg hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition h-fit text-left">
                        <div class="font-medium text-default text-sm">Enter Code</div>
                        <div class="text-xs text-muted mt-0.5">Join using a code from another server</div>
                    </button>
                </div>

                <div class="rounded-md bg-neutral-50 dark:bg-neutral-800 p-2 text-xs text-muted">
                    Cross-network tip: if either side is behind a router, forward the UDP listen port (default 51820) before pairing.
                </div>
                <div class="flex items-center gap-2">
                    <button @click="runNetworkCheck" :disabled="busy" class="btn btn-secondary h-fit text-xs">
                        {{ busy ? 'Checking…' : 'Run Network Check' }}
                    </button>
                    <span v-if="networkCheckResult" :class="['text-xs', networkCheckResult.status === 'ok' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400']">
                        {{ networkCheckResult.status === 'ok' ? 'Ready' : 'Needs Attention' }}
                    </span>
                </div>
                <div v-if="networkCheckResult" class="rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 p-2 text-xs space-y-1">
                    <div class="text-default">{{ networkCheckResult.message }}</div>
                    <div class="text-muted">VPS: {{ networkCheckResult.vpsReachable ? 'reachable' : 'unreachable' }} (HTTP {{ networkCheckResult.vpsHttpCode }})</div>
                    <div class="text-muted">Public IP: <span class="font-mono text-default">{{ networkCheckResult.publicIp || 'unknown' }}</span></div>
                    <div class="text-muted">NAT: <span class="font-mono text-default">{{ networkCheckResult.natDiscovered ? (networkCheckResult.natEndpoint || 'detected') : 'not detected' }}</span></div>
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

                <div class="rounded-md border border-neutral-200 dark:border-neutral-700 p-3">
                    <div class="flex items-center justify-between">
                        <span class="text-sm font-medium text-default">No Houston or Cockpit on the other server?</span>
                        <button class="text-xs text-muted hover:text-default h-fit" @click="showCli = !showCli">
                            {{ showCli ? 'Hide' : 'Show CLI command' }}
                        </button>
                    </div>
                    <div v-if="showCli" class="mt-3 space-y-2">
                        <p class="text-xs text-muted">Run this on the other server as root:</p>
                        <pre class="bg-neutral-50 dark:bg-neutral-800 rounded px-3 py-2 text-xs font-mono overflow-x-auto text-default">{{ cliJoinCommand }}</pre>
                        <p class="text-xs text-muted">Or with plain curl:</p>
                        <pre class="bg-neutral-50 dark:bg-neutral-800 rounded px-3 py-2 text-xs font-mono overflow-x-auto text-default">{{ curlJoinCommand }}</pre>
                        <button class="btn btn-secondary h-fit text-xs" @click="copyCli">
                            {{ cliCopied ? 'Copied' : 'Copy commands' }}
                        </button>
                    </div>
                </div>

                <div v-if="pollError" class="text-xs text-red-500 text-center">{{ pollError }}</div>
            </div>

            <!-- Step: Join -->
            <div v-else-if="step === 'join'" class="space-y-4">
                <p class="text-sm text-muted">Enter the 6-character code from the other server.</p>
                <div class="flex items-center gap-2">
                    <button @click="runNetworkCheck" :disabled="busy" class="btn btn-secondary h-fit text-xs">
                        {{ busy ? 'Checking…' : 'Run Network Check' }}
                    </button>
                    <span v-if="networkCheckResult" :class="['text-xs', networkCheckResult.status === 'ok' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400']">
                        {{ networkCheckResult.status === 'ok' ? 'Ready' : 'Needs Attention' }}
                    </span>
                </div>
                <div v-if="networkCheckResult" class="rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 p-2 text-xs space-y-1">
                    <div class="text-default">{{ networkCheckResult.message }}</div>
                    <div class="text-muted">VPS: {{ networkCheckResult.vpsReachable ? 'reachable' : 'unreachable' }} (HTTP {{ networkCheckResult.vpsHttpCode }})</div>
                    <div class="text-muted">Public IP: <span class="font-mono text-default">{{ networkCheckResult.publicIp || 'unknown' }}</span></div>
                    <div class="text-muted">NAT: <span class="font-mono text-default">{{ networkCheckResult.natDiscovered ? (networkCheckResult.natEndpoint || 'detected') : 'not detected' }}</span></div>
                </div>
                <input v-model="joinCode" type="text" maxlength="6" placeholder="ABC123"
                    class="w-full input-textlike rounded-md px-4 py-3 text-center text-2xl font-mono tracking-widest uppercase bg-default"
                    @keyup.enter="doJoin" />

                <!-- Advanced Options (Join) -->
                <details class="mt-1" @toggle="(e: Event) => advancedOpen = (e.target as HTMLDetailsElement).open">
                    <summary class="text-xs text-muted cursor-pointer hover:text-default select-none">Advanced Options</summary>
                    <div class="mt-2 space-y-3 pl-1">
                        <div>
                            <label class="block text-xs text-muted mb-1">Override Tunnel Name <span class="text-muted">(optional)</span></label>
                            <input v-model="tunnelName" type="text" maxlength="15" placeholder="Match the other server"
                                class="w-full input-textlike rounded-md px-3 py-1.5 text-sm bg-default" />
                            <p class="text-xs text-muted mt-0.5">Default: reuse the name from the server that created the code.</p>
                        </div>
                        <div>
                            <label class="block text-xs text-muted mb-1">Listen Port <span class="text-muted">(optional)</span></label>
                            <input v-model.number="listenPort" type="number" min="1024" max="65535" placeholder="Auto"
                                class="w-32 input-textlike rounded-md px-3 py-1.5 text-sm bg-default font-mono" />
                            <p class="text-xs text-muted mt-0.5">Default: auto-selects next available from 51820.</p>
                        </div>
                        <div>
                            <label class="block text-xs text-muted mb-1">Endpoint Override <span class="text-muted">(optional)</span></label>
                            <input v-model="endpointOverride" type="text" placeholder="IP:port or hostname:port"
                                class="w-full input-textlike rounded-md px-3 py-1.5 text-sm bg-default font-mono" />
                            <p class="text-xs text-muted mt-0.5">Override the auto-detected public endpoint.</p>
                        </div>
                    </div>
                </details>

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
import { computed, ref, watch, onUnmounted } from 'vue'
import { Modal } from '@45drives/houston-common-ui'
import { useWireWizard, type PairCompleteResult, type PollResult, type WireWizardNetworkCheck } from '../composables/useWireWizard'

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
const listenPort = ref<number | undefined>(undefined)
const endpointOverride = ref('')
const advancedOpen = ref(false)
const error = ref('')
const pollError = ref('')
const tunnelInfo = ref<PairCompleteResult | null>(null)
const networkCheckResult = ref<WireWizardNetworkCheck | null>(null)
const showCli = ref(false)
const cliCopied = ref(false)

const cliJoinCommand = computed(() => `sudo wireshield-pair join ${pairingCode.value || 'ABC123'}`)

// Mirrors the server-side sanitizer: anything outside [a-z0-9-] is stripped there.
const nameValid = computed(() => /^[a-z0-9][a-z0-9 _-]*$/i.test(tunnelName.value.trim()))

const curlJoinCommand = computed(() => [
    'source /etc/wireshield/api.env',
    'curl -sk -X POST https://127.0.0.1:8420/api/v1/pairing/join \\',
    '  -H "Content-Type: application/json" -H "X-API-Key: $HNE_API_KEY" \\',
    `  -d '{"code":"${pairingCode.value || 'ABC123'}"}'`,
].join('\n'))

async function copyCli() {
    await navigator.clipboard.writeText(`${cliJoinCommand.value}\n\n${curlJoinCommand.value}`)
    cliCopied.value = true
    setTimeout(() => (cliCopied.value = false), 2000)
}

let pollTimer: ReturnType<typeof setTimeout> | null = null

const ww = useWireWizard(
    () => props.serverHost,
    () => props.serverUsername,
)
const busy = ww.busy

const ENDPOINT_RE = /^(?:\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+):([0-9]{1,5})$/

function validateEndpoint(endpoint: string): string | null {
    const trimmed = endpoint.trim()
    if (!trimmed) return null

    const match = trimmed.match(ENDPOINT_RE)
    if (!match) {
        return 'Endpoint must be in host:port format (for example 203.0.113.5:51820).'
    }

    const port = Number(match[1])
    if (port < 1 || port > 65535) {
        return 'Endpoint port must be between 1 and 65535.'
    }

    return null
}

// Reset state when modal opens
watch(() => props.show, (showing) => {
    if (showing) {
        step.value = 'choose'
        tunnelName.value = ''
        pairingCode.value = ''
        joinCode.value = ''
        listenPort.value = undefined
        endpointOverride.value = ''
        advancedOpen.value = false
        error.value = ''
        pollError.value = ''
        tunnelInfo.value = null
        networkCheckResult.value = null
        showCli.value = false
        cliCopied.value = false
    }
})

async function runNetworkCheck() {
    error.value = ''
    const result = await ww.networkCheck({
        port: advancedOpen.value && listenPort.value ? listenPort.value : undefined,
    })
    if (!result) {
        error.value = ww.lastError.value || 'Network check failed'
        networkCheckResult.value = null
        return
    }
    networkCheckResult.value = result
}

async function ensureNetworkReadyOrConfirmed(actionLabel: string): Promise<boolean> {
    if (!networkCheckResult.value) {
        await runNetworkCheck()
        if (!networkCheckResult.value) {
            return false
        }
    }

    if (networkCheckResult.value.status === 'warning') {
        return window.confirm(`${networkCheckResult.value.message}\n\nContinue ${actionLabel} anyway?`)
    }

    return true
}

async function doInitiate() {
    error.value = ''
    if (advancedOpen.value) {
        const endpointError = validateEndpoint(endpointOverride.value)
        if (endpointError) {
            error.value = endpointError
            return
        }
    }

    const canProceed = await ensureNetworkReadyOrConfirmed('creating a pairing code')
    if (!canProceed) {
        return
    }

    const result = await ww.initiate({
        name: tunnelName.value.trim() || undefined,
        ttl: codeTtl.value,
        port: advancedOpen.value && listenPort.value ? listenPort.value : undefined,
        endpoint: advancedOpen.value && endpointOverride.value.trim() ? endpointOverride.value.trim() : undefined,
    })
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
    let stopped = false

    async function doPoll() {
        if (stopped) return
        const pollResult = await ww.poll(code)
        if (stopped) return
        if (!pollResult) {
            failures++
            if (failures > 5) {
                pollError.value = 'Lost connection to server. Is it still online?'
            }
            pollTimer = setTimeout(doPoll, 5000)
            return
        }
        failures = 0
        pollError.value = ''
        if (pollResult.completed) {
            stopped = true
            step.value = 'configuring'
            tunnelInfo.value = pollResult.completed
            step.value = 'done'
            emit('paired', pollResult.completed)
        } else if (pollResult.claimed && pollResult.claimer) {
            stopped = true
            step.value = 'configuring'
            await doComplete(code, pollResult.claimer)
        } else {
            pollTimer = setTimeout(doPoll, 4000)
        }
    }

    pollTimer = setTimeout(doPoll, 3000)
    // Override stopPolling to also flag stopped
    const origStop = stopPolling
    stopPolling = () => { stopped = true; origStop() }
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
    if (advancedOpen.value) {
        const endpointError = validateEndpoint(endpointOverride.value)
        if (endpointError) {
            error.value = endpointError
            return
        }
    }

    const canProceed = await ensureNetworkReadyOrConfirmed('connecting')
    if (!canProceed) {
        return
    }

    const result = await ww.join(joinCode.value.trim(), {
        name: tunnelName.value.trim() || undefined,
        port: advancedOpen.value && listenPort.value ? listenPort.value : undefined,
        endpoint: advancedOpen.value && endpointOverride.value.trim() ? endpointOverride.value.trim() : undefined,
    })
    if (!result) {
        error.value = ww.lastError.value || 'Failed to join'
        return
    }
    tunnelInfo.value = result
    step.value = 'done'
    emit('paired', result)
}

let stopPolling = () => {
    if (pollTimer) {
        clearTimeout(pollTimer)
        pollTimer = null
    }
}

function close() {
    stopPolling()
    emit('close')
}

onUnmounted(stopPolling)
</script>
