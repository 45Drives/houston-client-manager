<template>
    <DashboardCard title="Last Restore Run">
        <div v-if="!lastRestore" class="py-5 text-center text-gray-400 text-sm">
            No restores performed yet.
        </div>
        <div v-else class="flex items-start gap-3">
            <div class="mt-0.5 p-1.5 rounded-lg"
                :class="lastRestore.success
                    ? 'bg-green-50 dark:bg-green-900/20'
                    : 'bg-red-50 dark:bg-red-900/20'">
                <ArrowDownTrayIcon v-if="lastRestore.success" class="w-5 h-5 text-green-500" />
                <XCircleIcon v-else class="w-5 h-5 text-red-500" />
            </div>
            <div class="flex-1 min-w-0 space-y-1">
                <div class="text-sm font-medium text-default truncate">
                    {{ lastRestore.source }}
                </div>
                <div class="text-xs text-gray-400 space-x-2">
                    <span>{{ lastRestore.sourceType }}</span>
                    <span>·</span>
                    <span>{{ lastRestore.fileCount === 'all' ? 'All files' : `${lastRestore.fileCount} file${lastRestore.fileCount === 1 ? '' : 's'}` }}</span>
                    <span>·</span>
                    <span>→ {{ lastRestore.target }}</span>
                </div>
                <div class="text-xs text-gray-400">{{ lastRestore.timeAgo }}</div>
                <div v-if="lastRestore.error" class="text-xs text-red-500 truncate" :title="lastRestore.error">
                    {{ lastRestore.error }}
                </div>
            </div>
            <span class="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
                :class="lastRestore.success
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'">
                {{ lastRestore.success ? 'Success' : 'Failed' }}
            </span>
        </div>
    </DashboardCard>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ArrowDownTrayIcon, XCircleIcon } from '@heroicons/vue/24/outline'
import { useSettings, type RestoreHistoryEntry } from '../../composables/useSettings'
import DashboardCard from './DashboardCard.vue'

interface DisplayRestore {
    source: string
    sourceType: string
    fileCount: number | string
    target: string
    success: boolean
    error?: string
    timeAgo: string
}

const lastRestore = ref<DisplayRestore | null>(null)
const { settings, load } = useSettings()

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
    await load()
    const history = settings.value?.restoreHistory
    if (history && history.length > 0) {
        const r = history[0]
        lastRestore.value = {
            source: r.source || r.sourcePath?.split('/').pop() || 'Unknown',
            sourceType: r.sourceType === 's2s' ? 'Server-to-Server' : r.sourceType === 'snapshot' ? 'Snapshot' : 'Cloud',
            fileCount: r.fileCount,
            target: r.target,
            success: r.success,
            error: r.error,
            timeAgo: formatTimeAgo(r.timestamp),
        }
    }
})
</script>
