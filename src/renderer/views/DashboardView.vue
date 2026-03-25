<template>
    <div class="h-full overflow-y-auto ui-texture-surface ui-texture-surface--soft">
        <div class="max-w-5xl mx-auto px-6 py-6 space-y-5">
            <!-- Status strip -->
            <div class="flex flex-wrap items-center gap-3">
                <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-sm">
                    <span class="status-dot status-dot-ok"></span>
                    <span class="text-default font-medium">{{ stats.activeBackups }}</span>
                    <span class="text-gray-500">Active Backups</span>
                </div>
                <div v-if="stats.failedBackups > 0"
                    class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-sm">
                    <span class="status-dot status-dot-error"></span>
                    <span class="text-red-700 dark:text-red-400 font-medium">{{ stats.failedBackups }}</span>
                    <span class="text-red-600 dark:text-red-400">Failed</span>
                </div>
                <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-sm">
                    <CameraIcon class="w-4 h-4 text-gray-400" />
                    <span class="text-default font-medium">{{ stats.snapshots }}</span>
                    <span class="text-gray-500">Snapshots</span>
                </div>
            </div>

            <!-- Alert banner (only when failures exist) -->
            <div v-if="stats.failedBackups > 0"
                class="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-900/15 border-l-4 border-amber-500 text-sm">
                <ExclamationTriangleIcon class="w-5 h-5 text-amber-500 shrink-0" />
                <span class="text-amber-800 dark:text-amber-300 flex-1">
                    {{ stats.failedBackups }} backup task{{ stats.failedBackups > 1 ? 's' : '' }} failed recently.
                </span>
                <button class="btn btn-sm btn-ghost text-amber-700 dark:text-amber-300 h-fit"
                    @click="goBackup()">View Backups</button>
            </div>

            <!-- Main content: Recent Activity + Quick Actions -->
            <div class="flex gap-5 items-start">
                <!-- Recent Activity -->
                <div class="flex-1 min-w-0 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
                    <div class="px-4 py-3 border-b border-neutral-200 dark:border-neutral-700">
                        <h2 class="text-sm font-semibold text-default">Recent Activity</h2>
                    </div>
                    <div v-if="recentActivity.length === 0"
                        class="px-4 py-10 text-center text-gray-400 text-sm">
                        No recent activity. Create a backup to get started.
                    </div>
                    <div v-else class="divide-y divide-neutral-100 dark:divide-neutral-700/50">
                        <div v-for="(item, i) in recentActivity" :key="i"
                            class="px-4 py-2.5 flex items-center gap-3 hover:bg-neutral-50 dark:hover:bg-neutral-700/30 transition-colors">
                            <span class="status-dot shrink-0"
                                :class="item.status === 'success' ? 'status-dot-ok' : item.status === 'failed' ? 'status-dot-error' : 'status-dot-active'"></span>
                            <span class="text-sm text-default truncate flex-1">{{ item.label }}</span>
                            <span class="text-xs text-gray-400 shrink-0">{{ item.timeAgo }}</span>
                        </div>
                    </div>
                </div>

                <!-- Quick Actions -->
                <div class="w-64 shrink-0 space-y-2">
                    <h2 class="text-sm font-semibold text-default mb-1 px-1 -mt-7">Quick Actions</h2>
                    <button @click="goSetup()"
                        class="quick-action-card group">
                        <ServerIcon class="w-5 h-5 text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300" />
                        <div>
                            <div class="text-sm font-medium text-default">Setup a Server</div>
                            <div class="text-xs text-gray-400">Configure ZFS, Samba & more</div>
                        </div>
                    </button>
                    <button @click="goBackup()"
                        class="quick-action-card group">
                        <CircleStackIcon class="w-5 h-5 text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300" />
                        <div>
                            <div class="text-sm font-medium text-default">Manage Backups</div>
                            <div class="text-xs text-gray-400">Create, schedule & restore</div>
                        </div>
                    </button>
                    <button @click="openLogModal()"
                        class="quick-action-card group">
                        <DocumentTextIcon class="w-5 h-5 text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300" />
                        <div>
                            <div class="text-sm font-medium text-default">View Logs</div>
                            <div class="text-xs text-gray-400">Browse & troubleshoot</div>
                        </div>
                    </button>
                    <!-- Coming Soon: Manage Server -->
                    <div class="quick-action-card card-disabled">
                        <WrenchScrewdriverIcon class="w-5 h-5 text-gray-400" />
                        <div>
                            <div class="text-sm font-medium text-default">Manage Server</div>
                            <div class="text-xs text-gray-400">Coming soon</div>
                        </div>
                        <span class="badge-coming-soon">Soon</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
    ServerIcon, CircleStackIcon, DocumentTextIcon,
    WrenchScrewdriverIcon, CameraIcon, ExclamationTriangleIcon
} from '@heroicons/vue/24/outline'
import { useHeader } from '../composables/useHeader'
import { useLogModal } from '../composables/useLogModal'
import { IPCRouter } from '@45drives/houston-common-lib'

useHeader('45Drives Storage Wizard')

const router = useRouter()
const { openLogModal } = useLogModal()
const goSetup = () => router.push({ name: 'setup' })
const goBackup = () => router.push({ name: 'backup-manage' })

// Dashboard stats — populated from backend data when available
const stats = ref({ activeBackups: 0, failedBackups: 0, snapshots: 0 })

interface ActivityItem {
    label: string
    status: 'success' | 'failed' | 'running'
    timeAgo: string
}
const recentActivity = ref<ActivityItem[]>([])

function formatTimeAgo(date: Date): string {
    const now = Date.now()
    const diff = now - date.getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
}

onMounted(() => {
    // Request backup tasks to populate stats
    const handler = (raw: string) => {
        try {
            const msg = JSON.parse(raw)
            if (msg.type === 'sendBackupTasks') {
                const tasks = msg.tasks || []
                let active = 0, failed = 0
                const activity: ActivityItem[] = []

                for (const t of tasks) {
                    if (t.status === 'online') active++
                    else if (t.status?.startsWith('offline') || t.status === 'missing_folder') failed++
                    else active++ // idle counts as active

                    const lastRun = t.lastRunAt ? new Date(t.lastRunAt) : null
                    if (lastRun && !isNaN(lastRun.getTime())) {
                        activity.push({
                            label: t.name || t.source?.split('/').pop() || t.uuid?.slice(0, 8),
                            status: t.status?.startsWith('offline') ? 'failed' : 'success',
                            timeAgo: formatTimeAgo(lastRun),
                        })
                    }
                }

                stats.value.activeBackups = active
                stats.value.failedBackups = failed

                // Sort by recency and take top 6
                activity.sort((a, b) => {
                    const parseAgo = (s: string) => {
                        if (s === 'just now') return 0
                        const match = s.match(/(\d+)([mhd])/)
                        if (!match) return Infinity
                        const n = parseInt(match[1])
                        return match[2] === 'm' ? n : match[2] === 'h' ? n * 60 : n * 1440
                    }
                    return parseAgo(a.timeAgo) - parseAgo(b.timeAgo)
                })
                recentActivity.value = activity.slice(0, 6)

                IPCRouter.getInstance().removeEventListener('action', handler)
            }
        } catch { /* ignore */ }
    }
    IPCRouter.getInstance().addEventListener('action', handler)
    IPCRouter.getInstance().send('backend', 'action', 'requestBackUpTasks')
})
</script>

<style scoped>
.quick-action-card {
    @apply w-full flex items-center gap-3 px-4 py-3 rounded-lg
           bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700
           hover:border-slate-400 dark:hover:border-slate-600 hover:shadow-sm
           transition-all text-left relative;
}
</style>
