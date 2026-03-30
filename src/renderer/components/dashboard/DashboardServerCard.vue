<template>
    <DashboardCard title="Saved Servers" noPad>
        <template #header-action>
            <button class="text-xs text-link transition-colors"
                @click="$emit('go-setup')">
                + Add Server
            </button>
        </template>

        <div v-if="loading" class="px-4 py-8 text-center text-gray-400 text-sm">
            Loading servers…
        </div>
        <div v-else-if="servers.length === 0" class="px-4 py-8 text-center text-gray-400 text-sm">
            No saved servers. Connect to a server to get started.
        </div>
        <div v-else class="divide-y divide-neutral-100 dark:divide-neutral-700/50">
            <div v-for="server in displayServers" :key="server.id"
                class="px-4 py-2.5 flex items-center gap-3 cursor-pointer group transition-colors"
                :class="server.host === props.selectedHost
                    ? 'bg-selected border-l-2 border-selected'
                    : 'hover:bg-hover'"
                @click="$emit('connect', server)">
                <!-- Online indicator -->
                <span class="status-dot shrink-0"
                    :class="isOnline(server.host) ? 'status-dot-ok' : 'status-dot-idle'" />

                <!-- Server info -->
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5">
                        <span class="text-sm font-medium truncate"
                            :class="server.host === props.selectedHost ? 'text-primary' : 'text-default'">
                            {{ server.name || server.host }}
                        </span>
                        <StarIcon v-if="server.favorite"
                            class="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    </div>
                    <div class="text-xs text-gray-400 truncate">
                        {{ server.username }}@{{ server.host }}
                        <span v-if="server.lastUsedAt"> · {{ formatTimeAgo(server.lastUsedAt) }}</span>
                    </div>
                </div>

                <!-- Selected indicator -->
                <span v-if="server.host === props.selectedHost"
                    class="text-xs font-medium text-primary shrink-0">Viewing</span>
            </div>
        </div>
    </DashboardCard>
</template>

<script setup lang="ts">
import { ref, computed, inject, onMounted } from 'vue'
import { StarIcon } from '@heroicons/vue/24/solid'
import { useSettings, type SavedServer } from '../../composables/useSettings'
import { discoveryStateInjectionKey } from '../../keys/injection-keys'
import type { DiscoveryState } from '../../types'
import DashboardCard from './DashboardCard.vue'
const props = defineProps<{
    selectedHost?: string
}>()
defineEmits<{
    'go-setup': []
    'connect': [server: SavedServer]
}>()

const { listServers } = useSettings()
const discoveryState = inject<DiscoveryState>(discoveryStateInjectionKey)!

const servers = ref<SavedServer[]>([])
const loading = ref(true)

const displayServers = computed(() => {
    // Favorites first, then by most recently used
    return [...servers.value].sort((a, b) => {
        if (a.favorite && !b.favorite) return -1
        if (!a.favorite && b.favorite) return 1
        return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)
    }).slice(0, 5)
})

function isOnline(host: string): boolean {
    return discoveryState.servers.some(s => s.ip === host || s.name === host)
}

function formatTimeAgo(epoch: number): string {
    const diff = Date.now() - epoch
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d ago`
    return `${Math.floor(days / 30)}mo ago`
}

onMounted(async () => {
    try {
        servers.value = await listServers()
    } catch (e) {
        console.error('Failed to load servers:', e)
    } finally {
        loading.value = false
    }
})
</script>
