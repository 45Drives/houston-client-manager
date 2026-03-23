<template>
    <div class="h-full flex flex-col items-center justify-center px-6 ui-texture-surface ui-texture-surface--soft">
        <p class="text-2xl text-default mb-8 max-w-2xl text-center -mt-20">
            Welcome to the 45Drives Storage Wizard<br/> <span class="text-lg">Choose an option below to get started.</span>
        </p>

        <div class="grid grid-cols-2 gap-6 w-full max-w-4xl">
            <!-- Setup a New Server -->
            <button @click="goSetup()"
                class="group flex flex-col items-center gap-4 p-8 rounded-xl border border-default bg-accent
                       hover:border-primary hover:shadow-lg transition-all text-left">
                <div class="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center
                            group-hover:bg-primary/20 transition-colors">
                    <ServerIcon class="w-7 h-7 text-primary" />
                </div>
                <div class="text-center">
                    <h3 class="text-xl font-semibold text-default mb-1">Setup a New Server</h3>
                    <p class="text-sm text-muted">
                        Configure ZFS pools, Samba shares, and get your 45Drives hardware up and running
                        with our best-practice storage architecture.
                    </p>
                </div>
            </button>

            <!-- Create / Manage Backups -->
            <button @click="goBackup()"
                class="group flex flex-col items-center gap-4 p-8 rounded-xl border border-default bg-accent
                       hover:border-primary hover:shadow-lg transition-all text-left">
                <div class="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center
                            group-hover:bg-primary/20 transition-colors">
                    <CircleStackIcon class="w-7 h-7 text-primary" />
                </div>
                <div class="text-center">
                    <h3 class="text-xl font-semibold text-default mb-1">Create / Manage Backups</h3>
                    <p class="text-sm text-muted">
                        Schedule automated backups, manage existing backup tasks, restore files, and view
                        backup logs — locally or on remote servers.
                    </p>
                </div>
            </button>

            <!-- View Logs -->
            <button @click="openLogModal()"
                class="group flex flex-col items-center gap-4 p-8 rounded-xl border border-default bg-accent
                       hover:border-primary hover:shadow-lg transition-all text-left">
                <div class="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center
                            group-hover:bg-primary/20 transition-colors">
                    <DocumentTextIcon class="w-7 h-7 text-primary" />
                </div>
                <div class="text-center">
                    <h3 class="text-xl font-semibold text-default mb-1">View Logs</h3>
                    <p class="text-sm text-muted">
                        Browse client and server logs, filter by level, search events,
                        and troubleshoot issues.
                    </p>
                </div>
            </button>

            <!-- Manage a Server (Coming Soon) -->
            <div class="relative flex flex-col items-center gap-4 p-8 rounded-xl border border-default bg-accent
                        opacity-50 cursor-not-allowed select-none">
                <span class="absolute top-3 right-3 text-xs font-semibold text-muted bg-well px-2 py-0.5 rounded-full">
                    Coming Soon
                </span>
                <div class="w-14 h-14 rounded-full bg-muted/10 flex items-center justify-center">
                    <WrenchScrewdriverIcon class="w-7 h-7 text-muted" />
                </div>
                <div class="text-center">
                    <h3 class="text-xl font-semibold text-default mb-1">Manage a Server</h3>
                    <p class="text-sm text-muted">
                        Modify storage configuration, update settings, and manage your
                        45Drives server after initial setup.
                    </p>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ServerIcon, CircleStackIcon, DocumentTextIcon, WrenchScrewdriverIcon } from '@heroicons/vue/24/outline'
import { useHeader } from '../composables/useHeader'
import { useLogModal } from '../composables/useLogModal'

useHeader('45Drives Storage Wizard')

const router = useRouter()
const { openLogModal } = useLogModal()
const goSetup = () => router.push({ name: 'setup' })
const goBackup = () => router.push({ name: 'backup-manage' })
</script>
