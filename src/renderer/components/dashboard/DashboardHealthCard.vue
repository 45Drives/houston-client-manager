<template>
    <DashboardCard title="System Health">
        <div v-if="discoveredCount === 0" class="py-5 text-center text-gray-400 text-sm">
            No servers discovered on network.
        </div>
        <div v-else class="space-y-2.5">
            <!-- Network discovery -->
            <div class="flex items-center gap-2.5">
                <div class="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                    <ServerStackIcon class="w-4 h-4 text-blue-500" />
                </div>
                <div class="flex-1 min-w-0">
                    <div class="text-sm text-default">{{ discoveredCount }} server{{ discoveredCount !== 1 ? 's' : '' }} discovered</div>
                    <div class="text-xs text-gray-400">via mDNS / network scan</div>
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
import { computed, inject } from 'vue'
import {
    ServerStackIcon,
    ExclamationTriangleIcon,
    ShieldCheckIcon,
} from '@heroicons/vue/24/outline'
import { discoveryStateInjectionKey } from '../../keys/injection-keys'
import type { DiscoveryState } from '../../types'
import DashboardCard from './DashboardCard.vue'

const props = defineProps<{
    storagePercent?: number
}>()

const discoveryState = inject<DiscoveryState>(discoveryStateInjectionKey)!

const discoveredCount = computed(() => discoveryState.servers.length)

const highUsageWarning = computed(() => (props.storagePercent ?? 0) > 85)
const highUsagePercent = computed(() => props.storagePercent ?? 0)
</script>
