<template>
  <!-- Backdrop -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" @click.self="$emit('cancel')">
    <div class="bg-default rounded-xl shadow-2xl border border-neutral-200 dark:border-neutral-700 w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">

      <!-- Header -->
      <div class="px-6 py-4 border-b border-neutral-200 dark:border-neutral-700 shrink-0 text-center">
        <h2 class="text-lg font-bold text-default">Confirm Deployment</h2>
        <p class="text-sm text-muted mt-0.5">Review the configuration for {{ servers.length }} server{{ servers.length > 1 ? 's' : '' }} before deploying.</p>
      </div>

      <!-- Body (scrollable) -->
      <div class="overflow-y-auto flex-1 px-6 py-4 space-y-4">
        <div v-for="srv in servers" :key="srv.id"
          class="rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden max-w-2xl mx-auto">

          <!-- Server header -->
          <div class="px-4 py-2.5 bg-neutral-50 dark:bg-neutral-800 flex items-center gap-3 border-b border-neutral-200 dark:border-neutral-700">
            <span class="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
            <span class="font-semibold text-default text-sm">{{ srv.serverName || srv.host }}</span>
            <span class="text-xs text-muted font-mono">{{ srv.host }}</span>
            <span v-if="srv.serverModel" class="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 ml-auto">
              {{ srv.serverModel }}
            </span>
          </div>

          <div class="px-4 py-3 space-y-3 text-xs text-left">
            <!-- System Summary -->
            <div>
              <div class="font-medium text-muted uppercase tracking-wider mb-1">System Summary</div>
              <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                <span class="text-muted">Mode:</span>
                <span class="text-default font-medium" :class="srv.mode === 'custom' ? 'text-blue-600 dark:text-blue-400' : ''">
                  {{ srv.mode === 'custom' ? 'Custom' : 'Simple' }}
                </span>
                <span class="text-muted">Hostname:</span>
                <span class="text-default">{{ srv.mode === 'custom' ? (srv.customConfig?.srvrName || srv.serverName || '—') : srv.serverName }}</span>
                <span class="text-muted">SSH User:</span>
                <span class="text-default font-mono">{{ srv.username }}</span>
                <template v-if="srv.mode !== 'custom'">
                  <span class="text-muted">Root Password:</span>
                  <span class="text-default">{{ srv.useSameRootPass !== false ? 'Same as SMB password' : 'Custom' }}</span>
                </template>
                <template v-else>
                  <span class="text-muted">Admin User:</span>
                  <span class="text-default font-mono">{{ srv.customConfig?.serverConfig?.adminUser || srv.username }}</span>
                  <span class="text-muted">Disable Root SSH:</span>
                  <span class="text-default">{{ srv.customConfig?.serverConfig?.disableRootSSH ? 'Yes' : 'No' }}</span>
                  <span class="text-muted">NTP:</span>
                  <span class="text-default">{{ srv.customConfig?.serverConfig?.useNTP ? 'Enabled' : 'Disabled' }}</span>
                </template>
              </div>
            </div>

            <!-- Storage ZFS Summary (Simple mode) -->
            <div v-if="srv.mode !== 'custom' && srv.diskInfo && srv.diskInfo.availableDisks.length > 0">
              <div class="font-medium text-muted uppercase tracking-wider mb-1">Storage ZFS Summary</div>
              <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                <span class="text-muted">Pool:</span>
                <span class="text-default font-mono">tank</span>
                <span class="text-muted">RAID Level:</span>
                <span class="text-default">{{ getPreview(srv).raidLabel }}</span>
                <span class="text-muted">Disks:</span>
                <span class="text-default">{{ getPreview(srv).diskCount }}</span>
                <span class="text-muted">Usable Capacity:</span>
                <span class="text-default font-medium">~{{ getPreview(srv).usableCapacity }}</span>
                <span class="text-muted">Dataset:</span>
                <span class="text-default font-mono">/tank/{{ srv.shareName || 'share' }}</span>
              </div>
            </div>

            <!-- Storage ZFS Summary (Custom mode) -->
            <div v-if="srv.mode === 'custom' && srv.customConfig?.zfsConfigs?.length">
              <div class="font-medium text-muted uppercase tracking-wider mb-1">ZFS Configuration</div>
              <div v-for="(zfsCfg, pi) in srv.customConfig.zfsConfigs" :key="pi" class="mb-2">
                <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                  <span class="text-muted">Pool {{ pi + 1 }}:</span>
                  <span class="text-default font-mono">{{ zfsCfg.pool?.name || '—' }}</span>
                  <span class="text-muted">RAID:</span>
                  <span class="text-default">{{ zfsCfg.pool?.vdevs?.[0]?.type || 'auto' }}</span>
                  <span class="text-muted">Disks:</span>
                  <span class="text-default">{{ zfsCfg.pool?.vdevs?.[0]?.disks?.length || 0 }}</span>
                  <span class="text-muted">Dataset:</span>
                  <span class="text-default font-mono">/{{ zfsCfg.pool?.name }}/{{ zfsCfg.dataset?.name }}</span>
                  <span class="text-muted">Compression:</span>
                  <span class="text-default">{{ zfsCfg.poolOptions?.compression || 'lz4' }}</span>
                </div>
              </div>
            </div>

            <!-- Backup ZFS Summary (split pools, simple mode only) -->
            <div v-if="srv.mode !== 'custom' && srv.splitPools && srv.diskInfo && srv.diskInfo.availableDisks.length > 4">
              <div class="font-medium text-muted uppercase tracking-wider mb-1">Backup ZFS Summary</div>
              <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                <span class="text-muted">Pool:</span>
                <span class="text-default font-mono">tank-backup</span>
                <span class="text-muted">RAID Level:</span>
                <span class="text-default">{{ getSplitPreview(srv).backup.raidLabel }}</span>
                <span class="text-muted">Disks:</span>
                <span class="text-default">{{ getSplitPreview(srv).backup.diskCount }}</span>
                <span class="text-muted">Usable Capacity:</span>
                <span class="text-default font-medium">~{{ getSplitPreview(srv).backup.usableCapacity }}</span>
              </div>
            </div>

            <!-- Samba Summary -->
            <div>
              <div class="font-medium text-muted uppercase tracking-wider mb-1">Samba Summary</div>
              <template v-if="srv.mode === 'custom' && srv.customConfig?.sambaConfig">
                <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                  <span class="text-muted">Workgroup:</span>
                  <span class="text-default">{{ srv.customConfig.sambaConfig.global?.workgroup || 'WORKGROUP' }}</span>
                  <span class="text-muted">Shares:</span>
                  <span class="text-default">{{ srv.customConfig.sambaConfig.shares?.length || 0 }}</span>
                  <template v-for="(share, si) in (srv.customConfig.sambaConfig.shares || [])" :key="si">
                    <span class="text-muted pl-2">{{ share.name || '—' }}:</span>
                    <span class="text-default font-mono">{{ share.path || '—' }}</span>
                  </template>
                  <span class="text-muted">SMB User:</span>
                  <span class="text-default font-mono">{{ srv.customConfig.smbUser || '—' }}</span>
                </div>
              </template>
              <template v-else>
                <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                  <span class="text-muted">Share:</span>
                  <span class="text-default font-mono">{{ srv.shareName || 'share' }}</span>
                  <span class="text-muted">Path:</span>
                  <span class="text-default font-mono">/tank/{{ srv.shareName || 'share' }}</span>
                  <span class="text-muted">SMB User:</span>
                  <span class="text-default font-mono">{{ srv.smbUser }}</span>
                </div>
              </template>
            </div>

            <!-- Users & Groups (custom mode) -->
            <div v-if="srv.mode === 'custom' && srv.customConfig?.usersAndGroups">
              <div class="font-medium text-muted uppercase tracking-wider mb-1">Users &amp; Groups</div>
              <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                <span class="text-muted">Users:</span>
                <span class="text-default">
                  {{ (srv.customConfig.usersAndGroups.users || []).map(u => u.username).filter(Boolean).join(', ') || 'None (admin only)' }}
                </span>
                <span class="text-muted">Groups:</span>
                <span class="text-default">
                  {{ (srv.customConfig.usersAndGroups.groups || []).map(g => g.name).filter(Boolean).join(', ') || 'Default' }}
                </span>
              </div>
            </div>

            <!-- Warnings -->
            <div v-if="hasWarnings(srv)" class="flex flex-wrap gap-2 mt-1">
              <span v-if="srv.clearExistingData" class="px-2 py-0.5 rounded text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                ⚠ Will destroy existing pools &amp; shares
              </span>
              <span v-if="srv.diskInfo && srv.diskInfo.existingPools.length > 0" class="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                Existing pools: {{ srv.diskInfo.existingPools.join(', ') }}
              </span>
              <span v-if="!srv.diskInfo" class="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                ⚠ Disks not probed
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="px-6 py-4 border-t border-neutral-200 dark:border-neutral-700 shrink-0 flex items-center justify-center gap-6 relative">
        <div v-if="destructiveCount > 0" class="text-xs text-red-600 dark:text-red-400 font-medium absolute left-6">
          {{ destructiveCount }} server{{ destructiveCount > 1 ? 's' : '' }} will have existing data destroyed.
        </div>
        <div class="flex items-center gap-3">
          <button @click="$emit('cancel')" class="btn btn-secondary h-fit px-4 py-2 text-sm">
            Cancel
          </button>
          <button @click="$emit('confirm')" class="btn btn-primary h-fit px-6 py-2 text-sm font-semibold"
            :class="destructiveCount > 0 ? 'bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700' : ''">
            {{ destructiveCount > 0 ? 'Deploy (Destructive)' : 'Deploy All' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { BulkServerState } from '../../composables/useBulkSetup';
import { getSinglePoolPreview, getSplitPoolPreview } from '../../../shared/bulkSetupRaid';

const props = defineProps<{
  servers: BulkServerState[];
}>();

defineEmits<{
  confirm: [];
  cancel: [];
}>();

function getPreview(srv: BulkServerState) {
  const disks = srv.diskInfo?.availableDisks || [];
  if (srv.splitPools) {
    return getSplitPoolPreview(disks).storage;
  }
  return getSinglePoolPreview(disks);
}

function getSplitPreview(srv: BulkServerState) {
  const disks = srv.diskInfo?.availableDisks || [];
  return getSplitPoolPreview(disks);
}

function hasWarnings(srv: BulkServerState): boolean {
  return !!(srv.clearExistingData || !srv.diskInfo || (srv.diskInfo && srv.diskInfo.existingPools.length > 0));
}

const destructiveCount = computed(() =>
  props.servers.filter(s => s.clearExistingData).length
);
</script>
