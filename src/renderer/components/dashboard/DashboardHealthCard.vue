<template>
    <DashboardCard title="System Health">
        <div v-if="discoveredCount === 0" class="py-5 text-center text-gray-400 text-sm">
            No servers discovered on network.
        </div>
        <div v-else class="space-y-2.5">
            <!-- Network discovery (clickable to expand) -->
            <div class="cursor-pointer" @click="expanded = !expanded">
                <div class="flex items-center gap-2.5">
                    <div class="p-1.5 rounded-lg bg-selected">
                        <ServerStackIcon class="w-4 h-4 icon-primary" />
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="text-sm text-default">{{ discoveredCount }} server{{ discoveredCount !== 1 ? 's' : '' }} discovered</div>
                        <div class="text-xs text-gray-400">via mDNS / network scan</div>
                    </div>
                    <ChevronDownIcon class="w-4 h-4 text-gray-400 transition-transform" :class="expanded && 'rotate-180'" />
                </div>
            </div>

            <!-- Expanded discovered server list -->
            <div v-if="expanded" class="ml-1 border-l-2 border-neutral-200 dark:border-neutral-700 pl-3 space-y-1.5">
                <div v-for="srv in discoveryState.servers" :key="srv.ip"
                    class="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-hover transition-colors group">
                    <span class="status-dot shrink-0"
                        :class="srv.setupComplete || srv.status === 'complete' ? 'status-dot-ok' : 'status-dot-idle'" />
                    <div class="flex-1 min-w-0">
                        <div class="text-xs font-medium text-default truncate">{{ srv.name || srv.ip }}</div>
                        <div class="text-[11px] text-gray-400 truncate">
                            {{ srv.ip }}
                            <span v-if="srv.setupComplete || srv.status === 'complete'" class="text-green-500">· set up</span>
                            <span v-else class="text-amber-500">· not set up</span>
                        </div>
                    </div>
                    <button v-if="!isSaved(srv.ip)"
                        class="opacity-0 group-hover:opacity-100 text-[11px] text-link transition-opacity shrink-0"
                        @click.stop="$emit('add-server', srv)">
                        + Add
                    </button>
                    <span v-else class="text-[11px] text-gray-400 shrink-0">Saved</span>
                </div>
            </div>

            <!-- ZFS pool health (based on datasets with high usage) -->
            <div v-if="highUsageWarning" class="flex items-center gap-2.5">
                <div class="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20">
                    <ExclamationTriangleIcon class="w-4 h-4 text-amber-500" />
                </div>
                <div class="flex-1 min-w-0">
                    <div class="text-sm text-amber-700 dark:text-amber-300 font-medium">Storage {{ highUsagePercent }}% full</div>
                    <div class="text-xs text-amber-600 dark:text-amber-400">Consider freeing space</div>
                </div>
            </div>

            <!-- All clear -->
            <div v-if="!highUsageWarning"
                class="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/15">
                <ShieldCheckIcon class="w-4 h-4 text-green-500 shrink-0" />
                <span class="text-xs text-green-700 dark:text-green-300">All systems healthy</span>
            </div>
        </div>
    </DashboardCard>
</template>

<script setup lang="ts">
import { ref, computed, inject } from 'vue'
import {
    ServerStackIcon,
    ExclamationTriangleIcon,
    ShieldCheckIcon,
    ChevronDownIcon,
} from '@heroicons/vue/24/outline'
import { discoveryStateInjectionKey } from '../../keys/injection-keys'
import type { DiscoveryState, Server } from '../../types'
import DashboardCard from './DashboardCard.vue'

const props = defineProps<{
    storagePercent?: number
    savedHosts?: string[]
}>()

defineEmits<{
    'add-server': [server: Server]
}>()

const discoveryState = inject<DiscoveryState>(discoveryStateInjectionKey)!

const expanded = ref(false)
const discoveredCount = computed(() => discoveryState.servers.length)

function isSaved(ip: string): boolean {
    return (props.savedHosts ?? []).includes(ip)
}

const highUsageWarning = computed(() => (props.storagePercent ?? 0) > 85)
const highUsagePercent = computed(() => props.storagePercent ?? 0)
</script>
