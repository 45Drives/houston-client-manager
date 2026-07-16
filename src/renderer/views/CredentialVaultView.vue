<template>
    <div class="h-full overflow-y-auto ui-texture-surface ui-texture-surface--soft">
        <div class="max-w-5xl mx-auto px-6 py-6 space-y-5">
            <!-- Header -->
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <button class="btn btn-sm btn-ghost h-fit text-gray-500 hover:text-default"
                        @click="router.push({ name: 'dashboard' })">
                        <ArrowLeftIcon class="w-4 h-4" />
                    </button>
                    <div>
                        <h1 class="text-lg font-semibold text-default">Manage Connections</h1>
                        <p class="text-xs text-gray-400">
                            Manage saved server logins. Stored securely on this device.
                        </p>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <button v-if="staleCreds.length > 0"
                        class="btn btn-sm h-fit text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                        @click="confirmBulkDeleteStale">
                        <TrashIcon class="w-4 h-4 mr-1" />
                        Clean {{ staleCreds.length }} Stale
                    </button>
                </div>
            </div>

            <!-- Summary stats -->
            <div class="grid grid-cols-4 gap-4">
                <div class="vault-stat-card">
                    <div class="text-2xl font-bold text-default">{{ allCreds.length }}</div>
                    <div class="text-xs text-gray-400">Total Saved Logins</div>
                </div>
                <div class="vault-stat-card">
                    <div class="text-2xl font-bold text-default">{{ hostCount }}</div>
                    <div class="text-xs text-gray-400">Unique Hosts</div>
                </div>
                <div class="vault-stat-card">
                    <div class="text-2xl font-bold text-green-500">{{ activeCreds.length }}</div>
                    <div class="text-xs text-gray-400">Active (used &lt;30d)</div>
                </div>
                <div class="vault-stat-card">
                    <div class="text-2xl font-bold" :class="staleCreds.length > 0 ? 'text-amber-500' : 'text-gray-300'">{{ staleCreds.length }}</div>
                    <div class="text-xs text-gray-400">Stale (unused 30+d)</div>
                </div>
            </div>

            <!-- Filters -->
            <div class="flex items-center gap-3 flex-wrap">
                <div class="relative flex-1 max-w-xs">
                    <MagnifyingGlassIcon class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input v-model="searchQuery" type="text" placeholder="Search by host, username, or label…"
                        class="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-default placeholder:text-gray-400 outline-none focus:border-blue-400" />
                </div>
                <div class="flex items-center gap-1">
                    <button v-for="f in statusFilters" :key="f.value"
                        class="px-3 py-1 text-xs rounded-full border transition-colors"
                        :class="statusFilter === f.value
                            ? 'bg-blue-500 text-white border-blue-500'
                            : 'bg-white dark:bg-neutral-800 text-gray-500 border-neutral-200 dark:border-neutral-700 hover:border-blue-400'"
                        @click="statusFilter = f.value">
                        {{ f.label }}
                    </button>
                </div>
            </div>

            <!-- Credential list grouped by host -->
            <div v-if="loading" class="py-12 text-center text-gray-400 text-sm">Loading credentials…</div>
            <div v-else-if="filteredGroups.length === 0" class="py-12 text-center text-gray-400 text-sm">
                {{ allCreds.length === 0 ? 'No credentials stored.' : 'No credentials match your filters.' }}
            </div>
            <div v-else class="space-y-4">
                <div v-for="group in filteredGroups" :key="group.host"
                    class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
                    <!-- Group header -->
                    <div class="px-4 py-2.5 border-b border-neutral-100 dark:border-neutral-700/50 flex items-center gap-2">
                        <ServerIcon class="w-4 h-4 text-gray-400" />
                        <span class="text-sm font-semibold text-default">{{ group.host }}</span>
                        <span class="text-xs text-gray-400">({{ group.credentials.length }} credential{{ group.credentials.length > 1 ? 's' : '' }})</span>
                        <div class="ml-auto flex items-center gap-1.5">
                            <span class="status-dot shrink-0"
                                :class="group.reachable === true ? 'status-dot-ok' : group.reachable === false ? 'status-dot-error' : 'status-dot-idle'" />
                            <span class="text-xs text-gray-400">
                                {{ group.reachable === true ? 'Reachable' : group.reachable === false ? 'Unreachable' : 'Not tested' }}
                            </span>
                        </div>
                    </div>
                    <!-- Credential rows -->
                    <div class="divide-y divide-neutral-100 dark:divide-neutral-700/50">
                        <div v-for="cred in group.credentials" :key="credKey(cred)"
                            class="px-4 py-3 flex items-center gap-3 hover:bg-neutral-50 dark:hover:bg-neutral-700/30 transition-colors">
                            <!-- Status badge -->
                            <span class="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
                                :class="credStatus(cred) === 'active'
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                    : credStatus(cred) === 'orphaned'
                                        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                        : credStatus(cred) === 'hostname-changed'
                                            ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'">
                                {{ credStatus(cred) === 'active' ? 'Active'
                                    : credStatus(cred) === 'orphaned' ? 'Orphaned'
                                    : credStatus(cred) === 'hostname-changed' ? 'Hostname Changed'
                                    : 'Stale' }}
                            </span>

                            <!-- Info -->
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-1.5">
                                    <span class="text-sm font-medium text-default truncate">
                                        {{ cred.name || `${cred.username}@${cred.host}` }}
                                    </span>
                                    <span v-if="cred.shareName" class="text-xs text-gray-400">/{{ cred.shareName }}</span>
                                </div>
                                <div class="text-xs text-gray-400 flex items-center gap-2 flex-wrap">
                                    <span>{{ cred.username }}</span>
                                    <span v-if="cred.lastUsedAt">· Last used {{ formatTimeAgo(cred.lastUsedAt) }}</span>
                                    <span v-else>· Never used</span>
                                    <span v-if="cred.createdAt">· Created {{ formatDate(cred.createdAt) }}</span>
                                </div>
                            </div>

                            <!-- Actions -->
                            <div class="flex items-center gap-1 shrink-0">
                                <button class="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                                    title="Edit"
                                    @click="editCredential(cred)">
                                    <PencilIcon class="w-3.5 h-3.5 text-gray-400" />
                                </button>
                                <button class="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                                    title="Test connection"
                                    @click="testHost(group)">
                                    <SignalIcon class="w-3.5 h-3.5 text-gray-400" />
                                </button>
                                <button class="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                    title="Delete"
                                    @click="confirmDelete(cred)">
                                    <TrashIcon class="w-3.5 h-3.5 text-red-400" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Info box: what "unused for 30+ days" means -->
            <div class="flex items-start gap-2 px-4 py-3 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/30 text-xs">
                <InformationCircleIcon class="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                <div class="text-blue-700 dark:text-blue-300 space-y-1">
                    <p><strong>"Stale"</strong> means the saved login hasn't been used in over 30 days.
                        It gets updated whenever a backup runs or you connect to that server.</p>
                    <p><strong>"Orphaned"</strong> means we couldn't find this server on your network.
                        It may be turned off, renamed, or no longer connected.</p>
                </div>
            </div>
        </div>

        <!-- Delete confirmation modal -->
        <Teleport to="body">
            <div v-if="deleteTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @click.self="deleteTarget = null">
                <div class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-xl max-w-sm w-full mx-4 p-5 space-y-4">
                    <h3 class="text-sm font-semibold text-default">Delete Saved Login?</h3>
                    <p class="text-sm text-gray-500">
                        This will permanently remove the saved login for
                        <strong>{{ deleteTarget.username }}@{{ deleteTarget.host }}</strong>{{ deleteTarget.shareName ? ` (share: ${deleteTarget.shareName})` : '' }}.
                        Backup tasks using this login may stop working.
                    </p>
                    <div class="flex justify-end gap-2">
                        <button class="btn btn-sm btn-ghost h-fit" @click="deleteTarget = null">Cancel</button>
                        <button class="btn btn-sm h-fit bg-red-500 hover:bg-red-600 text-white border-red-500"
                            @click="executeDelete">Delete</button>
                    </div>
                </div>
            </div>
        </Teleport>

        <!-- Bulk delete confirmation modal -->
        <Teleport to="body">
            <div v-if="showBulkDelete" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @click.self="showBulkDelete = false">
                <div class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-xl max-w-sm w-full mx-4 p-5 space-y-4">
                    <h3 class="text-sm font-semibold text-default">Clean Stale Credentials?</h3>
                    <p class="text-sm text-gray-500">
                        This will remove <strong>{{ staleCreds.length }}</strong> credential{{ staleCreds.length > 1 ? 's' : '' }}
                        that haven't been used in over 30 days:
                    </p>
                    <ul class="text-xs text-gray-400 space-y-0.5 max-h-32 overflow-y-auto">
                        <li v-for="c in staleCreds" :key="credKey(c)">
                            {{ c.username }}@{{ c.host }}{{ c.shareName ? `/${c.shareName}` : '' }}
                        </li>
                    </ul>
                    <div class="flex justify-end gap-2">
                        <button class="btn btn-sm btn-ghost h-fit" @click="showBulkDelete = false">Cancel</button>
                        <button class="btn btn-sm h-fit bg-red-500 hover:bg-red-600 text-white border-red-500"
                            @click="executeBulkDelete">Delete All Stale</button>
                    </div>
                </div>
            </div>
        </Teleport>

        <!-- Edit credential modal -->
        <Teleport to="body">
            <div v-if="editTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @mousedown.self="editTarget = null">
                <div class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-xl max-w-md w-full mx-4 p-5 space-y-4">
                    <h3 class="text-sm font-semibold text-default">Edit Server</h3>
                    <p class="text-xs text-gray-400">
                        Update server details for <strong>{{ editTarget.name || editTarget.host }}</strong>
                    </p>
                    <div class="space-y-3">
                        <div>
                            <label class="text-xs font-medium text-gray-500 mb-1 block">Nickname</label>
                            <input v-model="editForm.name" type="text" placeholder="e.g. NAS Backups"
                                class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default placeholder:text-gray-400 outline-none focus:border-blue-400" />
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                            <div>
                                <label class="text-xs font-medium text-gray-500 mb-1 block">Hostname</label>
                                <input v-model="editForm.hostname" type="text" placeholder="server.local"
                                    class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default placeholder:text-gray-400 outline-none focus:border-blue-400" />
                            </div>
                            <div>
                                <label class="text-xs font-medium text-gray-500 mb-1 block">IP Address</label>
                                <input v-model="editForm.ip" type="text" placeholder="192.168.2.100"
                                    class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default placeholder:text-gray-400 outline-none focus:border-blue-400" />
                            </div>
                        </div>

                        <!-- Admin Login -->
                        <div class="pt-2 border-t border-neutral-100 dark:border-neutral-700/50">
                            <span class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Admin Login</span>
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                            <div>
                                <label class="text-xs font-medium text-gray-500 mb-1 block">Username</label>
                                <input v-model="editForm.username" type="text" placeholder="root"
                                    class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default placeholder:text-gray-400 outline-none focus:border-blue-400" />
                            </div>
                            <div class="relative">
                                <label class="text-xs font-medium text-gray-500 mb-1 block">Password</label>
                                <input v-model="editForm.password" :type="editShowPassword ? 'text' : 'password'" placeholder="••••••••"
                                    class="w-full px-3 py-1.5 pr-9 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default placeholder:text-gray-400 outline-none focus:border-blue-400" />
                                <button type="button" @click="editShowPassword = !editShowPassword"
                                    class="absolute right-2.5 bottom-1.5 text-gray-400 hover:text-default">
                                    <EyeIcon v-if="!editShowPassword" class="w-4 h-4" />
                                    <EyeSlashIcon v-if="editShowPassword" class="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        <!-- SMB / Samba -->
                        <div class="pt-2 border-t border-neutral-100 dark:border-neutral-700/50">
                            <span class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Samba Share</span>
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                            <div>
                                <label class="text-xs font-medium text-gray-500 mb-1 block">Share Name</label>
                                <input v-model="editForm.share" type="text" placeholder="storage"
                                    class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default placeholder:text-gray-400 outline-none focus:border-blue-400" />
                            </div>
                            <div>
                                <label class="text-xs font-medium text-gray-500 mb-1 block">SMB Username</label>
                                <input v-model="editForm.smbUser" type="text" placeholder="backupuser"
                                    class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default placeholder:text-gray-400 outline-none focus:border-blue-400" />
                            </div>
                        </div>
                        <div class="relative">
                            <label class="text-xs font-medium text-gray-500 mb-1 block">SMB Password</label>
                            <input v-model="editForm.smbPass" :type="editShowSmbPassword ? 'text' : 'password'" placeholder="••••••••"
                                class="w-full px-3 py-1.5 pr-9 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default placeholder:text-gray-400 outline-none focus:border-blue-400"
                                @keyup.enter="executeEdit" />
                            <button type="button" @click="editShowSmbPassword = !editShowSmbPassword"
                                class="absolute right-2.5 bottom-1.5 text-gray-400 hover:text-default">
                                <EyeIcon v-if="!editShowSmbPassword" class="w-4 h-4" />
                                <EyeSlashIcon v-if="editShowSmbPassword" class="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                    <div v-if="editError" class="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded-md">
                        {{ editError }}
                    </div>
                    <div class="flex justify-end gap-2">
                        <button class="btn btn-sm btn-ghost h-fit" @click="editTarget = null">Cancel</button>
                        <button class="btn btn-sm btn-primary h-fit" :disabled="!editCanSave" @click="executeEdit">Save</button>
                    </div>
                </div>
            </div>
        </Teleport>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
    ArrowLeftIcon, TrashIcon, PencilIcon, SignalIcon,
    MagnifyingGlassIcon, ServerIcon, InformationCircleIcon,
} from '@heroicons/vue/24/outline'
import { EyeIcon, EyeSlashIcon } from '@heroicons/vue/20/solid'
import { useHeader } from '../composables/useHeader'
import { useServers, type StoredServer } from '../composables/useServers'
import { discoveryStateInjectionKey } from '../keys/injection-keys'
import type { DiscoveryState } from '../types'

useHeader('Manage Connections')

const router = useRouter()
const discoveryState = inject<DiscoveryState>(discoveryStateInjectionKey)!
const { savedServers: allServersList, refresh: refreshServers, updateServer, removeServer: removeServerById } = useServers()

// ── Types ────────────────────────────────────────────────────────────────

type CredEntry = StoredServer

interface HostGroup {
    host: string
    credentials: CredEntry[]
    reachable: boolean | null // null = not tested
}

// ── State ────────────────────────────────────────────────────────────────

const loading = ref(true)
const searchQuery = ref('')
const statusFilter = ref<'all' | 'active' | 'stale' | 'orphaned'>('all')
const deleteTarget = ref<CredEntry | null>(null)
const showBulkDelete = ref(false)
const editTarget = ref<CredEntry | null>(null)
const editForm = ref({ name: '', hostname: '', ip: '', share: '', username: '', password: '', smbUser: '', smbPass: '' })
const editShowPassword = ref(false)
const editShowSmbPassword = ref(false)
const editError = ref('')
const hostReachability = ref<Record<string, boolean | null>>({})

const statusFilters = [
    { value: 'all' as const, label: 'All' },
    { value: 'active' as const, label: 'Active' },
    { value: 'stale' as const, label: 'Stale' },
    { value: 'orphaned' as const, label: 'Orphaned' },
]

// ── Computed ─────────────────────────────────────────────────────────────

const allCreds = computed(() => allServersList.value)

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000

const hostCount = computed(() => new Set(allCreds.value.map(c => c.host)).size)

function credStatus(cred: CredEntry): 'active' | 'stale' | 'orphaned' | 'hostname-changed' {
    const isDiscovered = discoveryState.servers.some(s => s.ip === cred.host || s.name === cred.host)
    if (!isDiscovered && discoveryState.servers.length > 0) return 'orphaned'

    // Check if stored hostname no longer matches the discovered server's current name
    const storedHostname = (cred as any).hostname as string | undefined
    if (storedHostname && isDiscovered) {
        const disc = discoveryState.servers.find(s => s.ip === cred.host || s.name === cred.host)
        if (disc && disc.name && disc.name !== disc.ip) {
            // Compare stored hostname (strip .local suffix) with discovered name
            const storedBase = storedHostname.replace(/\.local$/i, '').toLowerCase()
            const discBase = disc.name.replace(/\.local$/i, '').toLowerCase()
            if (storedBase !== discBase) return 'hostname-changed'
        }
    }

    if (!cred.lastUsedAt) return 'stale'
    if (Date.now() - cred.lastUsedAt > THIRTY_DAYS) return 'stale'
    return 'active'
}

const activeCreds = computed(() => allCreds.value.filter(c => credStatus(c) === 'active'))
const staleCreds = computed(() => allCreds.value.filter(c => credStatus(c) === 'stale'))

const filteredGroups = computed(() => {
    let creds = allCreds.value

    // Text search
    if (searchQuery.value.trim()) {
        const q = searchQuery.value.toLowerCase()
        creds = creds.filter(c =>
            c.host.toLowerCase().includes(q) ||
            c.username.toLowerCase().includes(q) ||
            (c.name || '').toLowerCase().includes(q) ||
            c.shareName.toLowerCase().includes(q)
        )
    }

    // Status filter
    if (statusFilter.value !== 'all') {
        creds = creds.filter(c => credStatus(c) === statusFilter.value)
    }

    // Group by host
    const groups: Record<string, CredEntry[]> = {}
    for (const c of creds) {
        ;(groups[c.host] ??= []).push(c)
    }

    return Object.entries(groups)
        .map(([host, credentials]) => ({
            host,
            credentials: credentials.sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)),
            reachable: hostReachability.value[host] ?? null,
        }))
        .sort((a, b) => a.host.localeCompare(b.host))
})

// ── Helpers ──────────────────────────────────────────────────────────────

function credKey(c: CredEntry): string {
    return c.id
}

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

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    } catch { return iso }
}

// ── Actions ──────────────────────────────────────────────────────────────

async function loadCredentials() {
    loading.value = true
    try {
        await refreshServers()
    } catch (e) {
        console.error('Failed to load credentials:', e)
    } finally {
        loading.value = false
    }
}

async function testHost(group: HostGroup) {
    hostReachability.value[group.host] = null // reset
    try {
        const result = await window.electron.ipcRenderer.invoke('credentials:test-connection', { host: group.host })
        hostReachability.value[group.host] = result.reachable
    } catch {
        hostReachability.value[group.host] = false
    }
}

function confirmDelete(cred: CredEntry) {
    deleteTarget.value = cred
}

async function executeDelete() {
    if (!deleteTarget.value) return
    const c = deleteTarget.value
    try {
        await removeServerById(c.id)
    } catch (e) {
        console.error('Failed to delete credential:', e)
    }
    deleteTarget.value = null
}

function confirmBulkDeleteStale() {
    showBulkDelete.value = true
}

async function executeBulkDelete() {
    for (const c of staleCreds.value) {
        try {
            await removeServerById(c.id)
        } catch { /* continue */ }
    }
    await loadCredentials()
    showBulkDelete.value = false
}

function editCredential(cred: CredEntry) {
    editTarget.value = cred
    editForm.value = {
        name: cred.name || '',
        hostname: (cred as any).hostname || '',
        ip: (cred as any).ip || '',
        share: cred.shareName || '',
        username: cred.username,
        password: '',
        smbUser: (cred as any).smbUser || '',
        smbPass: '',
    }
    editShowPassword.value = false
    editShowSmbPassword.value = false
    editError.value = ''
}

const editCanSave = computed(() =>
    (editForm.value.hostname.trim() || editForm.value.ip.trim()) && editForm.value.username.trim()
)

async function executeEdit() {
    if (!editTarget.value || !editCanSave.value) return
    const old = editTarget.value
    const form = editForm.value
    editError.value = ''

    try {
        await updateServer(old.id, {
            hostname: form.hostname.trim(),
            ip: form.ip.trim(),
            shareName: form.share.trim(),
            username: form.username.trim(),
            password: form.password || undefined,
            smbUser: form.smbUser.trim(),
            smbPass: form.smbPass || undefined,
            name: form.name.trim() || undefined,
        })
        editTarget.value = null
    } catch (e: any) {
        editError.value = e?.message || 'Failed to update credential.'
    }
}

// ── Lifecycle ────────────────────────────────────────────────────────────

onMounted(loadCredentials)
</script>

<style scoped>
.vault-stat-card {
    @apply text-center p-3 rounded-lg bg-white dark:bg-neutral-800
           border border-neutral-200 dark:border-neutral-700;
}
</style>
