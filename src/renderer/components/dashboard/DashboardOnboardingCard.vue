<template>
    <DashboardCard title="Getting Started">
        <div class="space-y-2">
            <div class="flex items-center justify-between text-sm">
                <span class="text-gray-500 dark:text-gray-400">Setup progress</span>
                <span class="text-default font-medium">{{ completedCount }}/{{ totalSteps }}</span>
            </div>
            <!-- Progress bar -->
            <div class="w-full h-2 rounded-full bg-neutral-100 dark:bg-neutral-700 overflow-hidden">
                <div class="h-full rounded-full transition-all duration-500 ease-out"
                    :class="completedCount === totalSteps ? 'bg-green-500' : 'bg-primary'"
                    :style="{ width: `${(completedCount / totalSteps) * 100}%` }" />
            </div>
            <!-- Checklist -->
            <div class="space-y-1.5 pt-1">
                <div v-for="step in steps" :key="step.key"
                    class="flex items-center gap-2 text-sm">
                    <CheckCircleIcon v-if="step.done" class="w-4 h-4 text-green-500 shrink-0" />
                    <div v-else
                        class="w-4 h-4 rounded-full border-2 border-neutral-300 dark:border-neutral-600 shrink-0" />
                    <span :class="step.done ? 'text-gray-400 line-through' : 'text-default'">
                        {{ step.label }}
                    </span>
                </div>
            </div>
        </div>
    </DashboardCard>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { CheckCircleIcon } from '@heroicons/vue/24/solid'
import { useOnboarding } from '../../composables/useOnboarding'
import { useSettings } from '../../composables/useSettings'
import { useBackupTasksFeed } from '../../composables/useBackupTasksFeed'
import DashboardCard from './DashboardCard.vue'

const { onboarding } = useOnboarding()
const { settings, reload } = useSettings()
const { tasks } = useBackupTasksFeed()

onMounted(() => { reload() })

// These three steps describe actions, so they track real state rather than
// whether the matching guided tour happened to be dismissed.
const hasBackupTask = computed(() => tasks.value.length > 0)
const hasRunBackup = computed(() => tasks.value.some(t => !!t.lastRunAt))
const hasRestored = computed(() => (settings.value?.restoreHistory?.length ?? 0) > 0)

const steps = computed(() => [
    { key: 'dashboardTourDone', label: 'Explore the dashboard', done: onboarding.value.dashboardTourDone },
    { key: 'backupManagerSeen', label: 'Visit Backup Manager', done: onboarding.value.backupManagerSeen },
    { key: 'createBackup', label: 'Create your first backup', done: hasBackupTask.value },
    { key: 'runBackup', label: 'Run a backup', done: hasRunBackup.value },
    { key: 'restoreFiles', label: 'Restore files', done: hasRestored.value },
])

const totalSteps = computed(() => steps.value.length)
const completedCount = computed(() => steps.value.filter(s => s.done).length)
</script>
