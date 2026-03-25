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
                    :class="completedCount === totalSteps ? 'bg-green-500' : 'bg-blue-500'"
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
import { computed } from 'vue'
import { CheckCircleIcon } from '@heroicons/vue/24/solid'
import { useOnboarding } from '../../composables/useOnboarding'
import DashboardCard from './DashboardCard.vue'

const { onboarding } = useOnboarding()

const steps = computed(() => [
    { key: 'dashboardTourDone', label: 'Explore the dashboard', done: onboarding.value.dashboardTourDone },
    { key: 'backupManagerSeen', label: 'Visit Backup Manager', done: onboarding.value.backupManagerSeen },
    { key: 'createBackupTourDone', label: 'Create your first backup', done: onboarding.value.createBackupTourDone },
    { key: 'backupListTourDone', label: 'Run a backup', done: onboarding.value.backupListTourDone },
    { key: 'restoreBrowserTourDone', label: 'Restore files', done: onboarding.value.restoreBrowserTourDone },
])

const totalSteps = computed(() => steps.value.length)
const completedCount = computed(() => steps.value.filter(s => s.done).length)
</script>
