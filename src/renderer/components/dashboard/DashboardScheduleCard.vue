<template>
    <DashboardCard title="Upcoming Backups">
        <div v-if="!loaded" class="py-4 text-center text-gray-400 text-sm">Loading…</div>
        <div v-else-if="scheduledTasks.length === 0" class="py-4 text-center text-gray-400 text-sm">
            No scheduled backups.
        </div>
        <div v-else class="space-y-2">
            <!-- Mini week view -->
            <div class="grid grid-cols-7 gap-1 text-center">
                <div v-for="day in weekDays" :key="day.label" class="flex flex-col items-center gap-1">
                    <span class="text-[10px] uppercase text-gray-400 font-medium">{{ day.label }}</span>
                    <div class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors"
                        :class="day.isToday
                            ? 'bg-primary text-white'
                            : day.hasBackup
                                ? 'bg-selected text-primary'
                                : 'text-gray-400'">
                        {{ day.date }}
                    </div>
                    <div v-if="day.hasBackup" class="w-1 h-1 rounded-full bg-primary" />
                    <div v-else class="w-1 h-1" />
                </div>
            </div>

            <!-- Upcoming list -->
            <div class="border-t border-neutral-100 dark:border-neutral-700/50 pt-2 space-y-1.5">
                <div class="text-xs text-gray-400 font-medium">Upcoming</div>
                <div v-for="task in upcomingTasks" :key="task.name"
                    class="flex items-center gap-2 text-sm">
                    <ClockIcon class="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    <span class="text-default truncate flex-1">{{ task.name }}</span>
                    <span class="text-xs text-gray-400 shrink-0">{{ task.when }}</span>
                </div>
            </div>
        </div>
    </DashboardCard>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ClockIcon } from '@heroicons/vue/24/outline'
import DashboardCard from './DashboardCard.vue'
import { useBackupTasksFeed } from '../../composables/useBackupTasksFeed'

interface ScheduledTask {
    name: string
    schedule: { repeatFrequency: string; startDate: string }
}

const { tasks, loaded } = useBackupTasksFeed()

const scheduledTasks = computed<ScheduledTask[]>(() =>
    tasks.value
        .filter((t: any) => t.schedule)
        .map((t: any) => ({
            name: t.name || t.source?.split('/').pop() || t.uuid?.slice(0, 8),
            schedule: t.schedule,
        }))
)

function computeNextRun(schedule: { repeatFrequency: string; startDate: string }): Date | null {
    const start = new Date(schedule.startDate)
    if (isNaN(start.getTime())) return null
    const now = new Date()
    let next = new Date(start)

    while (next <= now) {
        if (schedule.repeatFrequency === 'hour') next.setHours(next.getHours() + 1)
        else if (schedule.repeatFrequency === 'day') next.setDate(next.getDate() + 1)
        else if (schedule.repeatFrequency === 'week') next.setDate(next.getDate() + 7)
        else if (schedule.repeatFrequency === 'month') next.setMonth(next.getMonth() + 1)
        else return null
    }
    return next
}

const weekDays = computed(() => {
    const today = new Date()
    const startOfWeek = new Date(today)
    startOfWeek.setDate(today.getDate() - today.getDay()) // Sunday start

    const days = []
    const labels = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

    for (let i = 0; i < 7; i++) {
        const d = new Date(startOfWeek)
        d.setDate(startOfWeek.getDate() + i)
        const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0)
        const dayEnd = new Date(d); dayEnd.setHours(23, 59, 59, 999)

        const hasBackup = scheduledTasks.value.some(t => {
            const next = computeNextRun(t.schedule)
            return next && next >= dayStart && next <= dayEnd
        })

        days.push({
            label: labels[i],
            date: d.getDate(),
            isToday: d.toDateString() === today.toDateString(),
            hasBackup,
        })
    }
    return days
})

const upcomingTasks = computed(() => {
    const now = Date.now()
    const weekFromNow = now + 7 * 24 * 60 * 60 * 1000

    return scheduledTasks.value
        .map(t => {
            const next = computeNextRun(t.schedule)
            if (!next || next.getTime() > weekFromNow) return null
            const diff = next.getTime() - now
            const mins = Math.floor(diff / 60000)
            const hours = Math.floor(mins / 60)
            const when = mins < 1 ? 'any moment' : mins < 60 ? `in ${mins}m` : hours < 24 ? `in ${hours}h` : `in ${Math.floor(hours / 24)}d`
            return { name: t.name, when, nextTime: next.getTime() }
        })
        .filter((t): t is NonNullable<typeof t> => t !== null)
        .sort((a, b) => a.nextTime - b.nextTime)
        .slice(0, 4)
})
</script>
