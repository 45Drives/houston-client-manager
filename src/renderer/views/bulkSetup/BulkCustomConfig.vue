<template>
  <div class="space-y-4">
    <!-- Wizard stepper -->
    <div class="flex items-center gap-0 border-b border-neutral-200 dark:border-neutral-700 pb-2">
      <template v-for="(tab, ti) in tabs" :key="tab.id">
        <button @click="activeTab = tab.id"
          class="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors"
          :class="activeTab === tab.id
            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
            : tabIndex > ti
              ? 'text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/10'
              : 'text-muted hover:text-default hover:bg-neutral-100 dark:hover:bg-neutral-800'">
          <span class="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
            :class="activeTab === tab.id
              ? 'bg-blue-500 text-white'
              : tabIndex > ti
                ? 'bg-green-500 text-white'
                : 'bg-neutral-300 dark:bg-neutral-600 text-neutral-600 dark:text-neutral-300'">
            <span v-if="tabIndex > ti">✓</span>
            <span v-else>{{ ti + 1 }}</span>
          </span>
          {{ tab.label }}
        </button>
        <span v-if="ti < tabs.length - 1" class="text-neutral-400 dark:text-neutral-500 text-xs mx-1">›</span>
      </template>
    </div>

    <!-- Server Info -->
    <div v-show="activeTab === 'server'" class="space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-xs font-medium text-muted mb-1 block">Server Name (hostname)</label>
          <input v-model="config.srvrName" type="text" placeholder="my-server"
            class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label class="text-xs font-medium text-muted mb-1 block">Timezone</label>
          <select v-model="serverConfig.timezone" class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm">
            <option value="">Auto-detect</option>
            <option v-for="tz in commonTimezones" :key="tz" :value="tz">{{ tz }}</option>
          </select>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-xs font-medium text-muted mb-1 block">Admin Username</label>
          <input v-model="serverConfig.adminUser" type="text" placeholder="admin"
            class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label class="text-xs font-medium text-muted mb-1 block">Admin Password</label>
          <div class="relative">
            <input v-model="serverConfig.adminPass" :type="showAdminPass ? 'text' : 'password'" placeholder="••••••••"
              class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm pr-8" />
            <button type="button" @click="showAdminPass = !showAdminPass"
              class="absolute right-2 top-1/2 -translate-y-1/2 text-muted">
              <EyeIcon v-if="!showAdminPass" class="w-4 h-4" />
              <EyeSlashIcon v-if="showAdminPass" class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      <div class="flex flex-wrap gap-4">
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" v-model="serverConfig.disableRootSSH"
            class="rounded border-neutral-400 dark:border-neutral-500" />
          <span class="text-xs font-medium text-muted">Disable root SSH</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" v-model="serverConfig.useNTP"
            class="rounded border-neutral-400 dark:border-neutral-500" />
          <span class="text-xs font-medium text-muted">Enable NTP sync</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" v-model="serverConfig.setTimezone"
            class="rounded border-neutral-400 dark:border-neutral-500" />
          <span class="text-xs font-medium text-muted">Set timezone</span>
        </label>
      </div>
      <div v-if="!serverConfig.disableRootSSH" class="max-w-xs">
        <label class="text-xs font-medium text-muted mb-1 block">New Root Password (optional)</label>
        <div class="relative">
          <input v-model="serverConfig.newRootPass" :type="showRootPass ? 'text' : 'password'" placeholder="Leave empty to keep current"
            class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm pr-8" />
          <button type="button" @click="showRootPass = !showRootPass"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-muted">
            <EyeIcon v-if="!showRootPass" class="w-4 h-4" />
            <EyeSlashIcon v-if="showRootPass" class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- ZFS Configuration -->
    <div v-show="activeTab === 'zfs'" class="space-y-4">
      <!-- Drive selection -->
      <div v-if="availableDisks.length > 0" class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="text-xs font-medium text-muted">Select Drives for Storage Pool</label>
          <div class="flex items-center gap-2">
            <button @click="selectAllDisks('storage')" class="text-xs text-blue-600 dark:text-blue-400 hover:underline">
              Select All
            </button>
            <button @click="clearDiskSelection('storage')" class="text-xs text-muted hover:underline">
              Clear
            </button>
          </div>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <button v-for="disk in availableDisks" :key="disk.name"
            @click="toggleDisk(disk, 'storage')"
            class="px-2 py-1 rounded text-xs font-mono transition-colors"
            :class="isSelectedFor(disk, 'storage')
              ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 ring-1 ring-blue-400'
              : isSelectedFor(disk, 'backup')
                ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 opacity-50 cursor-not-allowed'
                : 'bg-neutral-100 dark:bg-neutral-700 text-default hover:bg-neutral-200 dark:hover:bg-neutral-600'">
            {{ disk.alias || disk.name }} ({{ disk.size }})
          </button>
        </div>
      </div>

      <!-- Storage pool config -->
      <div class="rounded-lg border border-neutral-200 dark:border-neutral-700 p-3 space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-default">Storage Pool</span>
          <span class="text-xs text-muted">{{ selectedStorageDisks.length }} disk(s) selected</span>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="text-xs font-medium text-muted mb-1 block">Pool Name</label>
            <input v-model="storagePool.name" type="text" placeholder="tank"
              class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label class="text-xs font-medium text-muted mb-1 block">RAID Level</label>
            <select v-model="storagePool.raidLevel" class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm">
              <option value="auto">Auto (best practice)</option>
              <option value="disk">Disk (no redundancy)</option>
              <option value="mirror">Mirror</option>
              <option value="raidz1">RAIDZ1</option>
              <option value="raidz2">RAIDZ2</option>
              <option value="raidz3">RAIDZ3</option>
            </select>
          </div>
          <div>
            <label class="text-xs font-medium text-muted mb-1 block">Dataset Name</label>
            <input v-model="storagePool.datasetName" type="text" placeholder="share"
              class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm" />
          </div>
        </div>

        <!-- Pool options -->
        <details class="text-xs">
          <summary class="text-muted cursor-pointer hover:text-default font-medium">Pool & Dataset Options</summary>
          <div class="mt-2 grid grid-cols-3 gap-3">
            <div>
              <label class="text-xs text-muted mb-1 block">Compression</label>
              <select v-model="storagePool.poolOptions.compression" class="w-full input-textlike rounded-lg px-2 py-1 text-xs">
                <option value="lz4">LZ4 (default)</option>
                <option value="zstd">ZSTD</option>
                <option value="gzip">GZIP</option>
                <option value="off">Off</option>
              </select>
            </div>
            <div>
              <label class="text-xs text-muted mb-1 block">Record Size</label>
              <select v-model="storagePool.poolOptions.recordsize" class="w-full input-textlike rounded-lg px-2 py-1 text-xs">
                <option :value="128">128K (default)</option>
                <option :value="64">64K</option>
                <option :value="32">32K</option>
                <option :value="16">16K</option>
                <option :value="1024">1M</option>
              </select>
            </div>
            <div>
              <label class="text-xs text-muted mb-1 block">Dedup</label>
              <select v-model="storagePool.poolOptions.dedup" class="w-full input-textlike rounded-lg px-2 py-1 text-xs">
                <option value="off">Off (default)</option>
                <option value="on">On</option>
                <option value="verify">Verify</option>
              </select>
            </div>
            <label class="flex items-center gap-2 cursor-pointer col-span-3">
              <input type="checkbox" v-model="storagePool.poolOptions.autotrim"
                :true-value="'on'" :false-value="'off'"
                class="rounded border-neutral-400 dark:border-neutral-500 text-xs" />
              <span class="text-xs text-muted">Auto-trim (SSD)</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer col-span-3">
              <input type="checkbox" v-model="storagePool.poolOptions.autoexpand"
                :true-value="'on'" :false-value="'off'"
                class="rounded border-neutral-400 dark:border-neutral-500 text-xs" />
              <span class="text-xs text-muted">Auto-expand</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer col-span-3">
              <input type="checkbox" v-model="storagePool.poolOptions.autoreplace"
                :true-value="'on'" :false-value="'off'"
                class="rounded border-neutral-400 dark:border-neutral-500 text-xs" />
              <span class="text-xs text-muted">Auto-replace</span>
            </label>
          </div>
          <div class="mt-3 grid grid-cols-3 gap-3">
            <div>
              <label class="text-xs text-muted mb-1 block">Dataset Compression</label>
              <select v-model="storagePool.datasetOptions.compression" class="w-full input-textlike rounded-lg px-2 py-1 text-xs">
                <option value="lz4">LZ4</option>
                <option value="zstd">ZSTD</option>
                <option value="gzip">GZIP</option>
                <option value="off">Off</option>
                <option value="inherit">Inherit from pool</option>
              </select>
            </div>
            <div>
              <label class="text-xs text-muted mb-1 block">Access Time</label>
              <select v-model="storagePool.datasetOptions.atime" class="w-full input-textlike rounded-lg px-2 py-1 text-xs">
                <option value="off">Off (better performance)</option>
                <option value="on">On</option>
              </select>
            </div>
            <div>
              <label class="text-xs text-muted mb-1 block">Case Sensitivity</label>
              <select v-model="storagePool.datasetOptions.casesensitivity" class="w-full input-textlike rounded-lg px-2 py-1 text-xs">
                <option value="sensitive">Sensitive (default)</option>
                <option value="insensitive">Insensitive</option>
                <option value="mixed">Mixed</option>
              </select>
            </div>
          </div>
        </details>

        <!-- Additional datasets -->
        <details class="text-xs">
          <summary class="text-muted cursor-pointer hover:text-default font-medium">
            Additional Datasets ({{ storagePool.additionalDatasets.length }})
          </summary>
          <div class="mt-2 space-y-2">
            <div v-for="(ds, idx) in storagePool.additionalDatasets" :key="idx"
              class="flex items-center gap-2 p-2 bg-neutral-50 dark:bg-neutral-800/50 rounded">
              <input v-model="ds.name" type="text" placeholder="dataset-name"
                class="input-textlike rounded px-2 py-1 text-xs flex-1" />
              <select v-model="ds.compression" class="input-textlike rounded px-2 py-1 text-xs w-24">
                <option value="inherit">Inherit</option>
                <option value="lz4">LZ4</option>
                <option value="zstd">ZSTD</option>
                <option value="off">Off</option>
              </select>
              <button @click="storagePool.additionalDatasets.splice(idx, 1)"
                class="text-red-500 hover:text-red-600 px-1">✕</button>
            </div>
            <button @click="storagePool.additionalDatasets.push({ name: '', compression: 'inherit', atime: 'off', casesensitivity: 'sensitive' })"
              class="text-xs text-blue-600 dark:text-blue-400 hover:underline">
              + Add Dataset
            </button>
          </div>
        </details>
      </div>

      <!-- Backup pool toggle and config -->
      <div class="space-y-3">
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" v-model="enableBackupPool"
            :disabled="availableDisks.length <= 4 && selectedStorageDisks.length === availableDisks.length"
            class="rounded border-neutral-400 dark:border-neutral-500 text-green-500" />
          <span class="text-xs font-medium" :class="enableBackupPool ? 'text-green-600 dark:text-green-400' : 'text-muted'">
            Enable Backup Pool
          </span>
          <span v-if="availableDisks.length <= 4 && !enableBackupPool" class="text-xs text-muted">(needs more available disks)</span>
        </label>

        <template v-if="enableBackupPool">
          <!-- Backup drive selection -->
          <div v-if="unselectedDisks.length > 0 || selectedBackupDisks.length > 0" class="space-y-2">
            <div class="flex items-center justify-between">
              <label class="text-xs font-medium text-muted">Select Drives for Backup Pool</label>
              <div class="flex items-center gap-2">
                <button @click="selectAllDisks('backup')" class="text-xs text-green-600 dark:text-green-400 hover:underline">
                  Select Remaining
                </button>
                <button @click="clearDiskSelection('backup')" class="text-xs text-muted hover:underline">
                  Clear
                </button>
              </div>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="disk in availableDisks" :key="'backup-' + disk.name"
                @click="toggleDisk(disk, 'backup')"
                :disabled="isSelectedFor(disk, 'storage')"
                class="px-2 py-1 rounded text-xs font-mono transition-colors"
                :class="isSelectedFor(disk, 'backup')
                  ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 ring-1 ring-green-400'
                  : isSelectedFor(disk, 'storage')
                    ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 opacity-50 cursor-not-allowed'
                    : 'bg-neutral-100 dark:bg-neutral-700 text-default hover:bg-neutral-200 dark:hover:bg-neutral-600'">
                {{ disk.alias || disk.name }} ({{ disk.size }})
              </button>
            </div>
          </div>

          <!-- Backup pool config -->
          <div class="rounded-lg border border-green-200 dark:border-green-800 p-3 space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-green-700 dark:text-green-400">Backup Pool</span>
              <div class="flex items-center gap-2">
                <span class="text-xs text-muted">{{ selectedBackupDisks.length }} disk(s)</span>
                <button @click="copyStorageOptions()" class="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                  Copy from Storage
                </button>
              </div>
            </div>
            <div class="grid grid-cols-3 gap-3">
              <div>
                <label class="text-xs font-medium text-muted mb-1 block">Pool Name</label>
                <input v-model="backupPool.name" type="text" placeholder="tank-backup"
                  class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label class="text-xs font-medium text-muted mb-1 block">RAID Level</label>
                <select v-model="backupPool.raidLevel" class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm">
                  <option value="auto">Auto (best practice)</option>
                  <option value="disk">Disk (no redundancy)</option>
                  <option value="mirror">Mirror</option>
                  <option value="raidz1">RAIDZ1</option>
                  <option value="raidz2">RAIDZ2</option>
                  <option value="raidz3">RAIDZ3</option>
                </select>
              </div>
              <div>
                <label class="text-xs font-medium text-muted mb-1 block">Dataset Name</label>
                <input v-model="backupPool.datasetName" type="text" placeholder="backup"
                  class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm" />
              </div>
            </div>

            <details class="text-xs">
              <summary class="text-muted cursor-pointer hover:text-default font-medium">Pool & Dataset Options</summary>
              <div class="mt-2 grid grid-cols-3 gap-3">
                <div>
                  <label class="text-xs text-muted mb-1 block">Compression</label>
                  <select v-model="backupPool.poolOptions.compression" class="w-full input-textlike rounded-lg px-2 py-1 text-xs">
                    <option value="lz4">LZ4</option>
                    <option value="zstd">ZSTD</option>
                    <option value="gzip">GZIP</option>
                    <option value="off">Off</option>
                  </select>
                </div>
                <div>
                  <label class="text-xs text-muted mb-1 block">Record Size</label>
                  <select v-model="backupPool.poolOptions.recordsize" class="w-full input-textlike rounded-lg px-2 py-1 text-xs">
                    <option :value="128">128K</option>
                    <option :value="64">64K</option>
                    <option :value="32">32K</option>
                    <option :value="1024">1M</option>
                  </select>
                </div>
                <div>
                  <label class="text-xs text-muted mb-1 block">Dedup</label>
                  <select v-model="backupPool.poolOptions.dedup" class="w-full input-textlike rounded-lg px-2 py-1 text-xs">
                    <option value="off">Off</option>
                    <option value="on">On</option>
                  </select>
                </div>
              </div>
            </details>
          </div>
        </template>
      </div>

      <!-- ZFS validation error -->
      <p v-if="zfsError" class="text-xs text-red-500 dark:text-red-400 font-medium text-center">{{ zfsError }}</p>
    </div>

    <!-- Users & Groups -->
    <div v-show="activeTab === 'users'" class="space-y-4 text-left">
      <!-- New Groups -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="text-xs font-semibold text-default">New Groups</label>
          <button @click="addGroup()" class="text-xs text-blue-600 dark:text-blue-400 hover:underline">+ Add Group</button>
        </div>
        <div v-for="(group, gi) in groups" :key="gi"
          class="flex items-center gap-2 p-2 bg-neutral-50 dark:bg-neutral-800/50 rounded">
          <input v-model="group.name" type="text" placeholder="group-name"
            class="input-textlike rounded px-2 py-1 text-xs flex-1 max-w-[200px]" />
          <span class="text-xs text-muted flex-1 truncate">{{ (group.members || []).join(', ') || 'no members' }}</span>
          <button @click="groups.splice(gi, 1)" class="text-red-500 hover:text-red-600 px-1 text-xs">✕</button>
        </div>
        <p v-if="groups.length === 0" class="text-xs text-muted text-left">No custom groups added.</p>
      </div>

      <!-- Existing Groups (from server) -->
      <div v-if="existingGroupNames.length > 0" class="space-y-2 text-left">
        <label class="text-xs font-semibold text-default block">Existing Groups <span class="font-normal text-muted">(on server)</span></label>
        <div class="flex flex-wrap gap-1.5">
          <span v-for="g in existingGroupNames" :key="g"
            class="inline-flex items-center px-2 py-0.5 rounded text-xs bg-neutral-100 dark:bg-neutral-700/60 text-muted">
            {{ g }}
          </span>
        </div>
        <p class="text-xs text-muted text-left">Existing groups can be assigned to new users below.</p>
      </div>

      <!-- Users -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="text-xs font-semibold text-default">Users</label>
          <button @click="addUser()" class="text-xs text-blue-600 dark:text-blue-400 hover:underline">+ Add User</button>
        </div>
        <div v-for="(user, ui) in users" :key="ui"
          class="p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded space-y-2">
          <div class="flex items-center gap-2">
            <input v-model="user.username" type="text" placeholder="username"
              class="input-textlike rounded px-2 py-1 text-xs flex-1 max-w-[180px]" />
            <div class="relative flex-1 max-w-[180px]">
              <input v-model="user.password" :type="showUserPass[ui] ? 'text' : 'password'" placeholder="password"
                class="w-full input-textlike rounded px-2 py-1 text-xs pr-8" />
              <button type="button" @click="showUserPass[ui] = !showUserPass[ui]"
                class="absolute right-2 top-1/2 -translate-y-1/2 text-muted">
                <EyeIcon v-if="!showUserPass[ui]" class="w-3.5 h-3.5" />
                <EyeSlashIcon v-if="showUserPass[ui]" class="w-3.5 h-3.5" />
              </button>
            </div>
            <button @click="users.splice(ui, 1)" class="text-red-500 hover:text-red-600 px-1 text-xs">✕</button>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs text-muted">Groups:</span>
            <label v-for="g in allGroupNames" :key="g" class="flex items-center gap-1">
              <input type="checkbox" :checked="user.groups.includes(g)"
                @change="toggleUserGroup(user, g)"
                class="rounded border-neutral-400 dark:border-neutral-500 w-3 h-3" />
              <span class="text-xs" :class="isExistingGroup(g) ? 'text-muted italic' : 'text-muted'">{{ g }}</span>
            </label>
          </div>
          <div>
            <input v-model="user.sshKey" type="text" placeholder="SSH public key (optional)"
              class="w-full input-textlike rounded px-2 py-1 text-xs font-mono" />
          </div>
        </div>
        <p v-if="users.length === 0" class="text-xs text-muted text-left">No additional users. The admin user is configured in Server Info.</p>
      </div>
    </div>

    <!-- Samba Configuration -->
    <div v-show="activeTab === 'samba'" class="space-y-4 text-left">
      <!-- Global settings -->
      <div class="rounded-lg border border-neutral-200 dark:border-neutral-700 p-3 space-y-3">
        <span class="text-xs font-semibold text-default block">Global Settings</span>
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="text-xs font-medium text-muted mb-1 block">Workgroup</label>
            <input v-model="sambaGlobal.workgroup" type="text" placeholder="WORKGROUP"
              class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label class="text-xs font-medium text-muted mb-1 block">Server String</label>
            <input v-model="sambaGlobal.serverString" type="text" placeholder="Samba %v"
              class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label class="text-xs font-medium text-muted mb-1 block">Log Level</label>
            <select v-model.number="sambaGlobal.logLevel" class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm">
              <option :value="0">0 (None)</option>
              <option :value="1">1 (Minimal)</option>
              <option :value="2">2 (Normal)</option>
              <option :value="3">3 (Debug)</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Shares -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="text-xs font-semibold text-default">Shares</label>
          <button @click="addShare()" class="text-xs text-blue-600 dark:text-blue-400 hover:underline">+ Add Share</button>
        </div>
        <div v-for="(share, si) in sambaShares" :key="si"
          class="p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded space-y-2">
          <div class="flex items-center gap-2">
            <input v-model="share.name" type="text" placeholder="share-name"
              class="input-textlike rounded px-2 py-1 text-xs flex-1 max-w-[180px]" />
            <input v-model="share.path" type="text" :placeholder="defaultSharePath(share)"
              class="input-textlike rounded px-2 py-1 text-xs flex-1 font-mono" />
            <button v-if="si > 0" @click="sambaShares.splice(si, 1)"
              class="text-red-500 hover:text-red-600 px-1 text-xs">✕</button>
          </div>
          <div class="flex flex-wrap gap-4">
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" v-model="share.guestOk" class="rounded border-neutral-400 dark:border-neutral-500 w-3 h-3" />
              <span class="text-xs text-muted">Guest access</span>
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" v-model="share.readOnly" class="rounded border-neutral-400 dark:border-neutral-500 w-3 h-3" />
              <span class="text-xs text-muted">Read-only</span>
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" v-model="share.browseable" class="rounded border-neutral-400 dark:border-neutral-500 w-3 h-3" />
              <span class="text-xs text-muted">Browseable</span>
            </label>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" v-model="share.inheritPermissions" class="rounded border-neutral-400 dark:border-neutral-500 w-3 h-3" />
              <span class="text-xs text-muted">Inherit permissions</span>
            </label>
          </div>
          <div>
            <input v-model="share.description" type="text" placeholder="Description (optional)"
              class="w-full input-textlike rounded px-2 py-1 text-xs" />
          </div>
        </div>
      </div>

      <!-- SMB credentials -->
      <div class="rounded-lg border border-neutral-200 dark:border-neutral-700 p-3 space-y-3 text-left">
        <span class="text-xs font-semibold text-default block">SMB Credentials</span>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-medium text-muted mb-1 block">SMB User</label>
            <select @change="onSmbUserChange(($event.target as HTMLSelectElement).value)"
              :value="config.smbUser"
              class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm">
              <option value="">— Select user —</option>
              <optgroup v-if="allSmbUserOptions.filter(o => o.source === 'admin').length" label="Admin User">
                <option v-for="o in allSmbUserOptions.filter(o => o.source === 'admin')" :key="o.value" :value="o.value">{{ o.label }}</option>
              </optgroup>
              <optgroup v-if="allSmbUserOptions.filter(o => o.source === 'new').length" label="New Users">
                <option v-for="o in allSmbUserOptions.filter(o => o.source === 'new')" :key="o.value" :value="o.value">{{ o.label }}</option>
              </optgroup>
              <optgroup v-if="allSmbUserOptions.filter(o => o.source === 'existing').length" label="Existing Users (on server)">
                <option v-for="o in allSmbUserOptions.filter(o => o.source === 'existing')" :key="o.value" :value="o.value">{{ o.label }}</option>
              </optgroup>
            </select>
          </div>
          <div class="space-y-2">
            <template v-if="useExistingPassword && (props.existingUsers || []).includes(config.smbUser)">
              <p class="text-xs text-muted mt-1">This is an existing user on the server. Set a new SMB password or leave blank to keep the current one.</p>
            </template>
            <div>
              <label class="text-xs font-medium text-muted mb-1 block">SMB Password</label>
              <div class="relative">
                <input v-model="config.smbPass" :type="showSmbPass ? 'text' : 'password'"
                  :placeholder="useExistingPassword ? '(leave blank to keep current)' : '••••••••'"
                  class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm pr-8" />
                <button type="button" @click="showSmbPass = !showSmbPass"
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-muted">
                  <EyeIcon v-if="!showSmbPass" class="w-4 h-4" />
                  <EyeSlashIcon v-if="showSmbPass" class="w-4 h-4" />
                </button>
              </div>
            </div>
            <div v-if="config.smbPass">
              <label class="text-xs font-medium text-muted mb-1 block">Confirm SMB Password</label>
              <div class="relative">
                <input v-model="smbPassConfirm" :type="showSmbPass ? 'text' : 'password'" placeholder="••••••••"
                  class="w-full input-textlike rounded-lg px-3 py-1.5 text-sm pr-8"
                  :class="smbPassConfirm && smbPassConfirm !== config.smbPass ? 'border-red-400 dark:border-red-600' : ''" />
                <button type="button" @click="showSmbPass = !showSmbPass"
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-muted">
                  <EyeIcon v-if="!showSmbPass" class="w-4 h-4" />
                  <EyeSlashIcon v-if="showSmbPass" class="w-4 h-4" />
                </button>
              </div>
              <span v-if="smbPassConfirm && smbPassConfirm !== config.smbPass" class="text-xs text-red-500 dark:text-red-400 mt-0.5 block">Passwords do not match</span>
              <span v-else-if="smbPassConfirm && smbPassConfirm === config.smbPass" class="text-xs text-green-600 dark:text-green-400 mt-0.5 block">✓ Passwords match</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Wizard navigation -->
    <div class="flex items-center justify-between pt-2 border-t border-neutral-200 dark:border-neutral-700">
      <button v-if="tabIndex > 0" @click="prevTab"
        class="btn btn-secondary h-fit px-3 py-1.5 text-xs font-medium">
        ← {{ tabs[tabIndex - 1].label }}
      </button>
      <div v-else />
      <button v-if="tabIndex < tabs.length - 1" @click="nextTab"
        class="btn btn-primary h-fit px-3 py-1.5 text-xs font-medium">
        {{ tabs[tabIndex + 1].label }} →
      </button>
      <span v-else class="text-xs text-green-600 dark:text-green-400 font-medium">✓ Configuration complete</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { EyeIcon, EyeSlashIcon } from '@heroicons/vue/20/solid';
import type {
  BulkEasySetupConfig,
  BulkServerConfig,
  BulkDisk,
  BulkDiskInfo,
  BulkPoolOptions,
  BulkDatasetOptions,
  BulkZFSConfig,
  BulkSambaShareConfig,
  BulkSambaGlobalConfig,
  BulkUserSpec,
  BulkGroupSpec,
  BulkVDevType,
} from '../../../shared/bulkSetupTypes';

const props = defineProps<{
  modelValue: BulkEasySetupConfig;
  diskInfo?: BulkDiskInfo;
  existingGroups?: string[];
  existingUsers?: string[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: BulkEasySetupConfig];
}>();

const tabs = [
  { id: 'server', label: 'Server Info' },
  { id: 'zfs', label: 'ZFS Storage' },
  { id: 'users', label: 'Users & Groups' },
  { id: 'samba', label: 'Samba' },
] as const;

type TabId = typeof tabs[number]['id'];
const activeTab = ref<TabId>('server');

const tabIndex = computed(() => tabs.findIndex(t => t.id === activeTab.value));

const zfsError = ref('');

function validateRaidVsDiskCount(raidLevel: string, diskCount: number, poolLabel: string): string | undefined {
  if (raidLevel === 'auto' || raidLevel === 'disk') return undefined;
  if (raidLevel === 'mirror' && diskCount < 2) return `${poolLabel}: Mirror requires at least 2 disks (${diskCount} selected)`;
  if (raidLevel === 'raidz1' && diskCount < 3) return `${poolLabel}: RAIDZ1 requires at least 3 disks (${diskCount} selected)`;
  if (raidLevel === 'raidz2' && diskCount < 4) return `${poolLabel}: RAIDZ2 requires at least 4 disks (${diskCount} selected)`;
  if (raidLevel === 'raidz3' && diskCount < 5) return `${poolLabel}: RAIDZ3 requires at least 5 disks (${diskCount} selected)`;
  return undefined;
}

function nextTab() {
  const idx = tabIndex.value;

  // Validate ZFS before leaving that tab
  if (activeTab.value === 'zfs') {
    zfsError.value = '';
    if (selectedStorageDisks.value.length === 0) {
      zfsError.value = 'Select at least one disk for the storage pool';
      return;
    }
    const storageErr = validateRaidVsDiskCount(storagePool.raidLevel, selectedStorageDisks.value.length, 'Storage pool');
    if (storageErr) { zfsError.value = storageErr; return; }
    if (enableBackupPool.value) {
      if (selectedBackupDisks.value.length === 0) {
        zfsError.value = 'Select at least one disk for the backup pool';
        return;
      }
      const backupErr = validateRaidVsDiskCount(backupPool.raidLevel, selectedBackupDisks.value.length, 'Backup pool');
      if (backupErr) { zfsError.value = backupErr; return; }
    }
  }

  if (idx < tabs.length - 1) {
    activeTab.value = tabs[idx + 1].id;
  }
}

function prevTab() {
  const idx = tabIndex.value;
  if (idx > 0) {
    activeTab.value = tabs[idx - 1].id;
  }
}

// Password visibility toggles
const showAdminPass = ref(false);
const showRootPass = ref(false);
const showUserPass = ref<Record<number, boolean>>({});
const showSmbPass = ref(false);
const smbPassConfirm = ref('');

// ── Reactive config state ──────────────────────────────────────────────

const config = reactive<BulkEasySetupConfig>({
  srvrName: '',
  smbUser: '',
  smbPass: '',
  ...props.modelValue,
});

const serverConfig = reactive<BulkServerConfig>({
  adminUser: '',
  adminPass: '',
  disableRootSSH: true,
  useNTP: true,
  setTimezone: false,
  timezone: '',
  newRootPass: '',
  ...props.modelValue?.serverConfig,
});

// ── ZFS state ──────────────────────────────────────────────────────────

interface PoolConfigState {
  name: string;
  raidLevel: 'auto' | BulkVDevType;
  datasetName: string;
  poolOptions: BulkPoolOptions;
  datasetOptions: BulkDatasetOptions;
  additionalDatasets: Array<{ name: string; compression: string; atime: string; casesensitivity: string }>;
}

const storagePool = reactive<PoolConfigState>({
  name: 'tank',
  raidLevel: 'auto',
  datasetName: 'share',
  poolOptions: {
    compression: 'lz4',
    recordsize: 128,
    dedup: 'off',
    autotrim: 'off',
    autoexpand: 'on',
    autoreplace: 'on',
  },
  datasetOptions: {
    compression: 'lz4',
    atime: 'off',
    casesensitivity: 'sensitive',
  },
  additionalDatasets: [],
});

const backupPool = reactive<PoolConfigState>({
  name: 'tank-backup',
  raidLevel: 'auto',
  datasetName: 'backup',
  poolOptions: {
    compression: 'lz4',
    recordsize: 128,
    dedup: 'off',
    autotrim: 'off',
    autoexpand: 'on',
    autoreplace: 'on',
  },
  datasetOptions: {
    compression: 'lz4',
    atime: 'off',
    casesensitivity: 'sensitive',
  },
  additionalDatasets: [],
});

const enableBackupPool = ref(false);

// Disk selections
const selectedStorageDiskNames = ref<Set<string>>(new Set());
const selectedBackupDiskNames = ref<Set<string>>(new Set());

const availableDisks = computed<BulkDisk[]>(() => props.diskInfo?.availableDisks || []);

const selectedStorageDisks = computed(() =>
  availableDisks.value.filter(d => selectedStorageDiskNames.value.has(d.name))
);

const selectedBackupDisks = computed(() =>
  availableDisks.value.filter(d => selectedBackupDiskNames.value.has(d.name))
);

const unselectedDisks = computed(() =>
  availableDisks.value.filter(d => !selectedStorageDiskNames.value.has(d.name) && !selectedBackupDiskNames.value.has(d.name))
);

function isSelectedFor(disk: BulkDisk, pool: 'storage' | 'backup'): boolean {
  if (pool === 'storage') return selectedStorageDiskNames.value.has(disk.name);
  return selectedBackupDiskNames.value.has(disk.name);
}

function toggleDisk(disk: BulkDisk, pool: 'storage' | 'backup') {
  zfsError.value = '';
  const targetSet = pool === 'storage' ? selectedStorageDiskNames.value : selectedBackupDiskNames.value;
  const otherSet = pool === 'storage' ? selectedBackupDiskNames.value : selectedStorageDiskNames.value;

  if (otherSet.has(disk.name)) return; // already in the other pool

  if (targetSet.has(disk.name)) {
    targetSet.delete(disk.name);
  } else {
    targetSet.add(disk.name);
  }
}

function selectAllDisks(pool: 'storage' | 'backup') {
  const targetSet = pool === 'storage' ? selectedStorageDiskNames.value : selectedBackupDiskNames.value;
  const otherSet = pool === 'storage' ? selectedBackupDiskNames.value : selectedStorageDiskNames.value;
  for (const disk of availableDisks.value) {
    if (!otherSet.has(disk.name)) {
      targetSet.add(disk.name);
    }
  }
}

function clearDiskSelection(pool: 'storage' | 'backup') {
  if (pool === 'storage') {
    selectedStorageDiskNames.value.clear();
  } else {
    selectedBackupDiskNames.value.clear();
  }
}

function copyStorageOptions() {
  backupPool.poolOptions = { ...storagePool.poolOptions };
  backupPool.datasetOptions = { ...storagePool.datasetOptions };
  backupPool.raidLevel = storagePool.raidLevel;
}

// ── Users & Groups state ───────────────────────────────────────────────

const users = reactive<BulkUserSpec[]>(props.modelValue?.usersAndGroups?.users || []);
const groups = reactive<BulkGroupSpec[]>(props.modelValue?.usersAndGroups?.groups || []);

const allGroupNames = computed(() => {
  const wizardGroups = groups.map(g => g.name).filter(Boolean);
  const seen = new Set(wizardGroups);
  seen.add('smbusers'); // always available
  const existing = (props.existingGroups || []).filter(g => !seen.has(g));
  return [...seen, ...existing];
});

const existingGroupNames = computed(() => {
  const wizardGroupSet = new Set(groups.map(g => g.name).filter(Boolean));
  wizardGroupSet.add('smbusers');
  return (props.existingGroups || []).filter(g => !wizardGroupSet.has(g));
});

function isExistingGroup(name: string): boolean {
  return (props.existingGroups || []).includes(name) && !groups.some(g => g.name === name) && name !== 'smbusers';
}

function addUser() {
  users.push({ username: '', password: '', groups: ['smbusers'], sshKey: '' });
}

function addGroup() {
  groups.push({ name: '', members: [] });
}

function toggleUserGroup(user: BulkUserSpec, group: string) {
  const idx = user.groups.indexOf(group);
  if (idx >= 0) {
    user.groups.splice(idx, 1);
  } else {
    user.groups.push(group);
  }
}

// ── Samba state ────────────────────────────────────────────────────────

// All available usernames for SMB user selection
const allSmbUserOptions = computed(() => {
  const opts: Array<{ value: string; label: string; source: string }> = [];
  const seen = new Set<string>();

  // Admin user from Server Info tab
  if (serverConfig.adminUser && !seen.has(serverConfig.adminUser)) {
    seen.add(serverConfig.adminUser);
    opts.push({ value: serverConfig.adminUser, label: serverConfig.adminUser, source: 'admin' });
  }

  // New users from Users & Groups tab
  for (const u of users) {
    if (u.username && !seen.has(u.username)) {
      seen.add(u.username);
      opts.push({ value: u.username, label: u.username, source: 'new' });
    }
  }

  // Existing users on server
  for (const u of (props.existingUsers || [])) {
    if (!seen.has(u)) {
      seen.add(u);
      opts.push({ value: u, label: u, source: 'existing' });
    }
  }

  return opts;
});

const useExistingPassword = ref(false);

// When SMB user selection changes, auto-fill password from new users if available
function onSmbUserChange(username: string) {
  config.smbUser = username;
  const newUser = users.find(u => u.username === username);
  if (newUser) {
    useExistingPassword.value = false;
    config.smbPass = newUser.password;
    smbPassConfirm.value = newUser.password;
  } else if ((props.existingUsers || []).includes(username)) {
    // Existing server user — offer "use existing password" option
    useExistingPassword.value = true;
    config.smbPass = '';
    smbPassConfirm.value = '';
  } else {
    useExistingPassword.value = false;
    config.smbPass = '';
    smbPassConfirm.value = '';
  }
}

const sambaGlobal = reactive<BulkSambaGlobalConfig>({
  logLevel: 0,
  workgroup: 'WORKGROUP',
  serverString: 'Samba %v',
  ...props.modelValue?.sambaConfig?.global,
});

const sambaShares = reactive<BulkSambaShareConfig[]>(
  props.modelValue?.sambaConfig?.shares?.length
    ? props.modelValue.sambaConfig.shares
    : [{
        name: 'share',
        description: '',
        path: '',
        guestOk: false,
        readOnly: false,
        browseable: true,
        inheritPermissions: false,
      }]
);

function addShare() {
  sambaShares.push({
    name: '',
    description: '',
    path: '',
    guestOk: false,
    readOnly: false,
    browseable: true,
    inheritPermissions: false,
  });
}

function defaultSharePath(share: BulkSambaShareConfig): string {
  const poolName = storagePool.name || 'tank';
  const dsName = share.name || 'share';
  return `/${poolName}/${dsName}`;
}

// ── Timezone data ──────────────────────────────────────────────────────

const commonTimezones = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Toronto', 'America/Halifax', 'America/Vancouver',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Amsterdam',
  'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Kolkata',
  'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland',
  'UTC',
];

// ── Auto-select disks on mount if disk info available ──────────────────

onMounted(() => {
  if (availableDisks.value.length > 0 && selectedStorageDiskNames.value.size === 0) {
    // Auto-select all disks for storage by default
    for (const disk of availableDisks.value) {
      selectedStorageDiskNames.value.add(disk.name);
    }
  }

  // Hydrate from existing customConfig if re-opening
  if (props.modelValue?.zfsConfigs?.length) {
    hydrateFromConfig(props.modelValue);
  }
});

function hydrateFromConfig(cfg: BulkEasySetupConfig) {
  if (cfg.zfsConfigs && cfg.zfsConfigs.length > 0) {
    const storageCfg = cfg.zfsConfigs[0];
    storagePool.name = storageCfg.pool.name;
    storagePool.datasetName = storageCfg.dataset.name;
    Object.assign(storagePool.poolOptions, storageCfg.poolOptions);
    Object.assign(storagePool.datasetOptions, storageCfg.datasetOptions);
    if (storageCfg.additionalDatasets) {
      storagePool.additionalDatasets = storageCfg.additionalDatasets.map(d => ({
        name: d.dataset.name,
        compression: d.datasetOptions.compression || 'inherit',
        atime: d.datasetOptions.atime || 'off',
        casesensitivity: d.datasetOptions.casesensitivity || 'sensitive',
      }));
    }
    // Reconstruct disk selections from vdevs
    if (storageCfg.pool.vdevs.length > 0) {
      selectedStorageDiskNames.value.clear();
      for (const vdev of storageCfg.pool.vdevs) {
        for (const disk of vdev.disks) {
          const match = availableDisks.value.find(d =>
            d.name === disk.name || d.alias === disk.alias
          );
          if (match) selectedStorageDiskNames.value.add(match.name);
        }
      }
      // Detect RAID level from vdev type
      const vdevType = storageCfg.pool.vdevs[0].type;
      if (['mirror', 'raidz1', 'raidz2', 'raidz3', 'disk'].includes(vdevType)) {
        storagePool.raidLevel = vdevType as any;
      }
    }

    if (cfg.zfsConfigs.length > 1) {
      enableBackupPool.value = true;
      const backupCfg = cfg.zfsConfigs[1];
      backupPool.name = backupCfg.pool.name;
      backupPool.datasetName = backupCfg.dataset.name;
      Object.assign(backupPool.poolOptions, backupCfg.poolOptions);
      Object.assign(backupPool.datasetOptions, backupCfg.datasetOptions);
      if (backupCfg.pool.vdevs.length > 0) {
        selectedBackupDiskNames.value.clear();
        for (const vdev of backupCfg.pool.vdevs) {
          for (const disk of vdev.disks) {
            const match = availableDisks.value.find(d =>
              d.name === disk.name || d.alias === disk.alias
            );
            if (match) selectedBackupDiskNames.value.add(match.name);
          }
        }
      }
    }
  }
}

// ── Resolve RAID level ─────────────────────────────────────────────────

function resolveRaidLevel(level: 'auto' | BulkVDevType, diskCount: number): BulkVDevType {
  if (level !== 'auto') return level;
  if (diskCount >= 6) return 'raidz2';
  if (diskCount >= 3) return 'raidz1';
  if (diskCount === 2) return 'mirror';
  return 'disk';
}

// ── Build output config ────────────────────────────────────────────────

function buildConfig(): BulkEasySetupConfig {
  const zfsConfigs: BulkZFSConfig[] = [];

  // Storage pool ZFS config
  const storageDisks = selectedStorageDisks.value;
  if (storageDisks.length > 0) {
    const raidLevel = resolveRaidLevel(storagePool.raidLevel, storageDisks.length);
    const vdevDisks = storageDisks.map(d => ({
      path: d.alias ? `/dev/disk/by-vdev/${d.alias}` : `/dev/${d.name}`,
      name: d.name,
      alias: d.alias,
    }));

    zfsConfigs.push({
      pool: {
        name: storagePool.name || 'tank',
        vdevs: [{ type: raidLevel, disks: vdevDisks }],
      },
      poolOptions: { ...storagePool.poolOptions, forceCreate: true },
      dataset: { name: storagePool.datasetName || 'share' },
      datasetOptions: { ...storagePool.datasetOptions },
      additionalDatasets: storagePool.additionalDatasets
        .filter(d => d.name)
        .map(d => ({
          dataset: { name: d.name },
          datasetOptions: {
            compression: d.compression === 'inherit' ? undefined : d.compression,
            atime: d.atime,
            casesensitivity: d.casesensitivity,
          },
        })),
    });
  }

  // Backup pool ZFS config
  if (enableBackupPool.value) {
    const backupDisks = selectedBackupDisks.value;
    if (backupDisks.length > 0) {
      const raidLevel = resolveRaidLevel(backupPool.raidLevel, backupDisks.length);
      const vdevDisks = backupDisks.map(d => ({
        path: d.alias ? `/dev/disk/by-vdev/${d.alias}` : `/dev/${d.name}`,
        name: d.name,
        alias: d.alias,
      }));

      zfsConfigs.push({
        pool: {
          name: backupPool.name || 'tank-backup',
          vdevs: [{ type: raidLevel, disks: vdevDisks }],
        },
        poolOptions: { ...backupPool.poolOptions, forceCreate: true },
        dataset: { name: backupPool.datasetName || 'backup' },
        datasetOptions: { ...backupPool.datasetOptions },
      });
    }
  }

  // Build Samba config
  const resolvedShares = sambaShares.map(s => ({
    ...s,
    path: s.path || `/${storagePool.name || 'tank'}/${s.name || 'share'}`,
  }));

  return {
    srvrName: config.srvrName,
    folderName: storagePool.datasetName || 'share',
    smbUser: config.smbUser,
    smbPass: config.smbPass,
    splitPools: enableBackupPool.value,
    serverConfig: { ...serverConfig },
    usersAndGroups: {
      users: users.filter(u => u.username),
      groups: groups.filter(g => g.name),
    },
    zfsConfigs: zfsConfigs.length > 0 ? zfsConfigs : undefined,
    sambaConfig: {
      global: { ...sambaGlobal },
      shares: resolvedShares,
    },
  };
}

// Emit changes on any reactive state change
watch(
  [config, serverConfig, storagePool, backupPool, enableBackupPool, selectedStorageDiskNames, selectedBackupDiskNames, users, groups, sambaGlobal, sambaShares],
  () => {
    emit('update:modelValue', buildConfig());
  },
  { deep: true }
);
</script>
