<template>
    <div class="h-full overflow-y-auto ui-texture-surface ui-texture-surface--soft">
        <div class="max-w-7xl mx-auto px-6 py-6 space-y-5">
            <!-- Status strip + connection status -->
            <div class="flex flex-wrap items-center gap-3" data-tour="status-strip">
                <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-sm">
                    <span class="status-dot status-dot-ok"></span>
                    <span class="text-default font-medium">{{ stats.activeBackups }}</span>
                    <span class="text-gray-500">Scheduled Tasks</span>
                </div>
                <div v-if="stats.failedBackups > 0"
                    class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-sm">
                    <span class="status-dot status-dot-error"></span>
                    <span class="text-red-700 dark:text-red-400 font-medium">{{ stats.failedBackups }}</span>
                    <span class="text-red-600 dark:text-red-400">Failed</span>
                </div>
                <!-- Selected server status -->
                <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ml-auto"
                    :class="selectedServer
                        ? 'bg-selected border border-selected'
                        : 'bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700'">
                    <span class="status-dot" :class="selectedServer ? 'status-dot-ok' : 'status-dot-idle'" />
                    <span :class="selectedServer ? 'text-primary font-medium' : 'text-gray-500'">
                        {{ selectedServer ? `Viewing: ${selectedServer.name || selectedServer.host}` : 'Select a server to view details' }}
                    </span>
                </div>
                <button class="btn btn-sm btn-secondary h-fit" @click="showTopology = !showTopology">
                    {{ showTopology ? 'Hide Topology' : 'Show Topology' }}
                </button>
            </div>

            <!-- Alert banner (only when failures exist) -->
            <div v-if="stats.failedBackups > 0"
                class="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-900/15 border-l-4 border-amber-500 text-sm">
                <ExclamationTriangleIcon class="w-5 h-5 text-amber-500 shrink-0" />
                <span class="text-amber-800 dark:text-amber-300 flex-1">
                    {{ stats.failedBackups }} backup task{{ stats.failedBackups > 1 ? 's' : '' }} failed recently.
                </span>
                <button class="btn btn-sm btn-secondary text-amber-700 dark:text-amber-300 h-fit"
                    @click="goBackup()">View Backups</button>
            </div>

            <!-- Two-column layout: Main + Sidebar (each column flows independently) -->
            <div class="grid grid-cols-3 gap-5 items-start">

                <!-- ═══ Main content (left 2/3) ═══ -->
                <div class="col-span-2 space-y-5">
                    <!-- Saved Servers -->
                    <div data-tour="servers-card">
                        <DashboardServerCard
                            ref="serverCard"
                            :selectedHost="selectedServer?.host ?? ''"
                            @go-setup="goSetup()"
                            @connect="onConnectServer"
                            @manage="goVault()"
                            @open-manage="goManageServer" />
                    </div>
                    <!-- Storage + System Health -->
                    <div class="grid grid-cols-2 gap-5" data-tour="storage-health">
                        <DashboardStorageCard ref="storageCard" :serverIp="selectedServer?.host ?? ''" />
                        <DashboardHealthCard :storagePercent="maxStoragePercent"
                            :savedHosts="serverCard?.savedHosts ?? []"
                            @add-server="onAddDiscoveredServer" />
                    </div>

                    <BackupTopologyMap v-if="showTopology" />
                 

                    <!-- Recent Activity -->
                    <div class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden"
                        data-tour="recent-activity">
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

                </div>

                <!-- ═══ Sidebar (right 1/3) ═══ -->
                <div class="col-span-1 space-y-5">
                    <!-- Quick Actions -->
                    <div data-tour="quick-actions">
                        <h2 class="text-sm font-semibold text-default mb-2 px-1 bg-primary rounded-md">Quick Actions</h2>
                        <div class="grid grid-cols-2 gap-1.5">
                            <button @click="goSetup()" class="quick-action-card group">
                                <ServerIcon class="w-4 h-4 icon-secondary group-hover:icon-primary shrink-0" />
                                <span class="text-xs font-medium text-default truncate">Setup Single Server</span>
                            </button>
                            <button @click="goBulkSetup()" class="quick-action-card group">
                                <ServerIcon class="w-4 h-4 icon-secondary group-hover:icon-primary shrink-0" />
                                <span class="text-xs font-medium text-default truncate">Setup Multiple Servers</span>
                            </button>
                            <button @click="goBackup()" class="quick-action-card group">
                                <CircleStackIcon class="w-4 h-4 icon-secondary group-hover:icon-primary shrink-0" />
                                <span class="text-xs font-medium text-default truncate">Manage Backups</span>
                            </button>
                            <div class="flex gap-1.5">
                                <button @click="openLogModal()" class="quick-action-card group flex-1">
                                    <DocumentTextIcon
                                        class="w-4 h-4 icon-secondary group-hover:icon-primary shrink-0" />
                                    <span class="text-xs font-medium text-default truncate">Logs</span>
                                </button>
                                <button @click="openSettingsModal()" class="quick-action-card group flex-1">
                                    <Cog6ToothIcon class="w-4 h-4 icon-secondary group-hover:icon-primary shrink-0" />
                                    <span class="text-xs font-medium text-default truncate">Settings</span>
                                </button>
                            </div>
                      
                        
                            <!-- <button @click="goBackup()" class="quick-action-card group">
                                <ArrowDownTrayIcon class="w-4 h-4 icon-secondary group-hover:icon-primary shrink-0" />
                                <span class="text-xs font-medium text-default truncate">Restore Files</span>
                            </button> -->
                      
<!-- 
                            <div class="quick-action-card card-disabled">
                                <WrenchScrewdriverIcon class="w-4 h-4 text-gray-400 shrink-0" />
                                <span class="text-xs font-medium text-default truncate">Manage Server</span>
                                <span class="badge-coming-soon">Soon</span>
                            </div>                             -->
                      
                        </div>
                    </div>

                    <!-- Upcoming Backups -->
                    <div data-tour="schedule">
                        <DashboardScheduleCard />
                    </div>

                    <!-- Last Backup + Last Restore -->
                    <div class="space-y-3" data-tour="backup-restore">
                        <DashboardBackupCard @go-backup="goBackup()" />
                        <DashboardRestoreCard />
                    </div>

                    <!-- Getting Started (only if not all done) -->
                    <DashboardOnboardingCard v-if="!allOnboardingDone" />



                    <!-- System Health (duplicate removed from main, lives here as overview) -->
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import {
    ServerIcon, CircleStackIcon, DocumentTextIcon,
    WrenchScrewdriverIcon, ExclamationTriangleIcon,
    ArrowDownTrayIcon, Cog6ToothIcon,
} from '@heroicons/vue/24/outline'
import { useHeader } from '../composables/useHeader'
import { useLogModal } from '../composables/useLogModal'
import { useSettingsModal } from '../composables/useSettingsModal'
import { useOnboarding } from '../composables/useOnboarding'
import { useTourManager, type TourStep } from '../composables/useTourManager'
import { IPCRouter } from '@45drives/houston-common-lib'
import { useServers, type StoredServer } from '../composables/useServers'

import DashboardServerCard from '../components/dashboard/DashboardServerCard.vue'
import DashboardBackupCard from '../components/dashboard/DashboardBackupCard.vue'
import DashboardRestoreCard from '../components/dashboard/DashboardRestoreCard.vue'
import DashboardOnboardingCard from '../components/dashboard/DashboardOnboardingCard.vue'
import DashboardScheduleCard from '../components/dashboard/DashboardScheduleCard.vue'
import DashboardStorageCard from '../components/dashboard/DashboardStorageCard.vue'
import DashboardHealthCard from '../components/dashboard/DashboardHealthCard.vue'
import BackupTopologyMap from '../components/topology/BackupTopologyMap.vue'

useHeader('45Drives Storage Wizard')

const router = useRouter()
const { openLogModal } = useLogModal()
const { openSettingsModal } = useSettingsModal()
const { onboarding, markDone } = useOnboarding()
const { requestTour } = useTourManager()

const goSetup = () => router.push({ name: 'setup' })
const goBulkSetup = () => router.push({ name: 'bulk-setup' })
const goBackup = () => router.push({ name: 'backup-manage' })
const goVault = () => {
    if (selectedServer.value && !selectedServer.value.discovered) {
        router.push({ name: 'server-manage', params: { id: selectedServer.value.id } })
    } else {
        router.push({ name: 'vault' })
    }
}

const goManageServer = (server: { id: string }) => {
    router.push({ name: 'server-manage', params: { id: server.id } })
}

const { displayServers } = useServers()

// ── Selected server for dashboard data ────────────────────────────────
const selectedServer = ref<StoredServer | null>(null)
const serverCard = ref<InstanceType<typeof DashboardServerCard> | null>(null)
const showTopology = ref(false)

// Select a server from the server card (shows its data on dashboard)
function onConnectServer(server: StoredServer) {
    selectedServer.value = server
}

function onAddDiscoveredServer(srv: { ip: string; name?: string }) {
    serverCard.value?.addExistingServer(srv)
}

// Onboarding visibility
const allOnboardingDone = computed(() => {
    const o = onboarding.value
    return o.dashboardTourDone && o.backupManagerSeen && o.createBackupTourDone
        && o.backupListTourDone && o.restoreBrowserTourDone
})

// Storage health pass-through for system health widget
const maxStoragePercent = ref(0)
const storageCard = ref<InstanceType<typeof DashboardStorageCard> | null>(null)

// ── Guided tour ──────────────────────────────────────────────────────────
const dashboardTourSteps: TourStep[] = [
    {
        target: '[data-tour="status-strip"]',
        message: 'Welcome to the Dashboard!\n\nThis status bar shows your scheduled backup task count, any failures, and which server you\'re currently viewing.',
    },
    {
        target: '[data-tour="servers-card"]',
        message: 'Your saved servers appear here.\n\nClick any server to select it — the dashboard will load its storage data and highlight it as the active server. Favorites are pinned at the top.',
    },
    {
        target: '[data-tour="storage-health"]',
        message: 'Server Storage shows ZFS dataset usage for the selected server — ZFS is the file system that manages your storage. System Health gives you a quick network and storage health overview.\n\nSelect a different server above to switch.',
    },
    {
        target: '[data-tour="recent-activity"]',
        message: 'Recent Activity shows your latest backup runs.\n\nGreen dots mean success, red dots indicate failures. Click "View Backups" in the alert banner to investigate issues.',
    },
    {
        target: '[data-tour="backup-restore"]',
        message: 'These cards show your most recent backup run and restore operation at a glance, including status, timing, and the next scheduled backup.',
    },
    {
        target: '[data-tour="quick-actions"]',
        message: 'Quick Actions let you jump straight to common tasks — set up a server, manage backups, manage a server, or view logs.',
    },
    {
        target: '[data-tour="schedule"]',
        message: 'Upcoming Backups shows a mini week calendar with your next scheduled backup tasks, so you can see what\'s coming at a glance.',
    },
]

// Dashboard stats
const stats = ref({ activeBackups: 0, failedBackups: 0 })

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
    // Auto-select last-used server from the unified list
    if (displayServers.value.length > 0) {
        selectedServer.value = displayServers.value[0] ?? null
    }

    // Guided tour
    if (!onboarding.value.dashboardTourDone) {
        setTimeout(() => {
            requestTour('dashboard', dashboardTourSteps, () => markDone('dashboardTourDone'))
        }, 500)
    }

    // Request backup tasks to populate stats + recent activity
    let cachedTasks: any[] = []

    function computeStatsAndActivity(tasks: any[]) {
        let active = 0, failed = 0
        const activity: ActivityItem[] = []

        for (const t of tasks) {
            if (t.status?.startsWith('offline') || t.status === 'missing_folder') failed++
            else active++

            const lastRun = t.lastRunAt ? new Date(t.lastRunAt) : null
            if (lastRun && !isNaN(lastRun.getTime())) {
                const eventStatus = t.lastEventStatus
                activity.push({
                    label: t.name || t.source?.split('/').pop() || t.uuid?.slice(0, 8),
                    status: eventStatus === 'failure' || t.status?.startsWith('offline') ? 'failed' : 'success',
                    timeAgo: formatTimeAgo(lastRun),
                })
            }
        }

        stats.value.activeBackups = active
        stats.value.failedBackups = failed

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
        recentActivity.value = activity.slice(0, 8)
    }

    const handler = (raw: string) => {
        try {
            const msg = JSON.parse(raw)
            if (msg.type === 'sendBackupTasks') {
                cachedTasks = msg.tasks || []
                computeStatsAndActivity(cachedTasks)
                // Fetch events to get lastRunAt timestamps
                IPCRouter.getInstance().send('backend', 'action', JSON.stringify({ type: 'fetchBackupEvents' }))
            } else if (msg.type === 'sendBackupEvents') {
                // Merge event timestamps into cached tasks
                const latest: Record<string, { date: Date; status: string }> = {}
                for (const ev of (msg.events ?? [])) {
                    if (ev?.uuid && ev?.timestamp) {
                        const ts = new Date(ev.timestamp)
                        if (!Number.isNaN(ts.getTime())) {
                            const prev = latest[ev.uuid]
                            if (!prev || ts > prev.date) {
                                latest[ev.uuid] = { date: ts, status: ev.status ?? '' }
                            }
                        }
                    }
                }
                cachedTasks = cachedTasks.map(t =>
                    latest[t.uuid] ? { ...t, lastRunAt: latest[t.uuid].date, lastEventStatus: latest[t.uuid].status } : t
                )
                computeStatsAndActivity(cachedTasks)
            }
        } catch { /* ignore */ }
    }
    IPCRouter.getInstance().addEventListener('action', handler)
    IPCRouter.getInstance().send('backend', 'action', 'requestBackUpTasks')

    const pollInterval = setInterval(() => {
        IPCRouter.getInstance().send('backend', 'action', 'requestBackUpTasks')
    }, 60_000)

    onBeforeUnmount(() => {
        IPCRouter.getInstance().removeEventListener('action', handler)
        clearInterval(pollInterval)
    })
})
</script>

<style scoped>
.quick-action-card {
    @apply flex items-center gap-2 px-2.5 py-2 rounded-lg
           bg-accent border border-default
           hover:bg-neutral-200 dark:hover:bg-neutral-700/50 hover:shadow-sm
           transition-all text-left relative;
}
</style>
