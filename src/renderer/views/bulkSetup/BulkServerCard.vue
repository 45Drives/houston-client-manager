<template>
  <div class="rounded-lg border bg-default overflow-hidden transition-all"
    :class="borderClass">
    <!-- Header (always visible) -->
    <div class="flex items-center gap-3 px-4 py-3 cursor-pointer select-none" @click="expanded = !expanded">
      <!-- Status indicator -->
      <span class="w-2.5 h-2.5 rounded-full shrink-0" :class="statusDotClass" />

      <!-- Server info -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-medium text-default text-sm truncate">
            {{ server.serverName || server.host || `Server ${index + 1}` }}
          </span>
          <span v-if="server.host" class="text-xs text-muted font-mono">{{ server.host }}</span>
          <span v-if="server.serverModel" class="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
            {{ server.serverModel }}
          </span>
          <span v-if="statusLabel" class="text-xs ml-2" :class="statusTextClass">
            {{ statusLabel }}
          </span>
        </div>
      </div>

      <!-- Progress (during setup) -->
      <div v-if="server.progress && isRunning" class="w-24 shrink-0">
        <div class="h-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden">
          <div class="h-full bg-blue-500 rounded-full transition-all duration-300"
            :style="{ width: progressPercent + '%' }" />
        </div>
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-1 shrink-0">
        <button v-if="canRetry" @click.stop="$emit('retry', server.host)"
          class="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 text-amber-600" title="Retry">
          <ArrowPathIcon class="w-4 h-4" />
        </button>
        <button v-if="!isRunning" @click.stop="$emit('remove', index)"
          class="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 text-red-500" title="Remove">
          <XMarkIcon class="w-4 h-4" />
        </button>
        <ChevronDownIcon class="w-4 h-4 text-neutral-400 dark:text-neutral-500 transition-transform" :class="{ 'rotate-180': expanded }" />
      </div>
    </div>

    <!-- Expanded content: Config form (only before/without setup) -->
    <div v-show="expanded && !isRunning && !hasStarted" class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-4 space-y-4">
      <!-- Connection -->
      <div class="grid grid-cols-[1fr_auto_auto] gap-3">
        <div>
          <label class="text-xs font-medium text-muted mb-1 block">IP / Hostname</label>
          <input v-model="server.host" type="text" placeholder="192.168.1.100"
            class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm"
            :class="server.fieldErrors?.host ? 'border-red-400 dark:border-red-600' : ''" />
          <span v-if="server.fieldErrors?.host" class="text-xs text-red-500 dark:text-red-400 mt-0.5 block">{{ server.fieldErrors.host }}</span>
        </div>
        <div class="min-w-[130px]">
          <label class="text-xs font-medium text-muted mb-1 block">SSH Username</label>
          <input v-model="server.username" type="text" placeholder="root"
            class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div class="min-w-[150px]">
          <label class="text-xs font-medium text-muted mb-1 block">SSH Password</label>
          <div class="relative">
            <input v-model="server.password" :type="showSshPass ? 'text' : 'password'" placeholder="••••••••"
              class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm pr-8"
              :class="server.fieldErrors?.password ? 'border-red-400 dark:border-red-600' : ''"
              :disabled="server.authMethod === 'key'" />
            <button type="button" @click="showSshPass = !showSshPass"
              class="absolute right-2 top-1/2 -translate-y-1/2 text-muted">
              <EyeIcon v-if="!showSshPass" class="w-4 h-4" />
              <EyeSlashIcon v-if="showSshPass" class="w-4 h-4" />
            </button>
          </div>
          <span v-if="server.fieldErrors?.password" class="text-xs text-red-500 dark:text-red-400 mt-0.5 block">{{ server.fieldErrors.password }}</span>
        </div>
      </div>

      <!-- Advanced: SSH Key Auth -->
      <details class="text-xs">
        <summary class="cursor-pointer text-muted hover:text-default select-none font-medium">Advanced: Use SSH Key</summary>
        <div class="mt-2 space-y-2 pl-2 border-l-2 border-neutral-200 dark:border-neutral-700">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" :checked="server.authMethod === 'key'"
              @change="server.authMethod = ($event.target as HTMLInputElement).checked ? 'key' : 'password'"
              class="rounded border-neutral-400 dark:border-neutral-500 text-blue-500 focus:ring-blue-500" />
            <span class="text-xs text-default">Authenticate with SSH private key instead of password</span>
          </label>
          <div v-if="server.authMethod === 'key'" class="flex items-center gap-2">
            <input v-model="server.sshKeyPath" type="text" placeholder="/path/to/id_rsa" readonly
              class="w-1/2 input-textlike rounded-lg px-3 py-1.5 text-sm bg-neutral-50 dark:bg-neutral-800" />
            <button type="button" @click="browseSshKey"
              class="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-600 hover:bg-hover transition-colors">
              Browse…
            </button>
            <div class="w-1/3 ml-auto relative">
              <input v-model="server.sshPassphrase" :type="showKeyPass ? 'text' : 'password'" placeholder="Passphrase (optional)"
                class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm pr-8" />
              <button type="button" @click="showKeyPass = !showKeyPass"
                class="absolute right-2 top-1/2 -translate-y-1/2 text-muted">
                <EyeIcon v-if="!showKeyPass" class="w-4 h-4" />
                <EyeSlashIcon v-if="showKeyPass" class="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </details>

      <!-- Discovery server picker + Connect & Probe -->
      <div class="flex items-center gap-2">
        <div v-if="discoveredServers.length" class="flex items-center gap-2 flex-1">
          <label class="text-xs font-medium text-muted shrink-0">Or pick from discovery:</label>
          <select @change="onPickDiscovered($event)" :value="server.host"
            class="input-textlike rounded-lg px-3 py-1.5 text-sm flex-1 max-w-xs">
            <option value="" disabled>— Select a discovered server —</option>
            <option v-for="s in discoveredServers" :key="s.ip" :value="s.ip">{{ s.name }} ({{ s.ip }})</option>
          </select>
        </div>
        <button @click="$emit('connectAndProbe', server.id)" :disabled="!server.host || (!server.password && server.authMethod !== 'key') || (server.authMethod === 'key' && !server.sshKeyPath) || isProbing"
          class="h-fit px-3 py-1.5 text-xs font-medium shrink-0 rounded-lg border transition-colors"
          :class="server.validated === true && server.diskInfo
            ? 'bg-green-600 hover:bg-green-700 text-white border-green-600 dark:bg-green-600 dark:hover:bg-green-700 dark:border-green-600'
            : 'btn btn-secondary border-blue-400 dark:border-blue-500'">
          <span v-if="isProbing" class="inline-flex items-center gap-1">
            <span class="inline-block w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            Connecting &amp; detecting disks...
          </span>
          <span v-else-if="server.validated === true && server.diskInfo">✓ Connected &amp; Probed</span>
          <span v-else>Connect &amp; Probe Disks</span>
        </button>
      </div>

      <!-- Connect hint (shown only when not yet probed) -->
      <div v-if="!server.validated && !server.validationError && server.host && server.password" class="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 rounded flex items-center gap-2">
        <span class="text-sm">💡</span>
        <span>Click <strong>Connect &amp; Probe Disks</strong> to verify SSH access and detect available storage drives before deploying.</span>
      </div>

      <!-- Validation error -->
      <div v-if="server.validationError" class="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded">
        {{ server.validationError }}
      </div>

      <!-- Setup Mode toggle -->
      <div class="flex items-center gap-3">
        <label class="text-xs font-medium text-muted">Setup Mode:</label>
        <button @click="server.mode = 'simple'"
          class="px-3 py-1 rounded text-xs font-medium transition-colors"
          :class="server.mode === 'simple' ? 'bg-blue-500 text-white' : 'bg-neutral-100 dark:bg-neutral-700 text-default'">
          Simple
        </button>
        <button @click="server.mode = 'custom'"
          class="px-3 py-1 rounded text-xs font-medium transition-colors"
          :class="server.mode === 'custom' ? 'bg-blue-500 text-white' : 'bg-neutral-100 dark:bg-neutral-700 text-default'">
          Custom
        </button>
      </div>

      <!-- Clear existing data toggle -->
      <div class="flex items-center gap-2">
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" v-model="server.clearExistingData"
            class="rounded border-neutral-400 dark:border-neutral-500 text-red-500 focus:ring-red-500" />
          <span class="text-xs font-medium" :class="server.clearExistingData ? 'text-red-600 dark:text-red-400' : 'text-muted'">Destroy existing ZFS pools &amp; Samba shares</span>
        </label>
        <span v-if="server.clearExistingData" class="text-xs text-red-500 font-medium">⚠ All existing data will be wiped</span>
      </div>

      <!-- Active Backup toggle -->
      <div v-if="server.mode === 'simple'" class="flex items-center gap-2">
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" v-model="server.splitPools"
            :disabled="server.diskInfo && server.diskInfo.availableDisks.length <= 4"
            class="rounded border-neutral-400 dark:border-neutral-500 text-blue-500 focus:ring-blue-500" />
          <span class="text-xs font-medium" :class="server.splitPools ? 'text-blue-600 dark:text-blue-400' : 'text-muted'">Active Backup (split disks into storage + backup pools)</span>
        </label>
        <span v-if="server.diskInfo && server.diskInfo.availableDisks.length <= 4"
          class="text-xs text-red-500 dark:text-red-400">Not enough disks (need more than 4)</span>
      </div>

      <!-- Simple mode fields -->
      <div v-if="server.mode === 'simple'" class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-medium text-muted mb-1 block">Server Name (hostname)</label>
            <input v-model="server.serverName" type="text" placeholder="my-server"
              class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm"
              :class="server.fieldErrors?.serverName ? 'border-red-400 dark:border-red-600' : ''" />
            <span v-if="server.fieldErrors?.serverName" class="text-xs text-red-500 dark:text-red-400 mt-0.5 block">{{ server.fieldErrors.serverName }}</span>
          </div>
          <div>
            <label class="text-xs font-medium text-muted mb-1 block">Share Name</label>
            <input v-model="server.shareName" type="text" placeholder="share"
              class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm"
              :class="server.fieldErrors?.shareName ? 'border-red-400 dark:border-red-600' : ''" />
            <span v-if="server.fieldErrors?.shareName" class="text-xs text-red-500 dark:text-red-400 mt-0.5 block">{{ server.fieldErrors.shareName }}</span>
          </div>
        </div>

        <!-- SMB + Root password 2-column layout -->
        <div class="grid grid-cols-2 gap-3">
          <!-- Left column: SMB User, SMB Pass, Confirm SMB Pass -->
          <div class="space-y-2">
            <div>
              <label class="text-xs font-medium text-muted mb-1 block">SMB Username</label>
              <input v-model="server.smbUser" type="text" placeholder="user"
                class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm"
                :class="server.fieldErrors?.smbUser ? 'border-red-400 dark:border-red-600' : ''" />
              <span v-if="server.fieldErrors?.smbUser" class="text-xs text-red-500 dark:text-red-400 mt-0.5 block">{{ server.fieldErrors.smbUser }}</span>
            </div>
            <div>
              <label class="text-xs font-medium text-muted mb-1 block">SMB Password</label>
              <div class="relative">
                <input v-model="server.smbPass" :type="showSmbPass ? 'text' : 'password'" placeholder="••••••••"
                  class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm pr-8"
                  :class="server.fieldErrors?.smbPass ? 'border-red-400 dark:border-red-600' : ''" />
                <button type="button" @click="showSmbPass = !showSmbPass"
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-muted">
                  <EyeIcon v-if="!showSmbPass" class="w-4 h-4" />
                  <EyeSlashIcon v-if="showSmbPass" class="w-4 h-4" />
                </button>
              </div>
              <span v-if="server.fieldErrors?.smbPass" class="text-xs text-red-500 dark:text-red-400 mt-0.5 block">{{ server.fieldErrors.smbPass }}</span>
            </div>
            <div>
              <label class="text-xs font-medium text-muted mb-1 block">Confirm SMB Password</label>
              <div class="relative">
                <input v-model="server.smbPassConfirm" :type="showSmbPass ? 'text' : 'password'" placeholder="••••••••"
                  class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm pr-8"
                  :class="server.fieldErrors?.smbPassConfirm ? 'border-red-400 dark:border-red-600' : ''" />
                <button type="button" @click="showSmbPass = !showSmbPass"
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-muted">
                  <EyeIcon v-if="!showSmbPass" class="w-4 h-4" />
                  <EyeSlashIcon v-if="showSmbPass" class="w-4 h-4" />
                </button>
              </div>
              <span v-if="server.fieldErrors?.smbPassConfirm" class="text-xs text-red-500 dark:text-red-400 mt-0.5 block">{{ server.fieldErrors.smbPassConfirm }}</span>
              <span v-else-if="server.smbPassConfirm && server.smbPass === server.smbPassConfirm"
                class="text-xs text-green-600 dark:text-green-400 mt-0.5 block">✓ Passwords match</span>
            </div>
          </div>

          <!-- Right column: Use same password toggle, Root Pass, Confirm Root Pass -->
          <div class="space-y-2">
            <div>
              <label class="text-xs font-medium text-muted mb-1 block">&nbsp;</label>
              <label class="flex items-center gap-2 cursor-pointer w-fit mt-2.5 py-1.5">
                <input type="checkbox" v-model="server.useSameRootPass"
                  class="rounded border-neutral-400 dark:border-neutral-500" />
                <span class="text-xs font-medium text-muted">Use same password for root</span>
              </label>
            </div>
            <template v-if="server.useSameRootPass === false">
              <div>
                <label class="text-xs font-medium text-muted mb-1 block">Root Password</label>
                <div class="relative">
                  <input v-model="server.rootPass" :type="showRootPass ? 'text' : 'password'" placeholder="••••••••"
                    class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm pr-8"
                    :class="server.fieldErrors?.rootPass ? 'border-red-400 dark:border-red-600' : ''" />
                  <button type="button" @click="showRootPass = !showRootPass"
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-muted">
                    <EyeIcon v-if="!showRootPass" class="w-4 h-4" />
                    <EyeSlashIcon v-if="showRootPass" class="w-4 h-4" />
                  </button>
                </div>
                <span v-if="server.fieldErrors?.rootPass" class="text-xs text-red-500 dark:text-red-400 mt-0.5 block">{{ server.fieldErrors.rootPass }}</span>
              </div>
              <div>
                <label class="text-xs font-medium text-muted mb-1 block">Confirm Root Password</label>
                <div class="relative">
                  <input v-model="server.rootPassConfirm" :type="showRootPass ? 'text' : 'password'" placeholder="••••••••"
                    class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm pr-8"
                    :class="server.fieldErrors?.rootPassConfirm ? 'border-red-400 dark:border-red-600' : ''" />
                  <button type="button" @click="showRootPass = !showRootPass"
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-muted">
                    <EyeIcon v-if="!showRootPass" class="w-4 h-4" />
                    <EyeSlashIcon v-if="showRootPass" class="w-4 h-4" />
                  </button>
                </div>
                <span v-if="server.fieldErrors?.rootPassConfirm" class="text-xs text-red-500 dark:text-red-400 mt-0.5 block">{{ server.fieldErrors.rootPassConfirm }}</span>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Custom mode config -->
      <BulkCustomConfig
        v-if="server.mode === 'custom'"
        :modelValue="server.customConfig || {}"
        :diskInfo="server.diskInfo"
        :existingGroups="server.existingGroups"
        :existingUsers="server.existingUsers"
        @update:modelValue="server.customConfig = $event"
      />

      <!-- Custom mode validation errors -->
      <div v-if="server.mode === 'custom' && hasCustomErrors" class="space-y-1">
        <div v-for="err in customErrorMessages" :key="err" class="text-xs text-red-500 dark:text-red-400">
          • {{ err }}
        </div>
      </div>

      <!-- Storage info: Preview (left) + Detected Disks (right) -->
      <div v-if="server.diskInfo && server.mode === 'simple'" class="grid grid-cols-2 gap-4 items-start">
        <!-- Left: Storage Preview -->
        <div v-if="server.diskInfo.availableDisks.length > 0" class="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/50 p-3 text-xs space-y-2 text-left">
          <div class="font-medium text-default text-sm">Storage Preview</div>

          <!-- Single pool preview -->
          <template v-if="!server.splitPools">
            <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <span class="text-muted">Pool:</span>
              <span class="text-default font-mono">tank</span>
              <span class="text-muted">RAID:</span>
              <span class="text-default">{{ raidPreview.raidLabel }} ({{ raidPreview.diskCount }} disks)</span>
              <span class="text-muted">Usable:</span>
              <span class="text-default font-medium">~{{ raidPreview.usableCapacity }}</span>
              <span class="text-muted">Raw:</span>
              <span class="text-default">{{ raidPreview.rawCapacity }}</span>
            </div>
          </template>

          <!-- Split pool preview -->
          <template v-else>
            <div class="space-y-2">
              <div class="space-y-1 p-2 rounded bg-default border border-neutral-200 dark:border-neutral-700">
                <div class="font-medium text-blue-600 dark:text-blue-400">Storage Pool</div>
                <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  <span class="text-muted">Pool:</span>
                  <span class="text-default font-mono">tank</span>
                  <span class="text-muted">RAID:</span>
                  <span class="text-default">{{ splitPreview.storage.raidLabel }}</span>
                  <span class="text-muted">Disks:</span>
                  <span class="text-default">{{ splitPreview.storage.diskCount }}</span>
                  <span class="text-muted">Usable:</span>
                  <span class="text-default font-medium">~{{ splitPreview.storage.usableCapacity }}</span>
                </div>
              </div>
              <div class="space-y-1 p-2 rounded bg-default border border-neutral-200 dark:border-neutral-700">
                <div class="font-medium text-green-600 dark:text-green-400">Backup Pool</div>
                <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  <span class="text-muted">Pool:</span>
                  <span class="text-default font-mono">tank-backup</span>
                  <span class="text-muted">RAID:</span>
                  <span class="text-default">{{ splitPreview.backup.raidLabel }}</span>
                  <span class="text-muted">Disks:</span>
                  <span class="text-default">{{ splitPreview.backup.diskCount }}</span>
                  <span class="text-muted">Usable:</span>
                  <span class="text-default font-medium">~{{ splitPreview.backup.usableCapacity }}</span>
                </div>
              </div>
              <div class="text-muted text-xs">ZFS replication will sync storage → backup automatically</div>
            </div>
          </template>
        </div>
        <div v-else />

        <!-- Right: Detected Disks -->
        <div class="text-xs">
          <div class="font-medium text-muted mb-1">Detected Disks:</div>
          <div class="flex flex-wrap gap-1.5">
            <span v-for="(disk, di) in server.diskInfo.availableDisks" :key="disk.name"
              class="px-2 py-0.5 rounded font-mono"
              :class="diskBadgeClass(di)"
              :title="diskTooltip(di)">
              {{ disk.alias || disk.name }} ({{ disk.size }}, {{ disk.type }})
            </span>
          </div>
          <div v-if="server.splitPools && spareCount > 0" class="mt-1.5 text-amber-500 dark:text-amber-400">
            {{ spareCount }} disk unassigned (odd number — left as spare)
          </div>
          <div v-if="server.diskInfo.existingPools.length" class="mt-1.5 text-amber-600 dark:text-amber-400">
            ⚠ Existing pools: {{ server.diskInfo.existingPools.join(', ') }}
          </div>
        </div>
      </div>
    </div>

    <!-- Expanded content: Running checklist (during setup and after completion) -->
    <div v-show="expanded && hasStarted" class="border-t border-neutral-200 dark:border-neutral-700 px-4 py-4 space-y-3">
      <!-- Step checklist -->
      <div class="space-y-1.5">
        <div v-for="s in server.steps" :key="s.step" class="flex items-start gap-2 text-sm">
          <!-- Step icon -->
          <span class="shrink-0 w-5 text-center mt-0.5">
            <span v-if="s.status === 'done'" class="text-green-500 dark:text-green-400">✓</span>
            <span v-else-if="s.status === 'failed'" class="text-red-500">✗</span>
            <span v-else-if="s.status === 'running'" class="inline-block w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span v-else class="text-neutral-300 dark:text-neutral-600">○</span>
          </span>
          <!-- Step label -->
          <div class="flex-1 min-w-0">
            <span class="text-default" :class="{ 'font-medium': s.status === 'running' }">{{ s.label }}</span>
            <span v-if="s.error" class="block text-xs text-red-500 dark:text-red-400 mt-0.5 truncate">{{ s.error }}</span>
          </div>
        </div>
      </div>

      <!-- Summary (after completion) -->
      <div v-if="server.result" class="mt-3 pt-3 border-t border-neutral-200 dark:border-neutral-700">
        <div v-if="server.result.success" class="space-y-1">
          <div class="text-sm font-medium text-green-600 dark:text-green-400">Setup Complete</div>
          <div v-if="server.result.summary" class="text-xs text-muted">{{ server.result.summary }}</div>
          <div v-if="server.result.durationMs" class="text-xs text-muted">
            Duration: {{ formatDuration(server.result.durationMs) }}
          </div>
          <div v-if="server.result.reboot" class="text-xs text-blue-600 dark:text-blue-400">
            Server was rebooted to apply hostname change
          </div>
        </div>
        <div v-else class="space-y-1">
          <div class="text-sm font-medium text-red-600 dark:text-red-400">Setup Failed</div>
          <div v-if="server.result.error" class="text-xs text-red-500 dark:text-red-400">{{ server.result.error }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { ChevronDownIcon, XMarkIcon, ArrowPathIcon, EyeIcon, EyeSlashIcon } from '@heroicons/vue/20/solid';
import BulkCustomConfig from './BulkCustomConfig.vue';
import type { BulkServerState } from '../../composables/useBulkSetup';
import type { Server } from '../../types';
import { getSinglePoolPreview, getSplitPoolPreview } from '../../../shared/bulkSetupRaid';

const props = defineProps<{
  server: BulkServerState;
  index: number;
  isRunning: boolean;
  isProbing: boolean;
  discoveredServers: Server[];
}>();

const emit = defineEmits<{
  remove: [index: number];
  retry: [host: string];
  connectAndProbe: [serverId: string];
}>();

const expanded = ref(!props.server.host); // Auto-expand new empty entries
const showSshPass = ref(false);
const showKeyPass = ref(false);
const showSmbPass = ref(false);
const showRootPass = ref(false);

async function browseSshKey() {
  const filePath = await window.electron?.ipcRenderer.invoke('dialog:openSshKey');
  if (filePath) {
    props.server.sshKeyPath = filePath;
  }
}

function onPickDiscovered(event: Event) {
  const val = (event.target as HTMLSelectElement).value;
  if (val) {
    props.server.host = val;
    // Auto-trigger connect & probe if credentials are filled
    if (props.server.password) {
      emit('connectAndProbe', props.server.id);
    }
  }
}

const progressPercent = computed(() => {
  if (!props.server.progress) return 0;
  const { step, totalSteps } = props.server.progress;
  if (step <= 0 || totalSteps <= 0) return 0;
  return Math.round((step / totalSteps) * 100);
});

const statusLabel = computed(() => {
  if (props.server.progress?.status === 'failed') return props.server.progress.error || 'Failed';
  if (props.server.progress?.status === 'done') return 'Setup complete';
  if (props.server.progress?.label) return props.server.progress.label;
  if (props.server.validated === false && !expanded.value) return 'Connection failed';
  return '';
});

const canRetry = computed(() => props.server.result && !props.server.result.success && !props.isRunning);

/** Whether setup has started (steps exist) — used to show checklist instead of form */
const hasStarted = computed(() => props.server.steps && props.server.steps.length > 0);

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

const statusDotClass = computed(() => {
  const status = props.server.progress?.status;
  if (status === 'done') return 'bg-green-500';
  if (status === 'failed') return 'bg-red-500';
  if (status === 'bootstrapping' || status === 'configuring') return 'bg-blue-500 animate-pulse';
  if (props.server.validated === false) return 'bg-red-400';
  if (props.server.validated === true) return 'bg-green-400';
  return 'bg-neutral-300 dark:bg-neutral-600';
});

const statusTextClass = computed(() => {
  const status = props.server.progress?.status;
  if (status === 'done') return 'text-green-600 dark:text-green-400';
  if (status === 'failed') return 'text-red-600 dark:text-red-400';
  if (status === 'bootstrapping' || status === 'configuring') return 'text-blue-600 dark:text-blue-400';
  if (props.server.validated === false) return 'text-red-500 dark:text-red-400';
  return 'text-neutral-500 dark:text-neutral-400';
});

const raidPreview = computed(() => {
  const disks = props.server.diskInfo?.availableDisks || [];
  return getSinglePoolPreview(disks);
});

const splitPreview = computed(() => {
  const disks = props.server.diskInfo?.availableDisks || [];
  return getSplitPoolPreview(disks);
});

/** Index where backup pool disks start (first half is storage, second half is backup) */
const splitHalf = computed(() => {
  const count = props.server.diskInfo?.availableDisks.length || 0;
  const spare = count % 2;
  return Math.floor((count - spare) / 2);
});

function diskBadgeClass(index: number): string {
  if (!props.server.splitPools) {
    return 'bg-neutral-100 dark:bg-neutral-700 text-default';
  }
  const half = splitHalf.value;
  if (index < half) {
    // Storage pool — blue
    return 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300';
  }
  if (index < half * 2) {
    // Backup pool — green
    return 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300';
  }
  // Spare (odd disk out) — neutral/amber
  return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
}

function diskTooltip(index: number): string {
  if (!props.server.splitPools) return '';
  const half = splitHalf.value;
  if (index < half) return 'Storage Pool (tank)';
  if (index < half * 2) return 'Backup Pool (tank-backup)';
  return 'Unassigned spare (odd disk count)';
}

const spareCount = computed(() => {
  if (!props.server.splitPools) return 0;
  const count = props.server.diskInfo?.availableDisks.length || 0;
  return count % 2;
});

const customErrorFields = ['customAdminUser', 'customAdminPass', 'customSmbUser', 'customSmbPass', 'customPoolName', 'customDisks'] as const;

const hasCustomErrors = computed(() => {
  if (!props.server.fieldErrors) return false;
  return customErrorFields.some(k => (props.server.fieldErrors as any)?.[k]);
});

const customErrorMessages = computed(() => {
  if (!props.server.fieldErrors) return [];
  const msgs = customErrorFields
    .map(k => (props.server.fieldErrors as any)?.[k])
    .filter(Boolean);
  return [...new Set(msgs)];
});

const borderClass = computed(() => {
  const status = props.server.progress?.status;
  if (status === 'done') return 'border-green-300 dark:border-green-700';
  if (status === 'failed') return 'border-red-300 dark:border-red-700';
  if (status === 'bootstrapping' || status === 'configuring') return 'border-blue-300 dark:border-blue-700';
  return 'border-neutral-200 dark:border-neutral-700';
});
</script>
