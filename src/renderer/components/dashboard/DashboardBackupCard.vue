<template>
    <DashboardCard title="Last Backup Run" noPad>
        <template #header-action>
            <button class="text-xs text-link transition-colors"
                @click="$emit('go-backup')">
                View All
            </button>
        </template>

        <div v-if="!lastBackup" class="px-4 py-8 text-center text-gray-400 text-sm">
            No backups run yet.
        </div>
        <div v-else class="px-4 py-3 space-y-3">
            <!-- Last backup info -->
            <div class="flex items-start gap-3">
                <div class="mt-0.5 p-1.5 rounded-lg"
                    :class="lastBackup.status === 'success'
                        ? 'bg-green-50 dark:bg-green-900/20'
                        : lastBackup.status === 'running'
                            ? 'bg-selected'
                            : 'bg-red-50 dark:bg-red-900/20'">
                    <CheckCircleIcon v-if="lastBackup.status === 'success'" class="w-5 h-5 text-green-500" />
                    <ArrowPathIcon v-else-if="lastBackup.status === 'running'" class="w-5 h-5 icon-primary animate-spin" />
                    <XCircleIcon v-else class="w-5 h-5 text-red-500" />
                </div>
                <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium text-default truncate">{{ lastBackup.name }}</div>
                    <div class="text-xs text-gray-400">
                        {{ lastBackup.status === 'running' ? 'Running now' : lastBackup.timeAgo }}
                    </div>
                </div>
                <span class="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
                    :class="lastBackup.status === 'success'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : lastBackup.status === 'running'
                            ? 'bg-selected text-primary'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'">
                    {{ lastBackup.status === 'success' ? 'Success' : lastBackup.status === 'running' ? 'Running' : 'Failed' }}
                </span>
            </div>

            <!-- Next scheduled -->
            <div v-if="nextScheduled" class="flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-50 dark:bg-neutral-700/30">
                <ClockIcon class="w-4 h-4 text-gray-400 shrink-0" />
                <div class="flex-1 min-w-0">
                    <div class="text-xs text-gray-500 dark:text-gray-400">Next Scheduled</div>
                    <div class="text-sm text-default font-medium truncate">{{ nextScheduled.name }}</div>
                </div>
                <span class="text-xs text-gray-400 shrink-0">{{ nextScheduled.when }}</span>
            </div>
        </div>
    </DashboardCard>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { CheckCircleIcon, XCircleIcon, ClockIcon } from '@heroicons/vue/24/outline'
import { ArrowPathIcon } from '@heroicons/vue/24/solid'
import { IPCRouter } from '@45drives/houston-common-lib'
import DashboardCard from './DashboardCard.vue'

defineEmits<{ 'go-backup': [] }>()

interface BackupInfo {
    name: string
    status: 'success' | 'failed' | 'running'
    timeAgo: string
    lastRunAt: number
}

interface ScheduleInfo {
    name: string
    when: string
}

const lastBackup = ref<BackupInfo | null>(null)
const nextScheduled = ref<ScheduleInfo | null>(null)

function formatTimeAgo(date: Date): string {
    const diff = Date.now() - date.getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d ago`
    return `${Math.floor(days / 30)}mo ago`
}

function computeNextRun(schedule: { repeatFrequency: string; startDate: string }): Date | null {
    const start = new Date(schedule.startDate)
    if (isNaN(start.getTime())) return null
    const now = new Date()

    const freq = schedule.repeatFrequency
    let next = new Date(start)

    // Advance next past now
    while (next <= now) {
        if (freq === 'hour') next.setHours(next.getHours() + 1)
        else if (freq === 'day') next.setDate(next.getDate() + 1)
        else if (freq === 'week') next.setDate(next.getDate() + 7)
        else if (freq === 'month') next.setMonth(next.getMonth() + 1)
        else return null
    }
    return next
}

function formatNextRun(date: Date): string {
    const diff = date.getTime() - Date.now()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'any moment'
    if (mins < 60) return `in ${mins}m`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `in ${hours}h`
    const days = Math.floor(hours / 24)
    return `in ${days}d`
}

onMounted(() => {
    const handler = (raw: string) => {
        try {
            const msg = JSON.parse(raw)
            if (msg.type === 'sendBackupTasks') {
                const tasks = msg.tasks || []

                // Find last run task
                let latest: any = null
                let latestTime = 0
                for (const t of tasks) {
                    const ts = t.lastRunAt ? new Date(t.lastRunAt).getTime() : 0
                    if (ts > latestTime) {
                        latestTime = ts
                        latest = t
                    }
                }

                if (latest && latestTime > 0) {
                    lastBackup.value = {
                        name: latest.name || latest.source?.split('/').pop() || latest.uuid?.slice(0, 8),
                        status: latest.status?.startsWith('offline') || latest.status === 'missing_folder'
                            ? 'failed'
                            : latest.status === 'running' ? 'running' : 'success',
                        timeAgo: formatTimeAgo(new Date(latestTime)),
                        lastRunAt: latestTime,
                    }
                }

                // Find next scheduled task
                let soonest: { name: string; next: Date } | null = null
                for (const t of tasks) {
                    if (!t.schedule) continue
                    const next = computeNextRun(t.schedule)
                    if (next && (!soonest || next < soonest.next)) {
                        soonest = {
                            name: t.name || t.source?.split('/').pop() || t.uuid?.slice(0, 8),
                            next,
                        }
                    }
                }

                if (soonest) {
                    nextScheduled.value = {
                        name: soonest.name,
                        when: formatNextRun(soonest.next),
                    }
                }

                IPCRouter.getInstance().removeEventListener('action', handler)
            }
        } catch { /* ignore */ }
    }
    IPCRouter.getInstance().addEventListener('action', handler)
    IPCRouter.getInstance().send('backend', 'action', 'requestBackUpTasks')
})
</script>
