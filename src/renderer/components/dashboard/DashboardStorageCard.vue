<template>
    <DashboardCard title="Server Storage">
        <div v-if="!props.serverIp" class="py-5 text-center text-gray-400 text-sm">
            Select a server to view storage.
        </div>
        <div v-else-if="loading" class="py-5 text-center text-gray-400 text-sm">Loading…</div>
        <div v-else-if="failure" class="py-5 text-center text-sm space-y-2">
            <p class="text-default font-medium">Failed to connect to “{{ serverLabel }}”</p>
            <p class="text-xs text-gray-400">{{ failureDetail }}</p>
            <div class="flex items-center justify-center gap-2 pt-1">
                <button v-if="props.serverId" class="btn btn-primary h-fit" type="button" @click="emit('manage')">
                    {{ failure.kind === 'auth' ? 'Check Username &amp; Password' : 'Open Server Settings' }}
                </button>
                <button class="btn btn-secondary h-fit" type="button" @click="retry">Retry</button>
            </div>
        </div>
        <div v-else-if="datasets.length === 0" class="py-5 text-center text-gray-400 text-sm">
            No ZFS datasets found on this server.
        </div>
        <div v-else class="space-y-3">
            <div v-for="ds in visibleDatasets" :key="ds.name" class="space-y-1">
                <div class="flex items-center justify-between text-sm">
                    <span class="text-default font-medium truncate flex-1" :title="ds.name">
                        {{ ds.name.split('/').pop() || ds.name }}
                    </span>
                    <span class="text-xs text-gray-400 shrink-0 ml-2">
                        {{ ds.used }} / {{ ds.total }}
                    </span>
                </div>
                <div class="w-full h-2 rounded-full bg-neutral-100 dark:bg-neutral-700 overflow-hidden">
                    <div class="h-full rounded-full transition-all duration-500"
                        :class="ds.percent > 90 ? 'bg-red-500' : ds.percent > 75 ? 'bg-amber-500' : 'bg-primary'"
                        :style="{ width: `${ds.percent}%` }" />
                </div>
            </div>

            <div v-if="datasets.length > COLLAPSED_COUNT" class="text-center">
                <button type="button"
                    class="text-xs text-gray-400 hover:text-default underline underline-offset-2 h-fit"
                    @click="expanded = !expanded">
                    <template v-if="expanded">Show less</template>
                    <template v-else>
                        +{{ datasets.length - COLLAPSED_COUNT }} more dataset{{ datasets.length - COLLAPSED_COUNT > 1 ? 's' : '' }}
                    </template>
                </button>
            </div>
        </div>
    </DashboardCard>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import DashboardCard from './DashboardCard.vue'
import { describeConnectionError, type ConnectivityFailure } from '../../../shared/connectionErrors'

interface DatasetInfo {
    name: string
    mountpoint: string
    used: string
    available: string
    usedbyrefreservation?: string
}

interface DisplayDataset {
    name: string
    used: string
    total: string
    percent: number
}

const props = defineProps<{
    serverIp?: string
    serverName?: string
    serverId?: string
}>()

const emit = defineEmits<{ (e: 'manage'): void }>()

const COLLAPSED_COUNT = 3

const datasets = ref<DisplayDataset[]>([])
const loading = ref(false)
const failure = ref<ConnectivityFailure | null>(null)
const expanded = ref(false)

const visibleDatasets = computed(() =>
    expanded.value ? datasets.value : datasets.value.slice(0, COLLAPSED_COUNT)
)

const serverLabel = computed(() => props.serverName?.trim() || props.serverIp || 'this server')

const failureDetail = computed(() => {
    const f = failure.value
    if (!f) return ''
    if (f.kind === 'auth') return 'The saved username or password was rejected.'
    return f.hint || f.message
})

function parseSize(s: string): number {
    const match = s.match(/([\d.]+)\s*([KMGTP]?)/i)
    if (!match) return 0
    const val = parseFloat(match[1])
    const unit = (match[2] || '').toUpperCase()
    const multipliers: Record<string, number> = { '': 1, 'K': 1024, 'M': 1048576, 'G': 1073741824, 'T': 1099511627776, 'P': 1125899906842624 }
    return val * (multipliers[unit] || 1)
}

function formatSize(bytes: number): string {
    if (bytes >= 1099511627776) return `${(bytes / 1099511627776).toFixed(1)}T`
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)}G`
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)}M`
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}K`
    return `${bytes}B`
}

let currentFetchIp = ''

async function fetchDatasets(serverIp: string) {
    if (!serverIp || serverIp === currentFetchIp) return
    currentFetchIp = serverIp
    loading.value = true
    failure.value = null
    datasets.value = []
    expanded.value = false
    try {
        const cred = await window.electron.ipcRenderer.invoke('cred:get-for', serverIp)
        if (!cred) return

        const raw: DatasetInfo[] = await window.electron.ipcRenderer.invoke(
            'snapshot:list-datasets',
            { serverIp, username: cred.username, password: cred.password }
        )
        if (!Array.isArray(raw)) return

        datasets.value = raw.map(ds => {
            const rawUsedBytes = parseSize(ds.used)
            const availBytes = parseSize(ds.available)
            const totalBytes = rawUsedBytes + availBytes
            // `used` counts refreservation as consumed even when no data is written there.
            const usedBytes = Math.max(0, rawUsedBytes - parseSize(ds.usedbyrefreservation || '0'))
            const percent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0
            return {
                name: ds.name,
                used: formatSize(usedBytes),
                total: formatSize(totalBytes),
                percent,
            }
        }).sort((a, b) => b.percent - a.percent)
    } catch (e) {
        const described = describeConnectionError(e, serverLabel.value)
        failure.value = described
        if (described.transient) {
            // Reboots and network blips clear on their own — allow another attempt
            // and keep it out of the error log.
            currentFetchIp = ''
            console.debug('[DashboardStorageCard]', described.message, described.detail)
        } else {
            console.debug('[DashboardStorageCard] connect failed:', serverLabel.value, described.detail || e)
        }
    } finally {
        loading.value = false
    }
}

function retry() {
    const ip = props.serverIp
    if (!ip) return
    currentFetchIp = ''
    fetchDatasets(ip)
}

watch(() => props.serverIp, (ip) => {
    if (ip) fetchDatasets(ip)
}, { immediate: true })
</script>
