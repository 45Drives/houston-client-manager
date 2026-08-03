<template>
    <Modal :show="show" @clickOutside="close">
        <div class="bg-white dark:bg-neutral-850 rounded-xl shadow-xl p-6 w-full max-w-lg">
            <!-- Header -->
            <div class="flex items-center justify-between mb-4">
                <div>
                    <h2 class="text-lg font-bold text-default font-mono">{{ tunnel.name }}</h2>
                    <p class="text-xs text-muted">WireGuard Tunnel Management</p>
                </div>
                <button @click="close" class="text-muted hover:text-default">
                    <XMarkIcon class="w-5 h-5" />
                </button>
            </div>

            <!-- Tunnel Info -->
            <div class="bg-neutral-50 dark:bg-neutral-800 rounded-lg p-3 mb-4 text-sm space-y-1">
                <div class="grid grid-cols-2 gap-x-4 gap-y-1">
                    <div><span class="text-muted">Port:</span> <span class="text-default">{{ tunnel.listenPort }}</span></div>
                    <div><span class="text-muted">Public Key:</span> <span class="text-default font-mono text-xs">{{ tunnel.publicKey?.slice(0, 16) }}…</span></div>
                    <div><span class="text-muted">Peers:</span> <span class="text-default">{{ tunnel.peers.length }}</span></div>
                    <div>
                        <span class="text-muted">Status:</span>
                        <span v-if="hasHandshake" class="text-green-600 dark:text-green-400">Connected</span>
                        <span v-else class="text-amber-600 dark:text-amber-400">No handshake</span>
                    </div>
                </div>
            </div>

            <!-- Action Buttons -->
            <div class="flex items-center gap-2 mb-4">
                <button @click="doRestart" :disabled="busy"
                    class="btn btn-sm btn-secondary h-fit inline-flex items-center gap-1">
                    <ArrowPathIcon class="w-3.5 h-3.5" :class="{ 'animate-spin': restarting }" />
                    Restart
                </button>
                <template v-if="!confirmingTeardown">
                    <button @click="confirmingTeardown = true" :disabled="busy"
                        class="btn btn-sm h-fit inline-flex items-center gap-1 text-red-600 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/20">
                        <TrashIcon class="w-3.5 h-3.5" />
                        Remove Tunnel
                    </button>
                </template>
                <template v-else>
                    <span class="text-xs text-red-600 dark:text-red-400">Remove {{ tunnel.name }}?</span>
                    <button @click="doTeardown" :disabled="busy"
                        class="btn btn-sm h-fit text-red-600 border-red-400 hover:bg-red-100 dark:text-red-400 dark:border-red-700 dark:hover:bg-red-900/30">
                        Confirm
                    </button>
                    <button @click="confirmingTeardown = false"
                        class="btn btn-sm btn-secondary h-fit">
                        Cancel
                    </button>
                </template>
            </div>

            <!-- Peers List -->
            <div class="mb-3">
                <div class="flex items-center justify-between mb-2">
                    <h3 class="text-sm font-semibold text-default">Peers</h3>
                    <button @click="showAddPeer = true" :disabled="busy"
                        class="text-xs text-muted hover:text-default">+ Add Peer</button>
                </div>

                <div v-if="!tunnel.peers.length" class="text-xs text-muted">No peers configured.</div>

                <div v-for="peer in tunnel.peers" :key="peer.publicKey"
                    class="bg-neutral-50 dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 p-3 mb-2">
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-xs font-mono text-default">{{ peer.publicKey.slice(0, 20) }}…</span>
                        <div class="flex items-center gap-2">
                            <span v-if="peer.latestHandshake > 0"
                                class="w-2 h-2 rounded-full bg-green-500"></span>
                            <span v-else class="w-2 h-2 rounded-full bg-amber-400"></span>
                            <button @click="startEditPeer(peer)" class="text-xs text-link hover:underline">Edit</button>
                            <template v-if="confirmingRemovePeer !== peer.publicKey">
                                <button @click="confirmingRemovePeer = peer.publicKey" class="text-xs text-red-500 hover:text-red-700">Remove</button>
                            </template>
                            <template v-else>
                                <button @click="doRemovePeer(peer)" class="text-xs text-red-600 font-medium">Confirm</button>
                                <button @click="confirmingRemovePeer = null" class="text-xs text-muted">Cancel</button>
                            </template>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-1 text-xs text-muted">
                        <div>Endpoint: <span class="text-default font-mono">{{ peer.endpoint || '—' }}</span></div>
                        <div>Allowed IPs: <span class="text-default font-mono">{{ peer.allowedIPs }}</span></div>
                        <div>Rx: <span class="text-default">{{ formatBytes(peer.transferRx) }}</span></div>
                        <div>Tx: <span class="text-default">{{ formatBytes(peer.transferTx) }}</span></div>
                    </div>
                </div>
            </div>

            <!-- Error -->
            <div v-if="error" class="mt-3 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-300">
                {{ error }}
            </div>

            <!-- Add/Edit Peer Form -->
            <Teleport to="body">
                <Modal :show="showAddPeer || !!editingPeer" @clickOutside="closePeerForm" forceFullWidth>
                    <div class="bg-white dark:bg-neutral-850 rounded-xl shadow-xl p-6 w-full max-w-sm mx-auto">
                        <h3 class="text-base font-bold text-default mb-4">
                            {{ editingPeer ? 'Edit Peer' : 'Add Peer' }}
                        </h3>
                        <div class="space-y-3">
                            <div>
                                <label class="text-xs text-muted block mb-1">Public Key</label>
                                <input v-model="peerForm.pubkey" type="text"
                                    :disabled="!!editingPeer"
                                    class="input-textlike text-default bg-default w-full text-sm font-mono"
                                    placeholder="Base64 WireGuard public key" />
                            </div>
                            <div>
                                <label class="text-xs text-muted block mb-1">Endpoint <span class="text-muted">(optional)</span></label>
                                <input v-model="peerForm.endpoint" type="text"
                                    class="input-textlike text-default bg-default w-full text-sm font-mono"
                                    placeholder="IP:port or hostname:port" />
                            </div>
                            <div>
                                <label class="text-xs text-muted block mb-1">Allowed IPs</label>
                                <input v-model="peerForm.allowedIPs" type="text"
                                    class="input-textlike text-default bg-default w-full text-sm font-mono"
                                    placeholder="10.45.0.0/24" />
                            </div>
                            <div>
                                <label class="text-xs text-muted block mb-1">Keepalive (seconds)</label>
                                <input v-model.number="peerForm.keepalive" type="number" min="0" max="300"
                                    class="input-textlike text-default bg-default w-24 text-sm" />
                            </div>
                        </div>
                        <div class="flex items-center justify-end gap-2 mt-5">
                            <button @click="closePeerForm" class="btn btn-sm btn-secondary h-fit">Cancel</button>
                            <button @click="savePeer" :disabled="!peerForm.pubkey || busy"
                                class="btn btn-sm btn-primary h-fit">
                                {{ editingPeer ? 'Save' : 'Add' }}
                            </button>
                        </div>
                    </div>
                </Modal>
            </Teleport>
        </div>
    </Modal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { XMarkIcon, ArrowPathIcon, TrashIcon } from '@heroicons/vue/24/outline'
import { Modal, Notification, pushNotification } from '@45drives/houston-common-ui'
import type { WireWizardTunnel } from '../composables/useWireWizard'

const props = defineProps<{
    show: boolean
    tunnel: WireWizardTunnel
    ww: ReturnType<typeof import('../composables/useWireWizard').useWireWizard>
}>()

const emit = defineEmits<{
    close: []
    changed: []
    removed: []
}>()

const error = ref('')
const restarting = ref(false)
const confirmingTeardown = ref(false)
const confirmingRemovePeer = ref<string | null>(null)
const showAddPeer = ref(false)
const editingPeer = ref<WireWizardTunnel['peers'][number] | null>(null)
const peerForm = ref({ pubkey: '', endpoint: '', allowedIPs: '10.45.0.0/24', keepalive: 25 })

const busy = computed(() => props.ww.busy.value)

const hasHandshake = computed(() =>
    props.tunnel.peers.some(p => p.latestHandshake > 0)
)

function formatBytes(bytes: number): string {
    if (!bytes || bytes < 1024) return `${bytes || 0} B`
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
    return `${(bytes / 1073741824).toFixed(2)} GB`
}

async function doRestart() {
    error.value = ''
    restarting.value = true
    const ok = await props.ww.restart(props.tunnel.name)
    restarting.value = false
    if (ok) {
        pushNotification(new Notification('Restarted', `${props.tunnel.name} restarted.`, 'success', 3000))
        emit('changed')
    } else {
        error.value = props.ww.lastError.value || 'Restart failed'
    }
}

async function doTeardown() {
    confirmingTeardown.value = false
    error.value = ''
    const ok = await props.ww.teardown(props.tunnel.name)
    if (ok) {
        pushNotification(new Notification('Removed', `${props.tunnel.name} removed.`, 'success', 3000))
        emit('removed')
    } else {
        error.value = props.ww.lastError.value || 'Teardown failed'
    }
}

function startEditPeer(peer: WireWizardTunnel['peers'][number]) {
    editingPeer.value = peer
    peerForm.value = {
        pubkey: peer.publicKey,
        endpoint: peer.endpoint || '',
        allowedIPs: peer.allowedIPs,
        keepalive: peer.keepalive || 25,
    }
}

function closePeerForm() {
    showAddPeer.value = false
    editingPeer.value = null
    peerForm.value = { pubkey: '', endpoint: '', allowedIPs: '10.45.0.0/24', keepalive: 25 }
}

async function savePeer() {
    error.value = ''
    const peerData = {
        pubkey: peerForm.value.pubkey.trim(),
        endpoint: peerForm.value.endpoint.trim() || undefined,
        allowedIPs: peerForm.value.allowedIPs.trim() || undefined,
        keepalive: peerForm.value.keepalive || undefined,
    }

    let ok: boolean
    if (editingPeer.value) {
        ok = await props.ww.editPeer(props.tunnel.name, peerData)
    } else {
        ok = await props.ww.addPeer(props.tunnel.name, peerData)
    }

    if (ok) {
        pushNotification(new Notification('Saved', editingPeer.value ? 'Peer updated.' : 'Peer added.', 'success', 3000))
        closePeerForm()
        emit('changed')
    } else {
        error.value = props.ww.lastError.value || 'Operation failed'
    }
}

async function doRemovePeer(peer: WireWizardTunnel['peers'][number]) {
    confirmingRemovePeer.value = null
    error.value = ''
    const ok = await props.ww.removePeer(props.tunnel.name, peer.publicKey)
    if (ok) {
        pushNotification(new Notification('Removed', 'Peer removed.', 'success', 3000))
        emit('changed')
    } else {
        error.value = props.ww.lastError.value || 'Remove failed'
    }
}

function close() {
    emit('close')
}
</script>
