<template>
  <div class="h-full flex flex-col min-h-0 overflow-hidden">
    <div class="flex-1 min-h-0 overflow-y-auto p-4">
      <CardContainer class="w-full bg-accent rounded-md shadow-xl min-w-0">
        <template #header>
          <div class="flex items-center justify-between px-6 py-4 shrink-0">
            <div>
              <div class="text-xl font-semibold text-default text-left">Log Viewer</div>
              <div class="text-xs text-muted mt-1">View logs from the local client app and connected servers.</div>
            </div>
            <div class="flex items-center gap-2">
              <button
                class="w-8 h-8 p-0 rounded-md bg-transparent inline-flex items-center justify-center text-gray-500 hover:text-default hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                :title="loading ? 'Refreshing…' : 'Refresh'" @click="refresh" :disabled="loading">
                <ArrowPathIcon class="w-4 h-4" />
              </button>
              <button class="btn btn-sm btn-secondary h-fit" type="button" @click="goHome">
                Back
              </button>
            </div>
          </div>
        </template>

        <!-- Tab bar -->
        <div class="px-6">
          <div class="flex border-b border-default mb-4">
            <button
              class="px-4 py-2 text-sm font-medium border-b-2 transition-colors"
              :class="activeTab === 'client' ? 'border-blue-500 text-blue-400' : 'border-transparent text-muted hover:text-default'"
              @click="activeTab = 'client'"
            >
              Client Logs
            </button>
            <button
              class="px-4 py-2 text-sm font-medium border-b-2 transition-colors"
              :class="activeTab === 'server' ? 'border-blue-500 text-blue-400' : 'border-transparent text-muted hover:text-default'"
              @click="activeTab = 'server'"
            >
              Server Logs
            </button>
          </div>
        </div>

        <div class="px-6 pb-4 text-left min-h-0">
          <!-- Server connection bar (visible on server tab) -->
          <div v-if="activeTab === 'server'" class="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <label class="block text-xs text-muted mb-1">Server</label>
              <select
                v-model="serverIp"
                class="px-3 py-2 border border-default rounded-lg bg-default text-default w-64"
              >
                <option value="" disabled>Select a server…</option>
                <option
                  v-for="srv in serverOptions"
                  :key="srv.ip"
                  :value="srv.ip"
                >
                  {{ srv.label }}
                </option>
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
            <button class="btn btn-sm btn-primary h-fit" @click="fetchServerLogs" :disabled="!serverIp || serverLoading">
              {{ serverLoading ? 'Fetching…' : 'Fetch Server Logs' }}
            </button>
          </div>

          <!-- Meta cards -->
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
            <div class="rounded-md border border-default p-3 bg-default">
              <div class="text-xs text-muted">{{ activeTab === 'client' ? 'Log file' : 'Server' }}</div>
              <div class="text-sm font-mono break-all">{{ activeMeta.file || 'n/a' }}</div>
            </div>
            <div class="rounded-md border border-default p-3 bg-default">
              <div class="text-xs text-muted">{{ activeTab === 'client' ? 'Directory' : 'Files read' }}</div>
              <div class="text-sm font-mono break-all">{{ activeMeta.logDir || 'n/a' }}</div>
            </div>
            <div class="rounded-md border border-default p-3 bg-default">
              <div class="text-xs text-muted">Entries loaded</div>
              <div class="text-sm font-semibold">{{ activeEntries.length }}</div>
            </div>
          </div>

          <!-- Level summary cards -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div class="rounded-md border border-default p-3 bg-default">
              <div class="text-xs text-muted">Errors</div>
              <div class="text-lg font-semibold text-red-400">{{ activeCounts.error }}</div>
            </div>
            <div class="rounded-md border border-default p-3 bg-default">
              <div class="text-xs text-muted">Warnings</div>
              <div class="text-lg font-semibold text-amber-400">{{ activeCounts.warn }}</div>
            </div>
            <div class="rounded-md border border-default p-3 bg-default">
              <div class="text-xs text-muted">Info</div>
              <div class="text-lg font-semibold">{{ activeCounts.info }}</div>
            </div>
            <div class="rounded-md border border-default p-3 bg-default">
              <div class="text-xs text-muted">Debug</div>
              <div class="text-lg font-semibold">{{ activeCounts.debug }}</div>
            </div>
          </div>

          <!-- Filters -->
          <div class="flex flex-wrap items-center gap-2 mb-4">
            <input
              v-model.trim="search"
              type="search"
              placeholder="Search event, summary, details..."
              class="input-textlike px-3 py-2 border border-default rounded-lg bg-default text-default min-w-[280px]"
            />
            <select v-model="levelFilter" class="px-3 py-2 border border-default rounded-lg bg-default text-default min-w-[120px]">
              <option value="">All levels</option>
              <option value="error">Error</option>
              <option value="warn">Warn</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
            <label class="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" v-model="errorsOnly" />
              <span>Errors/warnings only</span>
            </label>
            <label class="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" v-model="groupRelated" />
              <span>Group related events</span>
            </label>
          </div>

          <!-- Error banner -->
          <div v-if="activeError" class="p-3 rounded bg-red-900/20 border border-red-800 text-sm mb-3">
            {{ activeError }}
          </div>

          <!-- Log table -->
          <div class="overflow-x-auto border border-default rounded-md">
            <table class="min-w-full text-sm border-collapse">
              <thead class="bg-default border-b border-default">
                <tr>
                  <th class="p-2 text-left border-r border-default">Time</th>
                  <th class="p-2 text-left border-r border-default">Level</th>
                  <th class="p-2 text-left border-r border-default">Event</th>
                  <th v-if="activeTab === 'server'" class="p-2 text-left border-r border-default">Source</th>
                  <th class="p-2 text-left">Summary</th>
                </tr>
              </thead>
              <tbody class="bg-accent">
                <tr v-if="loading || serverLoading">
                  <td :colspan="activeTab === 'server' ? 5 : 4" class="p-4 text-center">Loading logs…</td>
                </tr>
                <tr v-else-if="displayRows.length === 0">
                  <td :colspan="activeTab === 'server' ? 5 : 4" class="p-4 text-center">No matching log entries.</td>
                </tr>
                <tr
                  v-else
                  v-for="row in displayRows"
                  :key="row.id"
                  class="border-b border-default align-top"
                  :class="{
                    'bg-red-900/10': row.level === 'error',
                    'bg-amber-900/10': row.level === 'warn',
                  }"
                >
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
      </CardContainer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { CardContainer } from "@45drives/houston-common-ui";
import { computed, inject, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useHeader } from "../composables/useHeader";
import { discoveryStateInjectionKey } from "../keys/injection-keys";
import type { DiscoveryState } from "../types";
import { ArrowPathIcon } from '@heroicons/vue/24/outline';
useHeader("Log Viewer");

const router = useRouter();
const discoveryState = inject<DiscoveryState>(discoveryStateInjectionKey)!;

// ─── Types ───────────────────────────────────────────────────────────────

type ParsedLogEntry = {
  id: string;
  timestamp: string;
  level: string;
  event: string;
  summary: string;
  message?: string;
  details?: string;
  source?: string;
  data?: Record<string, any>;
};

type DisplayRow = {
  id: string;
  timestamp: string;
  level: string;
  event: string;
  summary: string;
  details?: string;
  source?: string;
  children?: ParsedLogEntry[];
};

// ─── Shared filter state ─────────────────────────────────────────────────

const activeTab = ref<"client" | "server">("client");
const search = ref("");
const levelFilter = ref("");
const errorsOnly = ref(false);
const groupRelated = ref(true);

// ─── Client logs state ──────────────────────────────────────────────────

const loading = ref(false);
const clientError = ref<string | null>(null);
const clientEntries = ref<ParsedLogEntry[]>([]);
const clientMeta = ref<{ file: string; logDir: string }>({ file: "", logDir: "" });

// ─── Server logs state ─────────────────────────────────────────────────

const serverIp = ref("");
const serverSource = ref("all");
const serverLoading = ref(false);
const serverError = ref<string | null>(null);
const serverEntries = ref<ParsedLogEntry[]>([]);
const serverMeta = ref<{ file: string; logDir: string }>({ file: "", logDir: "" });

// Build dropdown options from discovered servers
const serverOptions = computed(() =>
  discoveryState.servers.map((s) => ({
    ip: s.ip,
    label: s.name && s.name !== s.ip ? `${s.name} (${s.ip})` : s.ip,
  }))
);

// Auto-select the first server when discovered
watch(
  () => discoveryState.servers.length,
  (len) => {
    if (len > 0 && !serverIp.value) {
      serverIp.value = discoveryState.servers[0].ip;
    }
  },
  { immediate: true },
);

// ─── Active data (tab-dependent) ────────────────────────────────────────

const activeEntries = computed(() =>
  activeTab.value === "client" ? clientEntries.value : serverEntries.value
);
const activeError = computed(() =>
  activeTab.value === "client" ? clientError.value : serverError.value
);
const activeMeta = computed(() =>
  activeTab.value === "client" ? clientMeta.value : serverMeta.value
);

const activeCounts = computed(() => {
  const out = { error: 0, warn: 0, info: 0, debug: 0 };
  for (const e of activeEntries.value) {
    const lvl = String(e.level || "").toLowerCase();
    if (lvl === "error") out.error += 1;
    else if (lvl === "warn") out.warn += 1;
    else if (lvl === "debug") out.debug += 1;
    else out.info += 1;
  }
  return out;
});

// ─── Filtered + grouped display rows ─────────────────────────────────

const filteredEntries = computed(() => {
  const q = search.value.toLowerCase();
  return activeEntries.value.filter((entry) => {
    if (levelFilter.value && entry.level !== levelFilter.value) return false;
    if (errorsOnly.value && !["error", "warn"].includes(entry.level)) return false;
    if (!q) return true;
    return (
      entry.event.toLowerCase().includes(q) ||
      entry.summary.toLowerCase().includes(q) ||
      String(entry.details || "").toLowerCase().includes(q)
    );
  });
});

function eventRoot(event: string) {
  const suffixes = ["requested", "succeeded", "failed", "start", "done", "completed"];
  for (const s of suffixes) {
    const tail = `.${s}`;
    if (event.endsWith(tail)) return event.slice(0, -tail.length);
  }
  return event;
}

function severityRank(level: string) {
  if (level === "error") return 3;
  if (level === "warn") return 2;
  if (level === "info") return 1;
  return 0;
}

function groupedRows(items: ParsedLogEntry[]): DisplayRow[] {
  const out: DisplayRow[] = [];
  const maxGapMs = 30_000;

  for (const entry of items) {
    const root = eventRoot(entry.event);
    const entity =
      entry.data?.id ??
      entry.data?.jobId ??
      entry.data?.taskUuid ??
      entry.data?.name ??
      "na";
    const key = `${root}::${entity}`;

    const prev = out[out.length - 1];
    const prevTs = prev ? new Date(prev.timestamp).getTime() : 0;
    const curTs = new Date(entry.timestamp).getTime();
    const near =
      Number.isFinite(prevTs) && Number.isFinite(curTs)
        ? Math.abs(curTs - prevTs) <= maxGapMs
        : false;

    if (prev && prev.id.startsWith(`group:${key}:`) && near) {
      const currentChildren = prev.children || [];
      const allChildren = [...currentChildren, entry];
      const best = allChildren.reduce(
        (acc, c) => (severityRank(c.level) > severityRank(acc) ? c.level : acc),
        prev.level
      );
      prev.children = allChildren;
      prev.level = best;
      prev.timestamp = allChildren[0].timestamp;
      prev.summary = `${root} (${allChildren.length} events)`;
      continue;
    }

    out.push({
      id: `group:${key}:${entry.id}`,
      timestamp: entry.timestamp,
      level: entry.level,
      event: root,
      summary: entry.summary,
      details: entry.details,
      source: entry.source,
      children: [entry],
    });
  }

  return out.map((r) => {
    if (!r.children || r.children.length <= 1) {
      const single = r.children?.[0];
      return {
        id: single?.id || r.id,
        timestamp: single?.timestamp || r.timestamp,
        level: single?.level || r.level,
        event: single?.event || r.event,
        summary: single?.summary || r.summary,
        details: single?.details || r.details,
        source: single?.source || r.source,
      };
    }
    return r;
  });
}

const displayRows = computed<DisplayRow[]>(() => {
  const rows = filteredEntries.value;
  if (!groupRelated.value) return rows.map((r) => ({ ...r }));
  return groupedRows(rows);
});

// ─── Helpers ────────────────────────────────────────────────────────────

function formatTs(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts || "—";
  return d.toLocaleString();
}

function goHome() {
  router.push({ name: "dashboard" });
}

// ─── Client log fetching (via Electron IPC) ─────────────────────────────

async function fetchClientLogs() {
  loading.value = true;
  clientError.value = null;
  try {
    const res = await window.electron?.ipcRenderer.invoke("logs:read-client", {
      limit: 600,
    });
    if (!res?.ok) {
      throw new Error(res?.error || "Unable to read client logs");
    }
    clientEntries.value = Array.isArray(res.entries) ? res.entries : [];
    clientMeta.value = {
      file: String(res.file || ""),
      logDir: String(res.logDir || ""),
    };
  } catch (e: any) {
    clientError.value = e?.message || String(e);
    clientEntries.value = [];
  } finally {
    loading.value = false;
  }
}

// ─── Server log fetching (via IPC → main process → broadcaster API) ──

async function fetchServerLogs() {
  if (!serverIp.value) return;
  serverLoading.value = true;
  serverError.value = null;
  try {
    const res = await window.electron?.ipcRenderer.invoke("logs:read-server", {
      ip: serverIp.value,
      source: serverSource.value,
      limit: 600,
    });
    if (!res?.ok) {
      throw new Error(res?.error || "Unable to read server logs");
    }
    serverEntries.value = Array.isArray(res.entries) ? res.entries : [];
    serverMeta.value = {
      file: serverIp.value,
      logDir: Array.isArray(res.files) ? res.files.join(", ") : "",
    };
  } catch (e: any) {
    serverError.value = e?.message || String(e);
    serverEntries.value = [];
  } finally {
    serverLoading.value = false;
  }
}

// ─── Refresh handler ────────────────────────────────────────────────────

function refresh() {
  if (activeTab.value === "client") {
    fetchClientLogs();
  } else {
    fetchServerLogs();
  }
}

// Auto-fetch client logs on mount
onMounted(() => {
  fetchClientLogs();
});

// Fetch server logs when tab switches to server (if we have an IP and no data yet)
watch(activeTab, (tab) => {
  if (tab === "server" && serverIp.value && serverEntries.value.length === 0) {
    fetchServerLogs();
  }
});
</script>
