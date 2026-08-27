<template>
    <DashboardCard title="Saved Servers" noPad>
        <template #header-action>
            <div class="flex items-center gap-3">
                <button class="text-xs text-link transition-colors"
                    @click="$emit('manage')">
                    Manage Connections
                </button>
                <button class="text-xs text-link transition-colors"
                    @click="addServerModal?.open()">
                    + Add
                </button>
            </div>
        </template>

        <div v-if="!loaded" class="px-4 py-8 text-center text-gray-400 text-sm">
            Loading servers…
        </div>
        <div v-else-if="savedServers.length === 0" class="px-4 py-8 text-center text-gray-400 text-sm">
            No saved servers. Connect to a server to get started.
        </div>
        <template v-else>
            <div class="divide-y divide-neutral-100 dark:divide-neutral-700/50">
                <div v-for="server in topServers" :key="server.id"
                    class="px-4 py-2.5 flex items-center gap-3 cursor-pointer group transition-colors"
                    :class="server.host === props.selectedHost
                        ? 'bg-selected border-l-2 border-selected'
                        : 'hover:bg-hover'"
                    @click="$emit('connect', server)"
                    @dblclick="$emit('open-manage', server)">
                    <!-- Online indicator -->
                    <span class="status-dot shrink-0"
                        :class="server.online ? 'status-dot-ok' : 'status-dot-idle'"
                        :title="server.online ? 'Online' : 'Offline / Rebooting'" />

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
                            {{ server.username }}@{{ server.host }}{{ server.shareName ? ` / ${server.shareName}` : '' }}
                            <span v-if="server.lastUsedAt"> · {{ formatTimeAgo(server.lastUsedAt) }}</span>
                        </div>
                    </div>

                    <!-- Selected indicator -->
                    <span v-if="server.host === props.selectedHost"
                        class="text-xs font-medium text-primary shrink-0">Viewing</span>

                    <button
                        class="shrink-0 p-1 rounded text-gray-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-primary hover:bg-hover transition-opacity"
                        title="Manage this server"
                        @click.stop="$emit('open-manage', server)">
                        <Cog6ToothIcon class="w-4 h-4" />
                    </button>
                </div>
            </div>

            <!-- Stale credential warning -->
            <div v-if="staleCreds.length > 0"
                class="mx-4 my-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/15 text-xs">
                <ExclamationTriangleIcon class="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                    <span class="text-amber-700 dark:text-amber-300 font-medium">
                        {{ staleCreds.length }} server{{ staleCreds.length > 1 ? 's' : '' }} unused for 30+ days
                    </span>
                    <div class="text-amber-600 dark:text-amber-400 mt-0.5">
                        {{ staleCreds.slice(0, 2).map(c => c.name || c.host).join(', ') }}{{ staleCreds.length > 2 ? ` +${staleCreds.length - 2} more` : '' }}
                    </div>
                </div>
            </div>
        </template>
    </DashboardCard>

    <AddServerModal ref="addServerModal" @go-setup="$emit('go-setup')" @added="refreshServers" />
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { StarIcon } from '@heroicons/vue/24/solid'
import { ExclamationTriangleIcon, Cog6ToothIcon } from '@heroicons/vue/24/outline'
import { useServers, type StoredServer } from '../../composables/useServers'
import AddServerModal from './AddServerModal.vue'
import DashboardCard from './DashboardCard.vue'

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000

const props = defineProps<{
    selectedHost?: string
}>()
defineEmits<{
    'go-setup': []
    'connect': [server: StoredServer]
    'manage': []
    'open-manage': [server: StoredServer]
}>()

const { savedServers, displayServers, loaded, refresh } = useServers()

const addServerModal = ref<InstanceType<typeof AddServerModal> | null>(null)

const topServers = computed(() => displayServers.value.slice(0, 5))

const staleCreds = computed(() => {
    const cutoff = Date.now() - THIRTY_DAYS
    return savedServers.value.filter(s => {
        if (!s.lastUsedAt) return true
        return s.lastUsedAt < cutoff
    })
})

async function refreshServers() {
    await refresh()
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

function addExistingServer(srv: { ip: string; name?: string }) {
    addServerModal.value?.openForServer(srv)
}

const savedHosts = computed(() => savedServers.value.map(s => s.host))

defineExpose({ addExistingServer, savedHosts })
</script>
