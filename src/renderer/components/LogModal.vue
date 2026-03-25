<template>
  <teleport to="body">
    <transition name="log-modal-fade">
      <div v-if="logModalOpen" class="fixed inset-0 z-[100] flex items-center justify-center text-default">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/50" @click="closeLogModal" />
        <!-- Modal panel -->
        <div class="relative z-10 w-[90vw] h-[85vh] bg-default rounded-xl shadow-2xl border border-default
                    flex flex-col overflow-hidden">
          <!-- Header -->
          <div class="flex items-center justify-between px-6 py-4 border-b border-default shrink-0">
            <div>
              <h2 class="text-xl font-semibold text-default">Log Viewer</h2>
              <p class="text-xs text-muted mt-0.5">View logs from the local client app and connected servers.</p>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="w-8 h-8 p-0 rounded-md bg-transparent inline-flex items-center justify-center text-gray-500 hover:text-default hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                :title="(loading || taskLoading || serverLoading) ? 'Refreshing…' : 'Refresh'" @click="refresh" :disabled="loading || taskLoading || serverLoading">
                <ArrowPathIcon class="w-4 h-4" />
              </button>
              <button class="btn bg-well hover:bg-accent text-default p-2 rounded-full" @click="closeLogModal" title="Close">
                <XMarkIcon class="w-5 h-5" />
              </button>
            </div>
          </div>

          <!-- Body -->
          <div class="flex-1 min-h-0 overflow-y-auto p-6">
            <!-- Tab bar -->
            <div class="flex border-b border-default mb-4">
              <button
                v-if="logTaskContexts.length > 0"
                class="px-4 py-2 text-sm font-medium border-b-2 transition-colors"
                :class="activeTab === 'task' ? 'border-blue-500 text-blue-400' : 'border-transparent text-muted hover:text-default'"
                @click="switchTab('task')"
              >
                Task Log{{ logTaskContexts.length > 1 ? 's' : '' }}
              </button>
              <button
                class="px-4 py-2 text-sm font-medium border-b-2 transition-colors"
                :class="activeTab === 'client' ? 'border-blue-500 text-blue-400' : 'border-transparent text-muted hover:text-default'"
                @click="switchTab('client')"
              >
                Client Logs
              </button>
              <button
                class="px-4 py-2 text-sm font-medium border-b-2 transition-colors"
                :class="activeTab === 'server' ? 'border-blue-500 text-blue-400' : 'border-transparent text-muted hover:text-default'"
                @click="switchTab('server')"
              >
                Server Logs
              </button>
            </div>

            <!-- Task info banner -->
            <div v-if="activeTab === 'task' && logTaskContext" class="mb-4 p-3 rounded-lg border border-default bg-accent">
              <div class="flex items-center gap-3">
                <span class="text-xs text-muted">Backup Task:</span>
                <select v-if="logTaskContexts.length > 1" v-model.number="selectedTaskIndex"
                        class="px-3 py-1.5 border border-default rounded-lg bg-default text-default text-sm min-w-[280px]"
                        @change="fetchTaskLog">
                  <option v-for="(ctx, idx) in logTaskContexts" :key="ctx.uuid" :value="idx">
                    {{ ctx.description || ctx.uuid }}
                  </option>
                </select>
                <span v-else class="text-sm font-medium">{{ logTaskContext.description || logTaskContext.uuid }}</span>
              </div>
            </div>

            <!-- Client date selector -->
            <div v-if="activeTab === 'client'" class="mb-4 flex flex-wrap items-end gap-3">
              <div>
                <label class="block text-xs text-muted mb-1">Log Date</label>
                <select v-model="selectedDate" class="px-3 py-2 border border-default rounded-lg bg-default text-default w-64"
                        @change="fetchClientLogs">
                  <option v-if="availableDates.length === 0" value="" disabled>No log files found</option>
                  <option v-for="d in availableDates" :key="d.date" :value="d.date">
                    {{ d.date }}{{ d.date === todayDate ? ' (today)' : '' }}
                  </option>
                </select>
              </div>
            </div>

            <!-- Server connection bar -->
            <div v-if="activeTab === 'server'" class="mb-4 flex flex-wrap items-end gap-3">
              <div>
                <label class="block text-xs text-muted mb-1">Server</label>
                <select v-model="serverIp" class="px-3 py-2 border border-default rounded-lg bg-default text-default w-64">
                  <option value="" disabled>Select a server…</option>
                  <option v-for="srv in serverOptions" :key="srv.ip" :value="srv.ip">{{ srv.label }}</option>
                </select>
              </div>
              <div>
                <label class="block text-xs text-muted mb-1">Source</label>
                <select v-model="serverSource" class="px-3 py-2 border border-default rounded-lg bg-default text-default">
                  <option value="all">All server logs</option>
                  <option value="setup-module">setup-module.log</option>
                  <option value="easysetup">easysetup-*.log</option>
                </select>
              </div>
              <button class="btn btn-primary" @click="fetchServerLogs" :disabled="!serverIp || serverLoading">
                {{ serverLoading ? 'Fetching…' : 'Fetch Server Logs' }}
              </button>
            </div>

            <!-- Meta cards -->
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
              <div class="rounded-md border border-default p-3 bg-accent">
                <div class="text-xs text-muted">{{ activeTab === 'client' ? 'Log file' : activeTab === 'server' ? 'Server' : 'Task' }}</div>
                <div class="text-sm font-mono break-all">{{ activeMeta.file || 'n/a' }}</div>
              </div>
              <div class="rounded-md border border-default p-3 bg-accent">
                <div class="text-xs text-muted">{{ activeTab === 'client' ? 'Directory' : activeTab === 'server' ? 'Files read' : 'Directory' }}</div>
                <div v-if="activeTab === 'server' && serverFiles.length" class="mt-1 grid grid-cols-1 gap-0.5">
                  <div v-for="f in serverFiles" :key="f" class="text-xs font-mono truncate" :title="f">{{ f }}</div>
                </div>
                <div v-else class="text-sm font-mono break-all">{{ activeMeta.logDir || 'n/a' }}</div>
              </div>
              <div class="rounded-md border border-default p-3 bg-accent">
                <div class="text-xs text-muted">Entries loaded</div>
                <div class="text-sm font-semibold">{{ activeEntries.length }}</div>
              </div>
            </div>

            <!-- Level summary -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div class="rounded-md border border-default p-3 bg-accent">
                <div class="text-xs text-muted">Errors</div>
                <div class="text-lg font-semibold text-red-400">{{ activeCounts.error }}</div>
              </div>
              <div class="rounded-md border border-default p-3 bg-accent">
                <div class="text-xs text-muted">Warnings</div>
                <div class="text-lg font-semibold text-amber-400">{{ activeCounts.warn }}</div>
              </div>
              <div class="rounded-md border border-default p-3 bg-accent">
                <div class="text-xs text-muted">Info</div>
                <div class="text-lg font-semibold">{{ activeCounts.info }}</div>
              </div>
              <div class="rounded-md border border-default p-3 bg-accent">
                <div class="text-xs text-muted">Debug</div>
                <div class="text-lg font-semibold">{{ activeCounts.debug }}</div>
              </div>
            </div>

            <!-- Filters -->
            <div class="flex flex-wrap items-center gap-2 mb-4 text-left">
              <input v-model.trim="search" type="search" placeholder="Search event, summary, details..."
                class="input-textlike px-3 py-2 border border-default rounded-lg bg-default text-default min-w-[280px]" />
              <select v-model="levelFilter" class="px-3 py-2 border border-default rounded-lg bg-default text-default min-w-[120px]">
                <option value="">All levels</option>
                <option value="error">Error</option>
                <option value="warn">Warn</option>
                <option value="info">Info</option>
                <option value="debug">Debug</option>
              </select>
              <label class="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" v-model="errorsOnly" /><span>Errors/warnings only</span>
              </label>
              <label class="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" v-model="groupRelated" /><span>Group related events</span>
              </label>
            </div>

            <!-- Error banner -->
            <div v-if="activeError" class="p-3 rounded bg-red-900/20 border border-red-800 text-sm mb-3">
              {{ activeError }}
            </div>

            <!-- Log table -->
            <div class="overflow-x-auto border border-default rounded-md text-left">
              <table class="min-w-full text-sm border-collapse">
                <thead class="bg-accent border-b border-default">
                  <tr>
                    <th class="p-2 text-left border-r border-default">Time</th>
                    <th class="p-2 text-left border-r border-default">Level</th>
                    <th class="p-2 text-left border-r border-default">Event</th>
                    <th v-if="activeTab === 'server'" class="p-2 text-left border-r border-default">Source</th>
                    <th class="p-2 text-left">Summary</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="loading || serverLoading || taskLoading">
                    <td :colspan="activeTab === 'server' ? 5 : 4" class="p-4 text-center">Loading logs…</td>
                  </tr>
                  <tr v-else-if="displayRows.length === 0">
                    <td :colspan="activeTab === 'server' ? 5 : 4" class="p-4 text-center">No matching log entries.</td>
                  </tr>
                  <tr v-else v-for="row in displayRows" :key="row.id"
                    class="border-b border-default align-top"
                    :class="{ 'bg-red-900/10': row.level === 'error', 'bg-amber-900/10': row.level === 'warn' }">
                    <td class="p-2 border-r border-default whitespace-nowrap">{{ formatTs(row.timestamp) }}</td>
                    <td class="p-2 border-r border-default whitespace-nowrap uppercase">{{ row.level }}</td>
                    <td class="p-2 border-r border-default font-mono">{{ row.event }}</td>
                    <td v-if="activeTab === 'server'" class="p-2 border-r border-default font-mono text-xs">{{ row.source || '' }}</td>
                    <td class="p-2">
                      <div>{{ row.summary }}</div>
                      <details v-if="row.details || (row.children && row.children.length)" class="mt-1">
                        <summary class="cursor-pointer text-xs text-muted">Details</summary>
                        <div v-if="row.children && row.children.length" class="mt-1 space-y-1">
                          <div v-for="child in row.children" :key="child.id" class="text-xs">
                            <span class="text-muted">{{ formatTs(child.timestamp) }}</span>
                            <span class="font-mono ml-2">{{ child.event }}</span>
                            <span class="ml-2">{{ child.summary }}</span>
                          </div>
                        </div>
                        <pre v-if="row.details" class="mt-1 text-xs whitespace-pre-wrap break-words">{{ row.details }}</pre>
                      </details>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { XMarkIcon, ArrowPathIcon } from '@heroicons/vue/24/outline'
import { useLogModal } from '../composables/useLogModal'
import { discoveryStateInjectionKey } from '../keys/injection-keys'
import type { DiscoveryState } from '../types'

const { logModalOpen, logTaskContext, logTaskContexts, selectedTaskIndex, closeLogModal } = useLogModal()
const discoveryState = inject<DiscoveryState>(discoveryStateInjectionKey) ?? { servers: [], fallbackTriggered: false, loading: false } as DiscoveryState

// ─── Types ───────────────────────────────────────────────────────────────

type ParsedLogEntry = {
  id: string; timestamp: string; level: string; event: string;
  summary: string; message?: string; details?: string; source?: string;
  data?: Record<string, any>;
}

type DisplayRow = {
  id: string; timestamp: string; level: string; event: string;
  summary: string; details?: string; source?: string; children?: ParsedLogEntry[];
}

// ─── State ───────────────────────────────────────────────────────────────

const activeTab = ref<'client' | 'server' | 'task'>('client')
const search = ref('')
const levelFilter = ref('')
const errorsOnly = ref(false)
const groupRelated = ref(true)

// Client log state
const loading = ref(false)
const clientError = ref<string | null>(null)
const clientEntries = ref<ParsedLogEntry[]>([])
const clientMeta = ref<{ file: string; logDir: string }>({ file: '', logDir: '' })
const availableDates = ref<{ date: string; file: string }[]>([])
const selectedDate = ref('')
const todayDate = new Date().toISOString().slice(0, 10)

// Server log state
const serverIp = ref('')
const serverSource = ref('all')
const serverLoading = ref(false)
const serverError = ref<string | null>(null)
const serverEntries = ref<ParsedLogEntry[]>([])
const serverMeta = ref<{ file: string; logDir: string }>({ file: '', logDir: '' })

// Task log state
const taskLoading = ref(false)
const taskError = ref<string | null>(null)
const taskEntries = ref<ParsedLogEntry[]>([])
const taskMeta = ref<{ file: string; logDir: string }>({ file: '', logDir: '' })

const setupServers = computed(() =>
  discoveryState.servers.filter(s => s.setupComplete === true)
)

const serverOptions = computed(() =>
  setupServers.value.map(s => ({ ip: s.ip, label: s.name && s.name !== s.ip ? `${s.name} (${s.ip})` : s.ip }))
)

watch(() => setupServers.value.length, (len) => {
  if (len > 0 && !serverIp.value) serverIp.value = setupServers.value[0].ip
}, { immediate: true })

// Auto-fetch when the user picks a different server
watch(serverIp, (ip) => {
  if (ip && activeTab.value === 'server') {
    serverEntries.value = []
    serverMeta.value = { file: '', logDir: '' }
    fetchServerLogs()
  }
})

// Explicit tab switch (fixes the bug where tabs were unclickable)
function switchTab(tab: 'client' | 'server' | 'task') {
  activeTab.value = tab
}

// Auto-fetch on open
watch(logModalOpen, async (open) => {
  if (!open) return

  // Load available dates for the dropdown
  await loadAvailableDates()

  if (logTaskContext.value) {
    activeTab.value = 'task'
    fetchTaskLog()
    // Also preload client logs
    fetchClientLogs()
  } else {
    activeTab.value = 'client'
    fetchClientLogs()
  }
})

// Auto-fetch when switching tabs (if data hasn't been fetched yet)
watch(activeTab, (tab) => {
  if (tab === 'server' && serverIp.value && serverEntries.value.length === 0) fetchServerLogs()
  if (tab === 'client' && clientEntries.value.length === 0) fetchClientLogs()
  if (tab === 'task' && logTaskContext.value && taskEntries.value.length === 0) fetchTaskLog()
})

const activeEntries = computed(() => {
  if (activeTab.value === 'task') return taskEntries.value
  return activeTab.value === 'client' ? clientEntries.value : serverEntries.value
})
const activeError = computed(() => {
  if (activeTab.value === 'task') return taskError.value
  return activeTab.value === 'client' ? clientError.value : serverError.value
})
const activeMeta = computed(() => {
  if (activeTab.value === 'task') return taskMeta.value
  return activeTab.value === 'client' ? clientMeta.value : serverMeta.value
})

const activeCounts = computed(() => {
  const out = { error: 0, warn: 0, info: 0, debug: 0 }
  for (const e of activeEntries.value) {
    const lvl = String(e.level || '').toLowerCase()
    if (lvl === 'error') out.error++; else if (lvl === 'warn') out.warn++; else if (lvl === 'debug') out.debug++; else out.info++
  }
  return out
})

const filteredEntries = computed(() => {
  const q = search.value.toLowerCase()
  return activeEntries.value.filter(entry => {
    if (levelFilter.value && entry.level !== levelFilter.value) return false
    if (errorsOnly.value && !['error', 'warn'].includes(entry.level)) return false
    if (!q) return true
    return String(entry.event ?? '').toLowerCase().includes(q) || String(entry.summary ?? '').toLowerCase().includes(q) || String(entry.details || '').toLowerCase().includes(q)
  })
})

function eventRoot(event: string) {
  const e = String(event ?? '')
  for (const s of ['requested', 'succeeded', 'failed', 'start', 'done', 'completed']) {
    const tail = `.${s}`
    if (e.endsWith(tail)) return e.slice(0, -tail.length)
  }
  return e
}

function severityRank(level: string) { return level === 'error' ? 3 : level === 'warn' ? 2 : level === 'info' ? 1 : 0 }

function groupedRows(items: ParsedLogEntry[]): DisplayRow[] {
  const out: DisplayRow[] = []
  const maxGapMs = 30_000
  for (const entry of items) {
    const root = eventRoot(entry.event)
    // For server logs the event is always the source file — use summary to distinguish entries.
    // For client/backup logs, use the structured data fields as before.
    const entity = entry.data?.id ?? entry.data?.jobId ?? entry.data?.taskUuid ?? entry.data?.name ?? null
    const groupKey = entity
      ? `${root}::${entity}`
      : `${root}::${(entry.summary || '').replace(/\s*\(.*/, '').trim()}`
    const prev = out[out.length - 1]
    const prevTs = prev ? new Date(prev.timestamp).getTime() : 0
    const curTs = new Date(entry.timestamp).getTime()
    const near = Number.isFinite(prevTs) && Number.isFinite(curTs) ? Math.abs(curTs - prevTs) <= maxGapMs : false
    if (prev && prev.id.startsWith(`group:${groupKey}:`) && near) {
      const allChildren = [...(prev.children || []), entry]
      prev.children = allChildren
      prev.level = allChildren.reduce((acc, c) => severityRank(c.level) > severityRank(acc) ? c.level : acc, prev.level)
      prev.timestamp = allChildren[0].timestamp
      prev.summary = `${prev.children[0]?.summary ?? root} (${allChildren.length}x)`
      continue
    }
    out.push({ id: `group:${groupKey}:${entry.id}`, timestamp: entry.timestamp, level: entry.level, event: root, summary: entry.summary, details: entry.details, source: entry.source, children: [entry] })
  }
  return out.map(r => {
    if (!r.children || r.children.length <= 1) {
      const s = r.children?.[0]
      return { id: s?.id || r.id, timestamp: s?.timestamp || r.timestamp, level: s?.level || r.level, event: s?.event || r.event, summary: s?.summary || r.summary, details: s?.details || r.details, source: s?.source || r.source }
    }
    return r
  })
}

const displayRows = computed<DisplayRow[]>(() => {
  const rows = filteredEntries.value
  if (!groupRelated.value) return rows.map(r => ({ ...r }))
  return groupedRows(rows)
})

function formatTs(ts: string) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts || '—'
  return d.toLocaleString()
}

function refresh() {
  if (activeTab.value === 'task') fetchTaskLog()
  else if (activeTab.value === 'client') fetchClientLogs()
  else fetchServerLogs()
}

async function loadAvailableDates() {
  try {
    const res = await window.electron?.ipcRenderer.invoke('logs:list-client-files')
    if (res?.ok && Array.isArray(res.dates)) {
      availableDates.value = res.dates
      // Default to today if available, otherwise most recent
      if (!selectedDate.value) {
        const todayEntry = res.dates.find((d: any) => d.date === todayDate)
        selectedDate.value = todayEntry ? todayDate : (res.dates[0]?.date || '')
      }
    }
  } catch {
    // non-fatal
  }
}

async function fetchTaskLog() {
  const uuid = logTaskContext.value?.uuid
  if (!uuid) return
  taskLoading.value = true; taskError.value = null
  try {
    const res = await window.electron?.ipcRenderer.invoke('logs:read-backup-task', { uuid, limit: 2000 })
    if (!res?.ok) throw new Error(res?.error || 'Unable to read task log')
    taskEntries.value = Array.isArray(res.entries) ? res.entries : []
    taskMeta.value = { file: String(res.file || ''), logDir: String(res.logDir || '') }
    if (taskEntries.value.length === 0 && res.message) {
      taskError.value = res.message
    }
  } catch (e: any) { taskError.value = e?.message || String(e); taskEntries.value = [] }
  finally { taskLoading.value = false }
}

async function fetchClientLogs() {
  loading.value = true; clientError.value = null
  try {
    const res = await window.electron?.ipcRenderer.invoke('logs:read-client', {
      date: selectedDate.value || undefined,
      limit: 2000,
    })
    if (!res?.ok) throw new Error(res?.error || 'Unable to read client logs')
    clientEntries.value = Array.isArray(res.entries) ? res.entries : []
    clientMeta.value = { file: String(res.file || ''), logDir: String(res.logDir || '') }
    if (res.date && !selectedDate.value) selectedDate.value = res.date
    if (clientEntries.value.length === 0 && res.message) {
      clientError.value = res.message
    }
  } catch (e: any) { clientError.value = e?.message || String(e); clientEntries.value = [] }
  finally { loading.value = false }
}

async function fetchServerLogs() {
  if (!serverIp.value) return
  serverLoading.value = true; serverError.value = null
  try {
    const res = await window.electron?.ipcRenderer.invoke('logs:read-server', { ip: serverIp.value, source: serverSource.value, limit: 2000 })
    if (!res?.ok) throw new Error(res?.error || 'Unable to read server logs')
    serverEntries.value = Array.isArray(res.entries) ? res.entries : []
    serverMeta.value = { file: serverIp.value, logDir: Array.isArray(res.files) ? res.files.join(', ') : '' }
  } catch (e: any) { serverError.value = e?.message || String(e); serverEntries.value = [] }
  finally { serverLoading.value = false }
}

const serverFiles = computed(() => {
  const raw = serverMeta.value.logDir
  if (!raw) return []
  return raw.split(',').map(s => s.trim()).filter(Boolean)
})
</script>

<style scoped>
.log-modal-fade-enter-active,
.log-modal-fade-leave-active { transition: opacity 0.2s ease; }
.log-modal-fade-enter-from,
.log-modal-fade-leave-to { opacity: 0; }
</style>
