<template>
    <DashboardCard title="Credential Vault" noPad>
        <template #header-action>
            <button class="text-xs text-link transition-colors"
                @click="$emit('manage')">
                Manage
            </button>
        </template>

        <div v-if="loading" class="px-4 py-4 text-center text-gray-400 text-sm">Loading…</div>
        <div v-else class="px-4 py-3 space-y-3">
            <!-- Summary stats -->
            <div class="grid grid-cols-2 gap-3">
                <div class="text-center p-2 rounded-lg bg-neutral-50 dark:bg-neutral-700/30">
                    <div class="text-lg font-semibold text-default">{{ totalCreds }}</div>
                    <div class="text-xs text-gray-400">Saved Credentials</div>
                </div>
                <div class="text-center p-2 rounded-lg bg-neutral-50 dark:bg-neutral-700/30">
                    <div class="text-lg font-semibold text-default">{{ serverCount }}</div>
                    <div class="text-xs text-gray-400">Servers</div>
                </div>
            </div>

            <!-- Stale credential warning -->
            <div v-if="staleCreds.length > 0"
                class="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/15 text-xs">
                <ExclamationTriangleIcon class="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                    <span class="text-amber-700 dark:text-amber-300 font-medium">
                        {{ staleCreds.length }} credential{{ staleCreds.length > 1 ? 's' : '' }} unused for 30+ days
                    </span>
                    <div class="text-amber-600 dark:text-amber-400 mt-0.5">
                        {{ staleCreds.slice(0, 2).map(c => c.host).join(', ') }}{{ staleCreds.length > 2 ? ` +${staleCreds.length - 2} more` : '' }}
                    </div>
                </div>
            </div>

            <!-- All healthy -->
            <div v-else-if="totalCreds > 0"
                class="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/15 text-xs">
                <ShieldCheckIcon class="w-4 h-4 text-green-500 shrink-0" />
                <span class="text-green-700 dark:text-green-300">All credentials recently used</span>
            </div>
        </div>
    </DashboardCard>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { ExclamationTriangleIcon, ShieldCheckIcon } from '@heroicons/vue/24/outline'
import DashboardCard from './DashboardCard.vue'

defineEmits<{ 'manage': [] }>()

interface CredSummary {
    host: string
    share: string
    username: string
    lastUsedAt?: number
    createdAt: string
}

const credentials = ref<CredSummary[]>([])
const loading = ref(true)

const totalCreds = computed(() => credentials.value.length)
const serverCount = computed(() => new Set(credentials.value.map(c => c.host)).size)

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000
const staleCreds = computed(() => {
    const cutoff = Date.now() - THIRTY_DAYS
    return credentials.value.filter(c => {
        if (!c.lastUsedAt) return true // never used counts as stale
        return c.lastUsedAt < cutoff
    })
})

onMounted(async () => {
    try {
        credentials.value = await window.electron.ipcRenderer.invoke('credentials:list') ?? []
    } catch (e) {
        console.error('Failed to load credentials:', e)
    } finally {
        loading.value = false
    }
})
</script>
