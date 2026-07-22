<template>
  <div class="h-full overflow-y-auto ui-texture-surface ui-texture-surface--soft">
    <div class="max-w-5xl mx-auto px-6 py-6 space-y-5">

      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-bold text-default">Bulk Server Setup</h1>
          <p class="text-sm text-muted mt-0.5">Configure and deploy multiple servers at once.</p>
        </div>
        <div class="flex items-center gap-2">
          <button @click="onImportTemplate" class="btn btn-secondary text-sm h-fit px-3 py-2">
            Import Template
          </button>
          <button v-if="servers.length > 0" @click="onExportTemplate" class="btn btn-secondary text-sm h-fit px-3 py-2">
            Export Template
          </button>
        <!-- Back to dashboard (always available) -->
        <button @click="router.push({ name: 'dashboard' })"
            class="btn btn-secondary h-fit px-4 py-2 text-sm">
            Back to Dashboard
        </button>

        </div>
      </div>

      <!-- Global defaults -->
      <div v-if="servers.length > 1"
        class="card-refined rounded-lg px-4 py-3">
        <div class="flex items-center gap-3 mb-2">
          <h2 class="text-sm font-semibold text-default">Global Defaults</h2>
          <span class="text-xs text-muted">(Applied to servers without per-server values)</span>
        </div>
        <div class="grid grid-cols-4 gap-3">
          <div>
            <label class="text-xs font-medium text-muted mb-1 block">SSH Username</label>
            <input v-model="globalDefaults.username" type="text" placeholder="root"
              class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label class="text-xs font-medium text-muted mb-1 block">SSH Password</label>
            <input v-model="globalDefaults.password" type="password" placeholder="Shared password"
              class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label class="text-xs font-medium text-muted mb-1 block">SMB Username</label>
            <input v-model="globalDefaults.smbUser" type="text" placeholder="user"
              class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label class="text-xs font-medium text-muted mb-1 block">SMB Password</label>
            <input v-model="globalDefaults.smbPass" type="password" placeholder="Shared SMB pass"
              class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm" />
          </div>
        </div>
        <button @click="onApplyDefaults" class="mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline">
          Apply to all servers missing values
        </button>
      </div>

      <!-- Server list -->
      <div class="space-y-3">
        <BulkServerCard
          v-for="(srv, i) in servers"
          :key="srv.id"
          :server="srv"
          :index="i"
          :isRunning="isRunning"
          :isProbing="probingServers.has(srv.id)"
          :discoveredServers="discoveryState.servers"
          @remove="removeServer(i)"
          @retry="retryServer($event)"
          @connectAndProbe="onConnectAndProbe($event)"
        />
      </div>

      <!-- Add server button -->
      <button @click="addServer()" :disabled="isRunning"
        class="w-full py-3 rounded-lg border-2 border-dashed border-neutral-300 dark:border-neutral-600 text-sm font-medium text-muted hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors disabled:opacity-50">
        + Add Server
      </button>

      <!-- Action bar -->
      <div v-if="servers.length > 0"
        class="sticky bottom-0 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm border-t border-neutral-200 dark:border-neutral-700 -mx-6 px-6 py-4 flex items-center justify-between">
        <div class="flex items-center gap-3 text-sm">
          <span class="text-default font-medium">{{ totalServers }} server{{ totalServers > 1 ? 's' : '' }}</span>
          <span v-if="!isRunning && !isComplete && !allProbed" class="text-amber-600 dark:text-amber-400 text-xs">
            (probe all servers before deploying)
          </span>
          <span v-if="completedServers > 0" class="text-green-600 dark:text-green-400 font-medium">✓ {{ completedServers }} done</span>
          <span v-if="failedServers > 0" class="text-red-600 dark:text-red-400 font-medium">✗ {{ failedServers }} failed</span>
          <span v-if="isRunning && currentServerLabel" class="text-blue-600 dark:text-blue-400 animate-pulse">
            ⟳ {{ currentServerLabel }}
          </span>
        </div>

        <div class="flex items-center gap-3">

          <!-- Parallel toggle -->
          <label v-if="!isComplete" class="flex items-center gap-2 text-xs text-muted cursor-pointer">
            <input type="checkbox" v-model="parallel" :disabled="isRunning" class="rounded" />
            Parallel mode
          </label>

          <button v-if="!isRunning && !isComplete" @click="onProbeAll" :disabled="servers.length === 0 || allProbed || isProbingAll"
            class="btn btn-secondary h-fit px-4 py-2 text-sm font-medium"
            :class="allProbed ? 'text-green-600 dark:text-green-400' : ''">
            <span v-if="isProbingAll" class="inline-flex items-center gap-1">
              <span class="inline-block w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              Probing...
            </span>
            <span v-else-if="allProbed">✓ All Connected</span>
            <span v-else>Connect &amp; Probe All</span>
          </button>

          <button v-if="!isRunning && !isComplete" @click="onDeploy" :disabled="servers.length === 0 || !allProbed"
            class="btn btn-primary h-fit px-6 py-2 text-sm font-semibold">
            Deploy All
          </button>

          <button v-if="isRunning" @click="onCancel"
            class="btn btn-secondary h-fit px-4 py-2 text-sm text-red-600">
            Cancel
          </button>

          <!-- Post-complete actions -->
          <button v-if="isComplete && failedServers > 0" @click="onRetryFailed"
            class="btn btn-secondary h-fit px-4 py-2 text-sm text-amber-600">
            Retry Failed
          </button>
          <button v-if="isComplete" @click="onReset"
            class="btn btn-secondary h-fit px-4 py-2 text-sm">
            New Batch
          </button>
        </div>
      </div>

      <!-- Completion Summary -->
      <div v-if="isComplete"
        class="bg-default rounded-lg border px-5 py-4 space-y-3"
        :class="failedServers > 0 ? 'border-amber-300 dark:border-amber-700' : 'border-green-300 dark:border-green-700'">
        <div class="flex items-center gap-3">
          <span v-if="failedServers === 0" class="text-2xl">✅</span>
          <span v-else class="text-2xl">⚠️</span>
          <div>
            <h2 class="text-lg font-bold text-default">
              {{ failedServers === 0 ? 'All Servers Setup Successfully' : 'Setup Completed with Errors' }}
            </h2>
            <p class="text-sm text-muted">
              {{ completedServers }}/{{ totalServers }} succeeded
              <span v-if="totalDuration"> · Total time: {{ totalDuration }}</span>
            </p>
          </div>
        </div>

        <!-- Per-server results -->
        <div class="grid gap-2 mt-3">
          <div v-for="srv in servers" :key="srv.id"
            class="flex items-center gap-3 px-3 py-2 rounded text-sm"
            :class="srv.result?.success ? 'bg-green-50 dark:bg-green-900/10' : 'bg-red-50 dark:bg-red-900/10'">
            <span :class="srv.result?.success ? 'text-green-600' : 'text-red-600'">
              {{ srv.result?.success ? '✓' : '✗' }}
            </span>
            <span class="font-medium text-default">{{ srv.serverName || srv.host }}</span>
            <span class="text-muted font-mono text-xs">{{ srv.host }}</span>
            <span v-if="srv.result?.success && srv.result?.durationMs" class="text-xs text-muted ml-auto">
              {{ formatDuration(srv.result.durationMs) }}
            </span>
            <span v-if="srv.result?.error" class="text-xs text-red-600 dark:text-red-400 ml-auto truncate max-w-xs">
              {{ srv.result.error }}
            </span>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="servers.length === 0" class="text-center py-16">
        <ServerIcon class="w-12 h-12 text-neutral-300 dark:text-neutral-600 mx-auto mb-3" />
        <p class="text-muted">No servers added yet.</p>
        <p class="text-sm text-neutral-400 dark:text-neutral-500 mt-1">Add servers manually, or import a template to get started.</p>
      </div>

    </div>

    <!-- Deploy confirmation modal -->
    <BulkDeployConfirmModal
      v-if="showConfirmModal"
      :servers="servers"
      @confirm="onConfirmDeploy"
      @cancel="showConfirmModal = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ServerIcon } from '@heroicons/vue/24/outline';
import { useHeader } from '../../composables/useHeader';
import { useServerDiscovery } from '../../composables/useServerDiscovery';
import { useBulkSetup } from '../../composables/useBulkSetup';
import BulkServerCard from './BulkServerCard.vue';
import BulkDeployConfirmModal from './BulkDeployConfirmModal.vue';

useHeader('Bulk Server Setup');

const router = useRouter();
const { discoveryState } = useServerDiscovery();

const {
  servers,
  isRunning,
  isComplete,
  totalServers,
  completedServers,
  failedServers,
  addServer,
  removeServer,
  applyGlobalDefaults,
  connectAndProbe,
  preflightCheck,
  deploy,
  cancel,
  retryServer,
  exportTemplate,
  importTemplate,
  startListening,
  clearAll,
} = useBulkSetup();

const parallel = ref(true);
const showConfirmModal = ref(false);
const probingServers = ref(new Set<string>());
const isProbingAll = ref(false);

const allProbed = computed(() =>
  servers.value.length > 0 && servers.value.every(s => s.validated === true && s.diskInfo)
);

const globalDefaults = ref({
  username: 'root',
  password: '',
  smbUser: '',
  smbPass: '',
});

onMounted(() => {
  startListening();
  // Enable discovery for server selection dropdown
  window.electron?.ipcRenderer.invoke('discovery:setEnabled', true);
});

// Currently-running server label for the status bar
const currentServerLabel = computed(() => {
  const active = servers.value.find(s =>
    s.progress?.status === 'bootstrapping' || s.progress?.status === 'configuring'
  );
  if (!active) return '';
  return `${active.serverName || active.host}: ${active.progress?.label || ''}`;
});

// Total duration for completion summary
const totalDuration = computed(() => {
  const durations = servers.value
    .map(s => s.result?.durationMs)
    .filter((d): d is number => d != null);
  if (durations.length === 0) return '';
  const total = durations.reduce((a, b) => a + b, 0);
  return formatDuration(total);
});

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function onRetryFailed() {
  const failed = servers.value.filter(s => s.result && !s.result.success);
  for (const srv of failed) {
    retryServer(srv.host);
  }
}

function onReset() {
  clearAll();
}

function onApplyDefaults() {
  applyGlobalDefaults(globalDefaults.value);
}

async function onConnectAndProbe(serverId: string) {
  probingServers.value.add(serverId);
  try {
    await connectAndProbe(serverId);
  } finally {
    probingServers.value.delete(serverId);
  }
}

async function onProbeAll() {
  isProbingAll.value = true;
  try {
    for (const srv of servers.value) {
      if (!srv.validated || !srv.diskInfo) {
        probingServers.value.add(srv.id);
        try {
          await connectAndProbe(srv.id);
        } finally {
          probingServers.value.delete(srv.id);
        }
      }
    }
  } finally {
    isProbingAll.value = false;
  }
}

async function onDeploy() {
  // Apply global defaults to any servers missing creds
  onApplyDefaults();
  // Run preflight checks (validate fields, SSH, probe disks)
  const ok = await preflightCheck();
  if (!ok) return; // errors are shown inline on each card
  // Show confirmation modal
  showConfirmModal.value = true;
}

async function onConfirmDeploy() {
  showConfirmModal.value = false;
  await deploy({ parallel: parallel.value, maxConcurrency: 3 });
}

function onCancel() {
  cancel();
}

function onExportTemplate() {
  const template = exportTemplate();
  const json = JSON.stringify(template, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bulk-setup-template-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function onImportTemplate() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const template = JSON.parse(text);
      if (template.servers && Array.isArray(template.servers)) {
        importTemplate(template);
      } else {
        alert('Invalid template file: missing "servers" array.');
      }
    } catch {
      alert('Failed to parse template file.');
    }
  };
  input.click();
}
</script>
