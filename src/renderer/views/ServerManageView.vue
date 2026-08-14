<template>
    <div class="h-full relative overflow-hidden ui-texture-surface ui-texture-surface--soft">
        <!-- Main content area -->
        <div class="h-full overflow-y-auto">
            <div class="max-w-5xl mx-auto px-6 py-6 space-y-5">
                <!-- Header -->
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <button class="btn btn-sm btn-secondary h-fit text-gray-500 hover:text-default"
                        @click="router.push({ name: 'dashboard' })">
                            <ArrowLeftIcon class="w-4 h-4" />
                        </button>
                        <div>
                            <h1 class="text-lg font-semibold text-default flex items-center gap-2">
                                {{ server?.name || server?.host || 'Server' }}
                                <template v-if="rebooting">
                                    <ArrowPathIcon class="w-4 h-4 animate-spin text-amber-500 shrink-0" />
                                    <span class="text-xs font-normal text-amber-500">Rebooting…</span>
                                </template>
                                <span v-else class="status-dot shrink-0"
                                    :class="server?.online ? 'status-dot-ok' : 'status-dot-idle'" />
                            </h1>
                            <p class="text-xs text-gray-400">
                                {{ server?.username }}@{{ server?.host }}
                                <span v-if="server?.ip && server.ip !== server.host"> · {{ server.ip }}</span>
                            </p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <button v-if="!editing" class="btn btn-sm btn-secondary h-fit inline-flex items-center gap-1 whitespace-nowrap" @click="editing = true"
                            :disabled="probing">
                            <PencilIcon class="w-3.5 h-3.5" />
                            Edit
                        </button>
                        <button v-if="editing" class="btn btn-sm btn-secondary h-fit inline-flex items-center gap-1 whitespace-nowrap" @click="cancelEditing">
                            Cancel
                        </button>
                        <button class="btn btn-sm btn-secondary h-fit inline-flex items-center gap-1 whitespace-nowrap" @click="probeServer" :disabled="probing">
                            <ArrowPathIcon class="w-3.5 h-3.5" :class="{ 'animate-spin': probing }" />
                            Refresh
                        </button>
                    </div>
                </div>

                <!-- Tab navigation -->
                <div class="flex items-center gap-0 border-b border-neutral-200 dark:border-neutral-700"
                    :class="{ 'opacity-40 pointer-events-none': rebooting }">
                    <button v-for="tab in tabs" :key="tab.id" @click="activeTab = tab.id"
                        class="flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px"
                        :class="activeTab === tab.id
                            ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                            : 'border-transparent text-gray-500 hover:text-default hover:border-neutral-300'">
                        <component :is="tab.icon" class="w-3.5 h-3.5" />
                        {{ tab.label }}
                    </button>
                </div>

                <!-- Rebooting state -->
                <div v-if="rebooting" class="py-16 text-center text-gray-400 text-sm space-y-3">
                    <ArrowPathIcon class="w-8 h-8 animate-spin mx-auto text-amber-500" />
                    <p class="text-sm font-medium text-amber-500">Server is rebooting…</p>
                    <p class="text-xs text-gray-400">Waiting for {{ server?.name || server?.host }} to come back online</p>
                </div>

                <!-- Loading state -->
                <div v-else-if="probing" class="py-12 text-center text-gray-400 text-sm">
                    <ArrowPathIcon class="w-5 h-5 animate-spin mx-auto mb-2" />
                    Probing server…
                </div>

                <!-- Probe error -->
                <div v-else-if="!rebooting && probeError"
                    class="py-8 text-center space-y-3">
                    <ExclamationTriangleIcon class="w-8 h-8 text-amber-500 mx-auto" />
                    <p class="text-sm text-gray-400">{{ probeError }}</p>
                    <button class="btn btn-sm btn-primary h-fit" @click="probeServer">Retry</button>
                </div>

                <!-- Tab content -->
                <template v-else-if="probe">

                    <!-- ═══ Connection Info ═══ -->
                    <div v-show="activeTab === 'connection'" class="space-y-4">
                        <div class="grid grid-cols-2 gap-4">
                            <FieldCard label="Nickname" :value="server?.name || '—'" :editing="editing"
                                v-model:editValue="editForm.name" field="name" tab="Connection" type="local"
                                @stage="stageChange" />
                            <FieldCard label="Host" :value="server?.host || '—'" :editing="false" />
                            <FieldCard label="Hostname" :value="probe.hostname || '—'"
                                :editing="editing" v-model:editValue="editForm.hostname" field="hostname"
                                tab="Connection" type="remote" @stage="stageChange" />
                            <FieldCard label="IP Address" :value="server?.ip || '—'" :editing="false" />
                        </div>
                        <SectionDivider label="Admin Login" />
                        <div class="grid grid-cols-2 gap-4">
                            <FieldCard label="Username" :value="server?.username || '—'" :editing="editing"
                                v-model:editValue="editForm.username" field="username" tab="Connection" type="local"
                                @stage="stageChange" />
                            <FieldCard label="Password" value="••••••••" :editing="editing"
                                v-model:editValue="editForm.password" field="password" tab="Connection" type="local"
                                inputType="password" @stage="stageChange" />
                        </div>
                        <SectionDivider label="Samba Share" />
                        <div class="grid grid-cols-2 gap-4">
                            <FieldCard label="Share Name" :value="server?.shareName || '—'" :editing="editing"
                                v-model:editValue="editForm.shareName" field="shareName" tab="Connection" type="local"
                                @stage="stageChange" />
                            <FieldCard label="SMB Username" :value="server?.smbUser || '—'" :editing="editing"
                                v-model:editValue="editForm.smbUser" field="smbUser" tab="Connection" type="local"
                                @stage="stageChange" />
                        </div>
                        <FieldCard label="SMB Password" value="••••••••" :editing="editing"
                            v-model:editValue="editForm.smbPass" field="smbPass" tab="Connection" type="local"
                            inputType="password" @stage="stageChange" />
                    </div>

                    <!-- ═══ Network / Hostname ═══ -->
                    <div v-show="activeTab === 'network'" class="space-y-4">
                        <FieldCard label="Hostname" :value="probe.hostname || '—'"
                            :editing="editing" v-model:editValue="editForm.hostname" field="hostname"
                            tab="Network" type="remote" @stage="stageChange" class="max-w-sm" />
                        <SectionDivider label="IP Addresses" />
                        <div v-if="probe.ips.length" class="space-y-1">
                            <InfoRow v-for="ip in probe.ips" :key="ip.iface"
                                :label="ip.iface" :value="ip.addr" />
                        </div>
                        <div v-else class="text-xs text-gray-400">No IP addresses found.</div>
                        <SectionDivider label="DNS Servers" />
                        <div v-if="probe.dns.length" class="space-y-1">
                            <InfoRow v-for="(dns, i) in probe.dns" :key="i"
                                :label="`DNS ${i + 1}`" :value="dns" />
                        </div>
                        <div v-else class="text-xs text-gray-400">No DNS servers configured.</div>

                        <!-- VPN Tunnels -->
                        <SectionDivider label="VPN Tunnels (WireGuard)" />
                        <div v-if="vpnLoading" class="flex items-center gap-2 py-3 px-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-700 dark:text-blue-300">
                            <ArrowPathIcon class="w-4 h-4 animate-spin" /> Refreshing tunnels…
                        </div>
                        <template v-else-if="vpnStatus">
                            <div v-if="!vpnStatus.installed" class="text-xs text-gray-400">
                                Wire Wizard is not installed on this server.
                            </div>
                            <template v-else>
                                <div v-if="vpnStatus.interfaces.length" class="space-y-2">
                                    <div v-for="iface in vpnStatus.interfaces" :key="iface.name"
                                        class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 p-3">
                                        <div class="flex items-center justify-between mb-1">
                                            <span class="text-sm font-semibold font-mono text-default">{{ iface.name }}</span>
                                            <div class="flex items-center gap-2">
                                                <span v-if="iface.peers.length && iface.peers[0].latestHandshake > 0"
                                                    class="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                                    Connected
                                                </span>
                                                <span v-else class="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                                    No handshake
                                                </span>
                                                <button v-if="editing" @click="teardownTunnel(iface.name)"
                                                    class="text-xs text-red-500 hover:text-red-700">Remove</button>
                                                <button @click="managedTunnel = iface"
                                                    class="text-xs text-link hover:underline">Manage</button>
                                            </div>
                                        </div>
                                        <div class="grid grid-cols-2 gap-1 text-xs" v-if="iface.peers.length">
                                            <div><span class="text-gray-400">Port:</span> <span class="text-default">{{ iface.listenPort }}</span></div>
                                            <div><span class="text-gray-400">Endpoint:</span> <span class="text-default font-mono">{{ iface.peers[0].endpoint || '—' }}</span></div>
                                            <div><span class="text-gray-400">Rx:</span> <span class="text-default">{{ formatBytes(iface.peers[0].transferRx) }}</span></div>
                                            <div><span class="text-gray-400">Tx:</span> <span class="text-default">{{ formatBytes(iface.peers[0].transferTx) }}</span></div>
                                        </div>
                                    </div>
                                </div>
                                <div v-else class="text-xs text-gray-400">No active tunnels.</div>
                                <button @click="showPairModal = true" class="btn btn-sm btn-primary h-fit inline-flex items-center gap-1 mt-2">
                                    <PlusIcon class="w-3 h-3" /> New Tunnel
                                </button>
                            </template>
                        </template>

                        <SectionDivider label="Backup Topology" />
                        <BackupTopologyMap :serverHost="server?.host" />
                    </div>

                    <!-- ═══ Storage ═══ -->
                    <div v-show="activeTab === 'storage'" class="space-y-4">
                        <!-- Open Houston link -->
                        <div class="flex items-center justify-end">
                            <a :href="`https://${server?.host}:9090/zfs`" target="_blank" rel="noopener"
                                class="text-xs text-link inline-flex items-center gap-1 hover:underline">
                                Advanced Storage Management (Houston) →
                            </a>
                        </div>
                        <!-- Pool section header with action -->
                        <div class="flex items-center justify-between">
                            <SectionDivider label="ZFS Pools" />
                            <button v-if="editing" class="btn btn-sm btn-secondary h-fit inline-flex items-center gap-1 whitespace-nowrap text-xs"
                                @click="openCreatePool()">
                                <PlusIcon class="w-3 h-3" /> New Pool
                            </button>
                        </div>
                        <div v-if="probe.zfs.pools.length" class="space-y-3">
                            <div v-for="pool in probe.zfs.pools" :key="pool.name"
                                class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 p-3">
                                <div class="flex items-center justify-between mb-2">
                                    <div class="flex items-center gap-2">
                                        <span class="text-sm font-semibold text-default">{{ pool.name }}</span>
                                        <button class="text-xs text-link inline-flex items-center gap-0.5" @click="viewPoolStatus(pool.name)">
                                            <span>{{ poolStatusMap[pool.name] ? '▾ Hide' : '▸ Details' }}</span>
                                        </button>
                                    </div>
                                    <span class="text-xs font-medium px-2 py-0.5 rounded-full"
                                        :class="pool.health === 'ONLINE'
                                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'">
                                        {{ pool.health }}
                                    </span>
                                </div>
                                <div class="grid grid-cols-3 gap-2 text-xs">
                                    <div><span class="text-gray-400">Size:</span> <span class="text-default">{{ pool.size }}</span></div>
                                    <div><span class="text-gray-400">Used:</span> <span class="text-default">{{ pool.alloc }}</span></div>
                                    <div><span class="text-gray-400">Free:</span> <span class="text-default">{{ pool.free }}</span></div>
                                </div>
                                <!-- Pool status detail (expanded) -->
                                <pre v-if="poolStatusMap[pool.name]"
                                    class="mt-2 text-[11px] text-gray-500 dark:text-gray-400 bg-neutral-100 dark:bg-neutral-900/50 rounded p-2 overflow-x-auto max-h-48 whitespace-pre border border-neutral-200/60 dark:border-neutral-700/50">{{ poolStatusMap[pool.name] }}</pre>
                            </div>
                        </div>
                        <div v-else class="text-xs text-gray-400 py-4">No ZFS pools found.</div>

                        <!-- Datasets section with create -->
                        <div class="flex items-center justify-between">
                            <SectionDivider label="Datasets" />
                            <button v-if="editing && probe.zfs.pools.length" class="btn btn-sm btn-secondary h-fit inline-flex items-center gap-1 whitespace-nowrap text-xs"
                                @click="showCreateDataset = true">
                                <PlusIcon class="w-3 h-3" /> New Dataset
                            </button>
                        </div>
                        <div v-if="probe.zfs.datasets.length"
                            class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
                            <table class="w-full text-xs">
                                <thead>
                                    <tr class="border-b border-neutral-200 dark:border-neutral-700">
                                        <th class="text-left px-3 py-2 text-gray-400 font-medium">Name</th>
                                        <th class="text-left px-3 py-2 text-gray-400 font-medium">Used</th>
                                        <th class="text-left px-3 py-2 text-gray-400 font-medium">Available</th>
                                        <th class="text-left px-3 py-2 text-gray-400 font-medium">Mountpoint</th>
                                        <th class="text-right px-3 py-2 text-gray-400 font-medium">Actions</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-neutral-100 dark:divide-neutral-700/50">
                                    <tr v-for="ds in probe.zfs.datasets" :key="ds.name"
                                        class="hover:bg-neutral-50 dark:hover:bg-neutral-700/30">
                                        <td class="px-3 py-1.5 text-default font-medium">{{ ds.name }}</td>
                                        <td class="px-3 py-1.5 text-gray-500">{{ ds.used }}</td>
                                        <td class="px-3 py-1.5 text-gray-500">{{ ds.avail }}</td>
                                        <td class="px-3 py-1.5 text-gray-400">{{ ds.mountpoint }}</td>
                                        <td class="px-3 py-1.5 text-right">
                                            <button class="text-xs text-link mr-2" @click="viewDatasetProps(ds.name)">Props</button>
                                            <button v-if="editing && ds.name.includes('/')" class="text-xs text-red-400 hover:text-red-500"
                                                @click="confirmDestroyDataset(ds.name)">Delete</button>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div v-else class="text-xs text-gray-400 py-4">No datasets found.</div>

                        <!-- Dataset properties detail (shown when a dataset is selected) -->
                        <div v-if="selectedDatasetProps"
                            class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 p-3">
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-sm font-semibold text-default">{{ selectedDatasetName }}</span>
                                <button class="text-xs text-gray-400 hover:text-default" @click="selectedDatasetProps = null">✕</button>
                            </div>
                            <div class="grid grid-cols-2 gap-x-6 gap-y-3">
                                <!-- Mount Point -->
                                <div v-if="selectedDatasetProps.mountpoint" class="flex items-center gap-2 text-xs">
                                    <span class="text-gray-500 dark:text-gray-400 min-w-[110px]">Mount Point</span>
                                    <span v-if="!editing" class="text-default">{{ selectedDatasetProps.mountpoint.value }}</span>
                                    <input v-else v-model="datasetPropEdits.mountpoint"
                                        class="flex-1 px-2 py-0.5 text-xs rounded bg-white dark:bg-neutral-900 border border-blue-300 dark:border-blue-600/50 text-default outline-none focus:border-blue-400"
                                        @change="stageDatasetProp('mountpoint', datasetPropEdits.mountpoint)" />
                                </div>
                                <!-- Compression -->
                                <div v-if="selectedDatasetProps.compression" class="flex items-center gap-2 text-xs">
                                    <span class="text-gray-500 dark:text-gray-400 min-w-[110px]">Compression</span>
                                    <span v-if="!editing" class="text-default">{{ selectedDatasetProps.compression.value }}</span>
                                    <select v-else v-model="datasetPropEdits.compression"
                                        class="flex-1 px-2 py-0.5 text-xs rounded bg-white dark:bg-neutral-900 border border-blue-300 dark:border-blue-600/50 text-default outline-none focus:border-blue-400"
                                        @change="stageDatasetProp('compression', datasetPropEdits.compression)">
                                        <option value="lz4">lz4</option>
                                        <option value="zstd">zstd</option>
                                        <option value="gzip">gzip</option>
                                        <option value="off">off</option>
                                    </select>
                                </div>
                                <!-- Record Size -->
                                <div v-if="selectedDatasetProps.recordsize" class="flex items-center gap-2 text-xs">
                                    <span class="text-gray-500 dark:text-gray-400 min-w-[110px]">Record Size</span>
                                    <span v-if="!editing" class="text-default">{{ selectedDatasetProps.recordsize.value }}</span>
                                    <select v-else v-model="datasetPropEdits.recordsize"
                                        class="flex-1 px-2 py-0.5 text-xs rounded bg-white dark:bg-neutral-900 border border-blue-300 dark:border-blue-600/50 text-default outline-none focus:border-blue-400"
                                        @change="stageDatasetProp('recordsize', datasetPropEdits.recordsize)">
                                        <option value="4K">4K</option>
                                        <option value="8K">8K</option>
                                        <option value="16K">16K</option>
                                        <option value="32K">32K</option>
                                        <option value="64K">64K</option>
                                        <option value="128K">128K</option>
                                        <option value="256K">256K</option>
                                        <option value="512K">512K</option>
                                        <option value="1M">1M</option>
                                    </select>
                                </div>
                                <!-- Quota -->
                                <div v-if="selectedDatasetProps.quota" class="flex items-center gap-2 text-xs">
                                    <span class="text-gray-500 dark:text-gray-400 min-w-[110px]">Quota</span>
                                    <span v-if="!editing" class="text-default">{{ selectedDatasetProps.quota.value }}</span>
                                    <template v-else>
                                        <input v-model="quotaNum" type="number" min="0" placeholder="0"
                                            class="w-20 px-2 py-0.5 text-xs rounded bg-white dark:bg-neutral-900 border border-blue-300 dark:border-blue-600/50 text-default outline-none focus:border-blue-400"
                                            @change="stageQuotaProp('quota')" />
                                        <select v-model="quotaUnit"
                                            class="px-1 py-0.5 text-xs rounded bg-white dark:bg-neutral-900 border border-blue-300 dark:border-blue-600/50 text-default outline-none"
                                            @change="stageQuotaProp('quota')">
                                            <option value="none">none</option>
                                            <option value="M">MiB</option>
                                            <option value="G">GiB</option>
                                            <option value="T">TiB</option>
                                        </select>
                                    </template>
                                </div>
                                <!-- Reserved Space (refreservation) -->
                                <div v-if="selectedDatasetProps.refreservation" class="flex items-center gap-2 text-xs">
                                    <span class="text-gray-500 dark:text-gray-400 min-w-[110px]">Reserved Space</span>
                                    <span v-if="!editing" class="text-default">{{ selectedDatasetProps.refreservation.value }}</span>
                                    <template v-else>
                                        <input v-model="refresNum" type="number" min="0" placeholder="0"
                                            class="w-20 px-2 py-0.5 text-xs rounded bg-white dark:bg-neutral-900 border border-blue-300 dark:border-blue-600/50 text-default outline-none focus:border-blue-400"
                                            @change="stageQuotaProp('refreservation')" />
                                        <select v-model="refresUnit"
                                            class="px-1 py-0.5 text-xs rounded bg-white dark:bg-neutral-900 border border-blue-300 dark:border-blue-600/50 text-default outline-none"
                                            @change="stageQuotaProp('refreservation')">
                                            <option value="none">none</option>
                                            <option value="M">MiB</option>
                                            <option value="G">GiB</option>
                                            <option value="T">TiB</option>
                                        </select>
                                    </template>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- ═══ Users & Groups ═══ -->
                    <div v-show="activeTab === 'users'" class="space-y-4">
                        <div class="flex items-center justify-between">
                            <SectionDivider label="System Users" />
                            <button v-if="editing" class="btn btn-sm btn-secondary h-fit inline-flex items-center gap-1 whitespace-nowrap text-xs"
                                @click="showAddUser = true">
                                <PlusIcon class="w-3 h-3" /> Add User
                            </button>
                        </div>
                        <div v-if="probe.users.length"
                            class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
                            <table class="w-full text-xs">
                                <thead>
                                    <tr class="border-b border-neutral-200 dark:border-neutral-700">
                                        <th class="text-left px-3 py-2 text-gray-400 font-medium">Username</th>
                                        <th class="text-left px-3 py-2 text-gray-400 font-medium">UID</th>
                                        <th class="text-left px-3 py-2 text-gray-400 font-medium">Home</th>
                                        <th class="text-left px-3 py-2 text-gray-400 font-medium">Shell</th>
                                        <th class="text-left px-3 py-2 text-gray-400 font-medium">Samba</th>
                                        <th v-if="editing" class="text-right px-3 py-2 text-gray-400 font-medium">Actions</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-neutral-100 dark:divide-neutral-700/50">
                                    <tr v-for="user in probe.users" :key="user.username"
                                        class="hover:bg-neutral-50 dark:hover:bg-neutral-700/30">
                                        <td class="px-3 py-1.5 text-default font-medium">{{ user.username }}</td>
                                        <td class="px-3 py-1.5 text-gray-500">{{ user.uid }}</td>
                                        <td class="px-3 py-1.5 text-gray-400">{{ user.home }}</td>
                                        <td class="px-3 py-1.5 text-gray-400">{{ user.shell }}</td>
                                        <td class="px-3 py-1.5">
                                            <span v-if="probe.sambaUsers.includes(user.username)"
                                                class="text-green-500">✓</span>
                                            <span v-else class="text-gray-300">—</span>
                                        </td>
                                        <td v-if="editing" class="px-3 py-1.5 text-right space-x-2">
                                            <button class="text-xs text-link" @click="showSetPasswordFor = user.username">Password</button>
                                            <button class="text-xs text-link" @click="showSshKeyFor = user.username">SSH Key</button>
                                            <button class="text-xs text-red-400 hover:text-red-500"
                                                @click="confirmDeleteUser(user.username)">Delete</button>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div v-else class="text-xs text-gray-400 py-4">No users found (UID ≥ 1000).</div>

                        <div class="flex items-center justify-between">
                            <SectionDivider label="Groups" />
                            <button v-if="editing" class="btn btn-sm btn-secondary h-fit inline-flex items-center gap-1 whitespace-nowrap text-xs"
                                @click="showAddGroup = true">
                                <PlusIcon class="w-3 h-3" /> Add Group
                            </button>
                        </div>
                        <div v-if="probe.groups.length" class="space-y-2">
                            <div v-for="group in probe.groups" :key="group.name"
                                class="flex items-center gap-3 px-3 py-2 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700">
                                <span class="text-sm font-medium text-default min-w-[120px]">{{ group.name }}</span>
                                <span class="text-xs text-gray-400">GID {{ group.gid }}</span>
                                <div class="flex flex-wrap gap-1 ml-auto">
                                    <span v-for="member in group.members" :key="member"
                                        class="text-xs px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-700 text-gray-600 dark:text-gray-300">
                                        {{ member }}
                                    </span>
                                    <span v-if="!group.members.length" class="text-xs text-gray-400">No members</span>
                                </div>
                                <button v-if="editing && !['root','wheel','sudo','smbusers','users','adm','staff'].includes(group.name)"
                                    class="text-xs text-red-400 hover:text-red-500 shrink-0"
                                    @click="confirmDeleteGroup(group.name)">Delete</button>
                            </div>
                        </div>
                        <div v-else class="text-xs text-gray-400 py-4">No groups found.</div>
                    </div>

                    <!-- ═══ Samba Shares ═══ -->
                    <div v-show="activeTab === 'samba'" class="space-y-4">
                        <div class="flex items-center justify-between">
                            <SectionDivider label="Global Settings" />
                            <button v-if="editing" class="btn btn-sm btn-secondary h-fit inline-flex items-center gap-1 whitespace-nowrap text-xs"
                                @click="openEditSambaGlobal()">
                                <PencilIcon class="w-3 h-3" /> Edit Global
                            </button>
                        </div>
                        <div v-if="Object.keys(probe.samba.global).length" class="space-y-1">
                            <InfoRow v-for="(val, key) in probe.samba.global" :key="key"
                                :label="String(key)" :value="String(val)" />
                        </div>
                        <div v-else class="text-xs text-gray-400">No global settings parsed.</div>

                        <div class="flex items-center justify-between">
                            <SectionDivider label="Shares" />
                            <button v-if="editing" class="btn btn-sm btn-secondary h-fit inline-flex items-center gap-1 whitespace-nowrap text-xs"
                                @click="showAddShare = true">
                                <PlusIcon class="w-3 h-3" /> Add Share
                            </button>
                        </div>
                        <div v-if="probe.samba.shares.length" class="space-y-3">
                            <div v-for="share in probe.samba.shares" :key="share.name"
                                class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 p-3">
                                <div class="flex items-center justify-between mb-2">
                                    <div class="flex items-center gap-2">
                                        <span class="text-sm font-semibold text-default">[{{ share.name }}]</span>
                                        <span v-if="share.comment" class="text-xs text-gray-400">{{ share.comment }}</span>
                                    </div>
                                    <button v-if="editing" class="text-xs text-red-400 hover:text-red-500"
                                        @click="confirmRemoveShare(share.name)">Remove</button>
                                </div>
                                <div class="grid grid-cols-2 gap-2 text-xs">
                                    <div><span class="text-gray-400">Path:</span> <span class="text-default">{{ share.path }}</span></div>
                                    <div><span class="text-gray-400">Guest OK:</span> <span class="text-default">{{ share.guestOk ? 'Yes' : 'No' }}</span></div>
                                    <div><span class="text-gray-400">Read Only:</span> <span class="text-default">{{ share.readOnly ? 'Yes' : 'No' }}</span></div>
                                    <div><span class="text-gray-400">Browseable:</span> <span class="text-default">{{ share.browseable ? 'Yes' : 'No' }}</span></div>
                                </div>
                            </div>
                        </div>
                        <div v-else class="text-xs text-gray-400 py-4">No Samba shares configured.</div>

                        <SectionDivider label="Samba Passwords" />
                        <div v-if="probe.users.length" class="space-y-1">
                            <div v-for="user in probe.users" :key="'smb-'+user.username"
                                class="flex items-center gap-3 px-3 py-1.5 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700">
                                <span class="text-xs font-medium text-default min-w-[100px]">{{ user.username }}</span>
                                <span v-if="probe.sambaUsers.includes(user.username)" class="text-xs text-green-500">Has Samba password</span>
                                <span v-else class="text-xs text-gray-400">No Samba password</span>
                                <button v-if="editing" class="text-xs text-link ml-auto"
                                    @click="showSetSambaPasswordFor = user.username">
                                    {{ probe.sambaUsers.includes(user.username) ? 'Change' : 'Set' }}
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- ═══ System Info ═══ -->
                    <div v-show="activeTab === 'system'" class="space-y-4">
                        <SectionDivider label="Operating System" />
                        <div class="grid grid-cols-2 gap-4">
                            <InfoRow label="OS" :value="probe.os.pretty" />
                            <InfoRow label="Uptime" :value="probe.uptime" />
                        </div>
                        <SectionDivider label="Hardware" />
                        <div class="grid grid-cols-2 gap-4">
                            <InfoRow label="CPU" :value="probe.cpu.model" />
                            <InfoRow label="Cores" :value="String(probe.cpu.cores)" />
                            <InfoRow label="Memory"
                                :value="`${probe.memory.usedMB} MB / ${probe.memory.totalMB} MB used`" />
                            <InfoRow label="Free Memory" :value="`${probe.memory.freeMB} MB`" />
                        </div>
                        <SectionDivider label="Services" />
                        <div v-if="probe.services.length" class="grid grid-cols-2 gap-2">
                            <div v-for="svc in probe.services" :key="svc.name"
                                class="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700">
                                <span class="status-dot shrink-0"
                                    :class="svc.active ? 'status-dot-ok' : 'status-dot-idle'" />
                                <span class="text-xs text-default">{{ svc.name }}</span>
                            </div>
                        </div>
                        <div v-else class="text-xs text-gray-400 py-4">No services detected.</div>
                    </div>
                </template>

                <!-- No probe data yet and not probing -->
                <div v-else class="py-12 text-center text-gray-400 text-sm">
                    <ServerIcon class="w-8 h-8 mx-auto mb-2 text-gray-300" />
                    <p>Click <strong>Refresh</strong> to probe server information.</p>
                </div>
            </div>
        </div>

        <!-- ═══ Staged Changes Panel (overlay on right) ═══ -->
        <Transition name="slide-panel">
            <div v-if="stagedChanges.length > 0"
                class="absolute top-0 right-0 h-full w-72 border-l border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 flex flex-col shadow-xl z-30">
                <div class="px-4 py-3 border-b border-neutral-200 dark:border-neutral-700">
                    <h3 class="text-sm font-semibold text-default">Staged Changes</h3>
                    <p class="text-xs text-gray-400 mt-0.5">{{ stagedChanges.length }} pending</p>
                </div>
                <div class="flex-1 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-700/50">
                    <div v-for="change in stagedChanges" :key="change.id"
                        class="px-4 py-2.5 group hover:bg-neutral-50 dark:hover:bg-neutral-700/30">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-medium text-default">{{ change.label }}</span>
                            <button @click="unstageChange(change.id)"
                                class="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20">
                                <XMarkIcon class="w-3 h-3 text-red-400" />
                            </button>
                        </div>
                        <div class="text-xs mt-0.5">
                            <span class="text-red-400 line-through">{{ change.oldValue || '(empty)' }}</span>
                            <span class="text-gray-400 mx-1">→</span>
                            <span class="text-green-500">{{ change.field === 'password' || change.field === 'smbPass' ? '••••••••' : change.newValue }}</span>
                        </div>
                        <span class="text-[10px] uppercase tracking-wider mt-1 inline-block"
                            :class="change.type === 'remote' ? 'text-amber-500' : 'text-blue-400'">
                            {{ change.type === 'remote' ? 'server' : 'local' }}
                        </span>
                    </div>
                </div>
                <div class="p-3 border-t border-neutral-200 dark:border-neutral-700 space-y-2">
                    <button class="btn btn-sm btn-primary w-full h-fit" @click="applyChanges" :disabled="applying">
                        <span v-if="applying">Applying…</span>
                        <span v-else>Save {{ stagedChanges.length }} Change{{ stagedChanges.length > 1 ? 's' : '' }}</span>
                    </button>
                    <button class="btn btn-sm btn-secondary w-full h-fit" @click="clearAllChanges" :disabled="applying">
                        Discard All
                    </button>
                </div>
            </div>
        </Transition>

        <!-- ═══ Action Modals ═══ -->
        <Teleport to="body">
            <!-- Create Dataset -->
            <div v-if="showCreateDataset" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @mousedown.self="showCreateDataset = false">
                <div class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-xl max-w-md w-full mx-4 p-5 space-y-3">
                    <h3 class="text-sm font-semibold text-default">Create Dataset</h3>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="text-xs font-medium text-gray-400 mb-1 block">Parent Pool / Dataset</label>
                            <select v-model="newDataset.parent" class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none">
                                <option v-for="ds in probe?.zfs.datasets || []" :key="ds.name" :value="ds.name">{{ ds.name }}</option>
                            </select>
                        </div>
                        <div>
                            <label class="text-xs font-medium text-gray-400 mb-1 block">Dataset Name</label>
                            <input v-model="newDataset.name" type="text" placeholder="mydata"
                                class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none focus:border-blue-400" />
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="text-xs font-medium text-gray-400 mb-1 block">Compression</label>
                            <select v-model="newDataset.compression" class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none">
                                <option value="lz4">LZ4 (recommended)</option>
                                <option value="zstd">ZSTD</option>
                                <option value="gzip">GZIP</option>
                                <option value="off">Off</option>
                            </select>
                        </div>
                        <div>
                            <label class="text-xs font-medium text-gray-400 mb-1 block">Record Size</label>
                            <select v-model="newDataset.recordsize" class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none">
                                <option value="4K">4K</option>
                                <option value="8K">8K</option>
                                <option value="16K">16K</option>
                                <option value="32K">32K</option>
                                <option value="64K">64K</option>
                                <option value="128K">128K (default)</option>
                                <option value="256K">256K</option>
                                <option value="512K">512K</option>
                                <option value="1M">1M</option>
                            </select>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="text-xs font-medium text-gray-400 mb-1 block">Quota <span class="text-gray-300">(optional)</span></label>
                            <div class="flex gap-1">
                                <input v-model="newDataset.quotaNum" type="number" min="0" placeholder="0"
                                    class="flex-1 px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none focus:border-blue-400" />
                                <select v-model="newDataset.quotaUnit"
                                    class="px-2 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none">
                                    <option value="none">none</option>
                                    <option value="M">MiB</option>
                                    <option value="G">GiB</option>
                                    <option value="T">TiB</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label class="text-xs font-medium text-gray-400 mb-1 block">Reserved Space <span class="text-gray-300">(optional)</span></label>
                            <div class="flex gap-1">
                                <input v-model="newDataset.refresNum" type="number" min="0" placeholder="0"
                                    class="flex-1 px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none focus:border-blue-400" />
                                <select v-model="newDataset.refresUnit"
                                    class="px-2 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none">
                                    <option value="none">none</option>
                                    <option value="M">MiB</option>
                                    <option value="G">GiB</option>
                                    <option value="T">TiB</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div class="flex justify-end gap-2 pt-1">
                        <button class="btn btn-sm btn-secondary h-fit" @click="showCreateDataset = false">Cancel</button>
                        <button class="btn btn-sm btn-primary h-fit" :disabled="!newDataset.parent || !newDataset.name || mgmt.busy.value"
                            @click="doCreateDataset">Create</button>
                    </div>
                </div>
            </div>

            <!-- Create Pool -->
            <div v-if="showCreatePool" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @mousedown.self="showCreatePool = false">
                <div class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-xl max-w-lg w-full mx-4 p-5 space-y-3">
                    <h3 class="text-sm font-semibold text-default">Create Pool</h3>
                    <p class="text-xs text-amber-500">Warning: This will format the selected disks. All data on them will be lost.</p>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="text-xs font-medium text-gray-400 mb-1 block">Pool Name</label>
                            <input v-model="newPool.name" type="text" placeholder="tank"
                                class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none focus:border-blue-400" />
                        </div>
                        <div>
                            <label class="text-xs font-medium text-gray-400 mb-1 block">Virtual Device Type</label>
                            <select v-model="newPool.vdevType" class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none">
                                <option value="disk">Single Disk (no redundancy)</option>
                                <option value="mirror">Mirror</option>
                                <option value="raidz1">RAIDZ1</option>
                                <option value="raidz2">RAIDZ2</option>
                                <option value="raidz3">RAIDZ3</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label class="text-xs font-medium text-gray-400 mb-1 block">Select Disks ({{ selectedNewPoolDisks.size }} selected)</label>
                        <div v-if="loadingDisks" class="py-4 text-center text-xs text-gray-400">
                            <ArrowPathIcon class="w-4 h-4 animate-spin mx-auto mb-1" /> Probing disks…
                        </div>
                        <div v-else-if="availableDisks.length" class="grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto">
                            <button v-for="disk in availableDisks" :key="disk.name" type="button"
                                class="flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-lg border transition-colors text-left"
                                :class="selectedNewPoolDisks.has(disk.name)
                                    ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-400 dark:border-blue-600 text-blue-700 dark:text-blue-300'
                                    : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 text-default hover:border-blue-300'"
                                @click="togglePoolDisk(disk.name)">
                                <div class="flex flex-col flex-1 min-w-0">
                                    <div class="flex items-center gap-1.5">
                                        <span class="font-semibold">{{ disk.alias || disk.name }}</span>
                                        <span v-if="disk.alias" class="text-[10px] text-gray-400">({{ disk.name }})</span>
                                    </div>
                                    <span v-if="disk.model" class="text-[10px] text-gray-400 truncate">{{ disk.model }}</span>
                                </div>
                                <div class="flex flex-col items-end shrink-0 text-[10px] text-gray-400">
                                    <span>{{ disk.size }}</span>
                                    <span>{{ disk.type || 'HDD' }}</span>
                                </div>
                            </button>
                        </div>
                        <div v-else class="py-3 text-center text-xs text-gray-400">No available (unused) disks found.</div>
                    </div>
                    <div class="flex justify-end gap-2 pt-1">
                        <button class="btn btn-sm btn-secondary h-fit" @click="showCreatePool = false">Cancel</button>
                        <button class="btn btn-sm h-fit bg-amber-500 hover:bg-amber-600 text-white border-amber-500"
                            :disabled="!newPool.name || selectedNewPoolDisks.size === 0 || mgmt.busy.value"
                            @click="doCreatePool">Create Pool</button>
                    </div>
                </div>
            </div>

            <!-- Add User -->
            <div v-if="showAddUser" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @mousedown.self="showAddUser = false">
                <div class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-xl max-w-md w-full mx-4 p-5 space-y-3">
                    <h3 class="text-sm font-semibold text-default">Add User</h3>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="text-xs font-medium text-gray-400 mb-1 block">Username</label>
                            <input v-model="newUser.username" type="text" placeholder="backupuser"
                                class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none focus:border-blue-400" />
                        </div>
                        <div>
                            <label class="text-xs font-medium text-gray-400 mb-1 block">Password</label>
                            <input v-model="newUser.password" type="password" placeholder="••••••••"
                                class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none focus:border-blue-400" />
                        </div>
                    </div>
                    <div>
                        <label class="text-xs font-medium text-gray-400 mb-1 block">Groups</label>
                        <div class="flex flex-wrap gap-x-3 gap-y-1.5">
                            <label v-for="g in allGroupNames" :key="g" class="flex items-center gap-1.5 cursor-pointer">
                                <input type="checkbox" :checked="newUser.selectedGroups.has(g)"
                                    @change="toggleNewUserGroup(g)"
                                    class="rounded border-neutral-400 dark:border-neutral-500 w-3 h-3" />
                                <span class="text-xs" :class="isExistingGroup(g) ? 'text-gray-400 italic' : 'text-default'">{{ g }}</span>
                            </label>
                        </div>
                    </div>
                    <div>
                        <label class="text-xs font-medium text-gray-400 mb-1 block">SSH Public Key <span class="text-gray-300">(optional)</span></label>
                        <input v-model="newUser.sshKey" type="text" placeholder="ssh-ed25519 AAAA..."
                            class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none focus:border-blue-400 font-mono text-xs" />
                    </div>
                    <div class="flex justify-end gap-2 pt-1">
                        <button class="btn btn-sm btn-secondary h-fit" @click="showAddUser = false">Cancel</button>
                        <button class="btn btn-sm btn-primary h-fit" :disabled="!newUser.username || mgmt.busy.value"
                            @click="doAddUser">Add User</button>
                    </div>
                </div>
            </div>

            <!-- Set Password -->
            <div v-if="showSetPasswordFor" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @mousedown.self="showSetPasswordFor = null">
                <div class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-xl max-w-sm w-full mx-4 p-5 space-y-3">
                    <h3 class="text-sm font-semibold text-default">Set Password for {{ showSetPasswordFor }}</h3>
                    <div>
                        <label class="text-xs font-medium text-gray-400 mb-1 block">New Password</label>
                        <input v-model="modalPassword" type="password" placeholder="••••••••"
                            class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none focus:border-blue-400" />
                    </div>
                    <div class="flex justify-end gap-2 pt-1">
                        <button class="btn btn-sm btn-secondary h-fit" @click="showSetPasswordFor = null">Cancel</button>
                        <button class="btn btn-sm btn-primary h-fit" :disabled="!modalPassword || mgmt.busy.value"
                            @click="doSetPassword">Save</button>
                    </div>
                </div>
            </div>

            <!-- Add SSH Key -->
            <div v-if="showSshKeyFor" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @mousedown.self="showSshKeyFor = null">
                <div class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-xl max-w-md w-full mx-4 p-5 space-y-3">
                    <h3 class="text-sm font-semibold text-default">Add SSH Key for {{ showSshKeyFor }}</h3>
                    <div>
                        <label class="text-xs font-medium text-gray-400 mb-1 block">Public Key</label>
                        <textarea v-model="modalSshKey" rows="3" placeholder="ssh-ed25519 AAAA..."
                            class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none focus:border-blue-400 resize-none" />
                    </div>
                    <div class="flex justify-end gap-2 pt-1">
                        <button class="btn btn-sm btn-secondary h-fit" @click="showSshKeyFor = null">Cancel</button>
                        <button class="btn btn-sm btn-primary h-fit" :disabled="!modalSshKey || mgmt.busy.value"
                            @click="doAddSshKey">Add Key</button>
                    </div>
                </div>
            </div>

            <!-- Add Group -->
            <div v-if="showAddGroup" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @mousedown.self="showAddGroup = false">
                <div class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-xl max-w-sm w-full mx-4 p-5 space-y-3">
                    <h3 class="text-sm font-semibold text-default">Add Group</h3>
                    <div>
                        <label class="text-xs font-medium text-gray-400 mb-1 block">Group Name</label>
                        <input v-model="modalGroupName" type="text" placeholder="editors"
                            class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none focus:border-blue-400" />
                    </div>
                    <div class="flex justify-end gap-2 pt-1">
                        <button class="btn btn-sm btn-secondary h-fit" @click="showAddGroup = false">Cancel</button>
                        <button class="btn btn-sm btn-primary h-fit" :disabled="!modalGroupName || mgmt.busy.value"
                            @click="doAddGroup">Add</button>
                    </div>
                </div>
            </div>

            <!-- Add Samba Share -->
            <div v-if="showAddShare" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @mousedown.self="showAddShare = false">
                <div class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-xl max-w-sm w-full mx-4 p-5 space-y-3">
                    <h3 class="text-sm font-semibold text-default">Add Samba Share</h3>
                    <div>
                        <label class="text-xs font-medium text-gray-400 mb-1 block">Share Name</label>
                        <input v-model="newShare.name" type="text" placeholder="media"
                            class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none focus:border-blue-400" />
                    </div>
                    <div>
                        <label class="text-xs font-medium text-gray-400 mb-1 block">Path</label>
                        <input v-model="newShare.path" type="text" placeholder="/tank/share/media"
                            class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none focus:border-blue-400" />
                    </div>
                    <div class="flex flex-wrap gap-4 text-xs">
                        <label class="flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" v-model="newShare.browseable" class="rounded border-neutral-400" />
                            Browseable
                        </label>
                        <label class="flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" v-model="newShare.guestOk" class="rounded border-neutral-400" />
                            Guest OK
                        </label>
                    </div>
                    <div class="flex justify-end gap-2 pt-1">
                        <button class="btn btn-sm btn-secondary h-fit" @click="showAddShare = false">Cancel</button>
                        <button class="btn btn-sm btn-primary h-fit" :disabled="!newShare.name || !newShare.path || mgmt.busy.value"
                            @click="doAddShare">Add Share</button>
                    </div>
                </div>
            </div>

            <!-- Edit Samba Global -->
            <div v-if="showEditSambaGlobal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @mousedown.self="showEditSambaGlobal = false">
                <div class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-xl max-w-sm w-full mx-4 p-5 space-y-3">
                    <h3 class="text-sm font-semibold text-default">Edit Samba Global Settings</h3>
                    <div>
                        <label class="text-xs font-medium text-gray-400 mb-1 block">Workgroup</label>
                        <input v-model="sambaGlobalEdit.workgroup" type="text"
                            class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none focus:border-blue-400" />
                    </div>
                    <div>
                        <label class="text-xs font-medium text-gray-400 mb-1 block">Server String</label>
                        <input v-model="sambaGlobalEdit['server string']" type="text"
                            class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none focus:border-blue-400" />
                    </div>
                    <div>
                        <label class="text-xs font-medium text-gray-400 mb-1 block">Log Level</label>
                        <input v-model="sambaGlobalEdit['log level']" type="text" placeholder="1"
                            class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none focus:border-blue-400" />
                    </div>
                    <div class="flex justify-end gap-2 pt-1">
                        <button class="btn btn-sm btn-secondary h-fit" @click="showEditSambaGlobal = false">Cancel</button>
                        <button class="btn btn-sm btn-primary h-fit" :disabled="mgmt.busy.value"
                            @click="doEditSambaGlobal">Save</button>
                    </div>
                </div>
            </div>

            <!-- Set Samba Password -->
            <div v-if="showSetSambaPasswordFor" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @mousedown.self="showSetSambaPasswordFor = null">
                <div class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-xl max-w-sm w-full mx-4 p-5 space-y-3">
                    <h3 class="text-sm font-semibold text-default">Samba Password for {{ showSetSambaPasswordFor }}</h3>
                    <div>
                        <label class="text-xs font-medium text-gray-400 mb-1 block">New Samba Password</label>
                        <input v-model="modalPassword" type="password" placeholder="••••••••"
                            class="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-default outline-none focus:border-blue-400" />
                    </div>
                    <div class="flex justify-end gap-2 pt-1">
                        <button class="btn btn-sm btn-secondary h-fit" @click="showSetSambaPasswordFor = null">Cancel</button>
                        <button class="btn btn-sm btn-primary h-fit" :disabled="!modalPassword || mgmt.busy.value"
                            @click="doSetSambaPassword">Save</button>
                    </div>
                </div>
            </div>

            <!-- Confirm destructive action -->
            <div v-if="confirmAction" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @mousedown.self="confirmAction = null">
                <div class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-xl max-w-sm w-full mx-4 p-5 space-y-3">
                    <h3 class="text-sm font-semibold text-default">{{ confirmAction.title }}</h3>
                    <p class="text-sm text-gray-500">{{ confirmAction.message }}</p>
                    <div class="flex justify-end gap-2 pt-1">
                        <button class="btn btn-sm btn-secondary h-fit" @click="confirmAction = null">Cancel</button>
                        <button class="btn btn-sm h-fit bg-red-500 hover:bg-red-600 text-white border-red-500"
                            :disabled="mgmt.busy.value"
                            @click="confirmAction.onConfirm(); confirmAction = null">{{ confirmAction.confirmLabel }}</button>
                    </div>
                </div>
            </div>
        </Teleport>

        <!-- Reboot confirmation modal -->
        <Teleport to="body">
            <div v-if="showRebootPrompt" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
                @mousedown.self="showRebootPrompt = false">
                <div class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-xl max-w-sm w-full mx-4 p-5 space-y-4">
                    <h3 class="text-sm font-semibold text-default">Reboot Required</h3>
                    <p class="text-sm text-gray-500">
                        The hostname was changed. A reboot is recommended for the change to take full effect.
                    </p>
                    <div class="flex justify-end gap-2">
                        <button class="btn btn-sm btn-secondary h-fit" @click="showRebootPrompt = false">Later</button>
                        <button class="btn btn-sm h-fit bg-amber-500 hover:bg-amber-600 text-white border-amber-500"
                            @click="rebootServer">
                            Reboot Now
                        </button>
                    </div>
                </div>
            </div>
        </Teleport>

        <!-- Wire Wizard Pairing Modal -->
        <PairRemoteServerModal
            v-if="showPairModal"
            :show="showPairModal"
            :server-host="server?.host || ''"
            :server-username="server?.username || 'root'"
            :server-name="server?.name || server?.host"
            @close="showPairModal = false"
            @paired="onTunnelPaired()"
        />

        <!-- Tunnel Manage Modal -->
        <TunnelManageModal
            v-if="managedTunnel"
            :show="!!managedTunnel"
            :tunnel="managedTunnel"
            :ww="ww"
            @close="managedTunnel = null"
            @changed="managedTunnel = null; loadVpnStatus()"
            @removed="managedTunnel = null; loadVpnStatus()"
        />
    </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
    ArrowLeftIcon, ArrowPathIcon, PencilIcon, ServerIcon,
    ExclamationTriangleIcon, XMarkIcon, PlusIcon,
    GlobeAltIcon, CircleStackIcon, UsersIcon, ShareIcon, CpuChipIcon,
    LinkIcon,
} from '@heroicons/vue/24/outline'
import { useHeader } from '../composables/useHeader'
import { useServers, type StoredServer } from '../composables/useServers'
import { useServerManage } from '../composables/useServerManage'
import { useWireWizard, type WireWizardStatus } from '../composables/useWireWizard'
import { Notification, pushNotification } from '@45drives/houston-common-ui'
import type { ServerProbeResult, StagedChange } from '../../main/ipc/serverManageHandlers'
import PairRemoteServerModal from '../components/PairRemoteServerModal.vue'
import TunnelManageModal from '../components/TunnelManageModal.vue'
import BackupTopologyMap from '../components/topology/BackupTopologyMap.vue'

useHeader('Server Management')

const route = useRoute()
const router = useRouter()
const { savedServers, updateServer, refresh: refreshServers } = useServers()

// ── Tab definitions ────────────────────────────────────────────────────────

const tabs = [
    { id: 'connection' as const, label: 'Connection', icon: LinkIcon },
    { id: 'network' as const, label: 'Network', icon: GlobeAltIcon },
    { id: 'storage' as const, label: 'Storage', icon: CircleStackIcon },
    { id: 'users' as const, label: 'Users & Groups', icon: UsersIcon },
    { id: 'samba' as const, label: 'Samba', icon: ShareIcon },
    { id: 'system' as const, label: 'System', icon: CpuChipIcon },
]

type TabId = typeof tabs[number]['id']
const activeTab = ref<TabId>('connection')

// ── Server data ────────────────────────────────────────────────────────────

const server = computed<StoredServer | undefined>(() =>
    savedServers.value.find(s => s.id === route.params.id)
)

const probing = ref(false)
const probeError = ref('')
const probe = ref<ServerProbeResult | null>(null)

// ── VPN / Wire Wizard ──────────────────────────────────────────────────────

const vpnLoading = ref(false)
const vpnStatus = ref<WireWizardStatus | null>(null)
const showPairModal = ref(false)
const managedTunnel = ref<WireWizardStatus['interfaces'][number] | null>(null)

const ww = useWireWizard(
    () => server.value?.host || '',
    () => server.value?.username || 'root',
)

async function loadVpnStatus() {
    vpnLoading.value = true
    const result = await ww.fetchStatus()
    vpnStatus.value = result
    vpnLoading.value = false
}

async function teardownTunnel(iface: string) {
    const ok = await ww.teardown(iface)
    if (ok) {
        pushNotification(new Notification('Removed', `Tunnel ${iface} removed.`, 'success', 4000))
        await loadVpnStatus()
    } else {
        pushNotification(new Notification('Error', ww.lastError.value || 'Teardown failed', 'error', 5000))
    }
}

async function onTunnelPaired() {
    showPairModal.value = false
    await loadVpnStatus()
    // Re-fetch after 5s to catch the handshake (takes a few seconds to establish)
    setTimeout(() => loadVpnStatus(), 5000)
}

function formatBytes(bytes: number): string {
    if (!bytes || bytes < 1024) return `${bytes || 0} B`
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
    return `${(bytes / 1073741824).toFixed(2)} GB`
}

// ── Edit mode ──────────────────────────────────────────────────────────────

const editing = ref(false)
const applying = ref(false)
const showRebootPrompt = ref(false)
const rebooting = ref(false)
let rebootPollTimer: ReturnType<typeof setTimeout> | null = null
const stagedChanges = ref<StagedChange[]>([])

const editForm = ref({
    name: '',
    hostname: '',
    username: '',
    password: '',
    shareName: '',
    smbUser: '',
    smbPass: '',
})

function initEditForm() {
    const s = server.value
    editForm.value = {
        name: s?.name || '',
        hostname: probe.value?.hostname || s?.hostname || '',
        username: s?.username || '',
        password: '',
        shareName: s?.shareName || '',
        smbUser: s?.smbUser || '',
        smbPass: '',
    }
}

function cancelEditing() {
    editing.value = false
    stagedChanges.value = []
    initEditForm()
}

function clearAllChanges() {
    stagedChanges.value = []
    initEditForm()
}

// ── Staging logic ──────────────────────────────────────────────────────────

let changeCounter = 0

function stageChange(change: {
    field: string;
    tab: string;
    label: string;
    oldValue: string;
    newValue: string;
    type: 'local' | 'remote';
}) {
    // Don't stage if value hasn't actually changed
    if (change.oldValue === change.newValue) {
        // Remove existing staged change for this field if reverted
        stagedChanges.value = stagedChanges.value.filter(c => c.field !== change.field)
        return
    }

    // Replace existing change for same field, or add new
    const existing = stagedChanges.value.findIndex(c => c.field === change.field)
    const entry: StagedChange = {
        id: `change-${++changeCounter}`,
        ...change,
    }

    if (existing >= 0) {
        stagedChanges.value[existing] = entry
    } else {
        stagedChanges.value.push(entry)
    }
}

function unstageChange(id: string) {
    const change = stagedChanges.value.find(c => c.id === id)
    if (change) {
        if (change.field.startsWith('dataset-prop:')) {
            // Reset dataset prop edit value
            const parts = change.field.split(':')
            const prop = parts[2]
            datasetPropEdits[prop] = change.oldValue
            // Reset quota/refreservation number+unit
            if (prop === 'quota') {
                const q = parseZfsSize(change.oldValue)
                quotaNum.value = q.num; quotaUnit.value = q.unit
            } else if (prop === 'refreservation') {
                const r = parseZfsSize(change.oldValue)
                refresNum.value = r.num; refresUnit.value = r.unit
            }
        } else {
            // Reset the edit form field to original value
            const key = change.field as keyof typeof editForm.value
            if (key in editForm.value) {
                if (key === 'password' || key === 'smbPass') {
                    editForm.value[key] = ''
                } else {
                    editForm.value[key] = change.oldValue
                }
            }
        }
    }
    stagedChanges.value = stagedChanges.value.filter(c => c.id !== id)
}

// ── Probe ──────────────────────────────────────────────────────────────────

async function probeServer() {
    const s = server.value
    if (!s) return

    probing.value = true
    probeError.value = ''

    try {
        // Get credentials from credential store
        const cred = await window.electron.ipcRenderer.invoke('cred:get-for', s.host)
        if (!cred?.password && !cred?.sshKeyPath) {
            probeError.value = 'No stored credentials found. Please update the server password.'
            return
        }

        const result = await window.electron.ipcRenderer.invoke('server:probe', {
            host: s.host,
            username: s.username,
            password: cred.password || '',
        })

        if (result.success) {
            probe.value = result.data
            initEditForm()
        } else {
            probeError.value = result.error || 'Failed to probe server.'
        }
    } catch (e: any) {
        probeError.value = e?.message || 'Failed to connect to server.'
    } finally {
        probing.value = false
    }
}

// ── Apply changes ──────────────────────────────────────────────────────────

async function applyChanges() {
    const s = server.value
    if (!s || stagedChanges.value.length === 0) return

    applying.value = true

    try {
        const localChanges = stagedChanges.value.filter(c => c.type === 'local')
        const datasetPropChanges = stagedChanges.value.filter(c => c.field.startsWith('dataset-prop:'))
        const remoteChanges = stagedChanges.value.filter(c => c.type === 'remote' && !c.field.startsWith('dataset-prop:'))

        // Apply local changes (update stored server)
        if (localChanges.length > 0) {
            const updatePayload: Record<string, string | undefined> = {}
            for (const c of localChanges) {
                const val = c.newValue.trim()
                if (c.field === 'password' || c.field === 'smbPass') {
                    if (val) updatePayload[c.field] = val
                } else {
                    updatePayload[c.field] = val || undefined
                }
            }
            await updateServer(s.id, updatePayload)
        }

        // Apply dataset property changes via server:manage IPC
        if (datasetPropChanges.length > 0) {
            const dpResult = await applyDatasetPropChanges(datasetPropChanges)
            if (dpResult.applied.length > 0) {
                pushNotification(new Notification(
                    'Dataset Properties Updated',
                    `${dpResult.applied.length} property change(s) applied.`,
                    'success'
                ))
            }
            if (dpResult.failed.length > 0) {
                pushNotification(new Notification(
                    'Some Dataset Property Changes Failed',
                    dpResult.failed.map(f => `${f.label}: ${f.error}`).join(', '),
                    'error',
                    10000
                ))
            }
        }

        // Apply remote changes (SSH to server)
        if (remoteChanges.length > 0) {
            const cred = await window.electron.ipcRenderer.invoke('cred:get-for', s.host)
            if (!cred?.password) {
                pushNotification(new Notification('Error', 'No stored credentials found.', 'error'))
                return
            }

            // Serialize to plain objects for IPC (Vue reactive proxies can't be cloned)
            const plainChanges = remoteChanges.map(c => ({
                id: c.id, tab: c.tab, label: c.label, field: c.field,
                oldValue: c.oldValue, newValue: c.newValue, type: c.type,
            }))

            const result = await window.electron.ipcRenderer.invoke('server:apply-changes', {
                host: s.host,
                username: s.username,
                password: cred.password,
                changes: plainChanges,
            })

            if (result.applied.length > 0) {
                pushNotification(new Notification(
                    'Changes Applied',
                    `${result.applied.length} change(s) applied to server.`,
                    'success'
                ))
            }

            if (result.failed.length > 0) {
                pushNotification(new Notification(
                    'Some Changes Failed',
                    result.failed.map((f: { label: string; error: string }) => `${f.label}: ${f.error}`).join(', '),
                    'error',
                    10000
                ))
            }

            // If hostname was changed, update local hostname record (not nickname)
            const hostnameChange = remoteChanges.find(c => c.field === 'hostname')
            if (hostnameChange && result.applied.includes(hostnameChange.label)) {
                await updateServer(s.id, {
                    hostname: hostnameChange.newValue.trim(),
                })
            }

            if (result.rebootRequired) {
                showRebootPrompt.value = true
            }
        }

        // Success — clear staged changes and refresh
        stagedChanges.value = []
        editing.value = false
        await refreshServers()
        // Reload dataset props if any were changed
        if (datasetPropChanges.length > 0 && selectedDatasetName.value) {
            viewDatasetProps(selectedDatasetName.value)
        }
        if (!showRebootPrompt.value) {
            pushNotification(new Notification('Saved', 'Server settings updated.', 'success', 3000))
        }
    } catch (e: any) {
        pushNotification(new Notification('Error', e?.message || 'Failed to apply changes.', 'error'))
    } finally {
        applying.value = false
    }
}

async function rebootServer() {
    const s = server.value
    if (!s) return

    showRebootPrompt.value = false
    rebooting.value = true

    try {
        const cred = await window.electron.ipcRenderer.invoke('cred:get-for', s.host)
        await window.electron.ipcRenderer.invoke('server:reboot', {
            host: s.host,
            username: s.username,
            password: cred?.password || '',
        })
    } catch {
        // Connection drop during reboot is expected
    }

    // Poll until the server comes back
    pollForReboot()
}

function pollForReboot() {
    if (rebootPollTimer) clearTimeout(rebootPollTimer)

    const tryProbe = async () => {
        const s = server.value
        if (!s || !rebooting.value) return

        try {
            const cred = await window.electron.ipcRenderer.invoke('cred:get-for', s.host)
            if (!cred?.password) { scheduleRetry(); return }

            const result = await window.electron.ipcRenderer.invoke('server:probe', {
                host: s.host,
                username: s.username,
                password: cred.password,
            })

            if (result.success) {
                rebooting.value = false
                probe.value = result.data
                initEditForm()
                pushNotification(new Notification('Server Online', `${s.name || s.host} is back online.`, 'success', 5000))
                return
            }
        } catch {
            // Still rebooting
        }
        scheduleRetry()
    }

    const scheduleRetry = () => {
        rebootPollTimer = setTimeout(tryProbe, 5000)
    }

    // Initial delay before first poll (give server time to go down)
    rebootPollTimer = setTimeout(tryProbe, 8000)
}

// ── Server Management actions ──────────────────────────────────────────────

const mgmt = useServerManage(
    () => server.value?.host || '',
    () => server.value?.username || '',
)

// Storage state
const poolStatusMap = reactive<Record<string, string>>({})
const selectedDatasetName = ref<string | null>(null)
const selectedDatasetProps = ref<Record<string, { value: string; source: string }> | null>(null)
const datasetPropEdits = reactive<Record<string, string>>({})
const showCreateDataset = ref(false)
const showCreatePool = ref(false)
const newDataset = reactive({ parent: '', name: '', compression: 'lz4', quotaNum: '' as string | number, quotaUnit: 'none', recordsize: '128K', refresNum: '' as string | number, refresUnit: 'none' })
const newPool = reactive({ name: '', vdevType: 'mirror' })
const selectedNewPoolDisks = ref<Set<string>>(new Set())
const availableDisks = ref<{ name: string; size: string; model?: string; type?: string; alias?: string; health?: string; temp?: string }[]>([])
const loadingDisks = ref(false)

// User state
const showAddUser = ref(false)
const showSetPasswordFor = ref<string | null>(null)
const showSshKeyFor = ref<string | null>(null)
const showAddGroup = ref(false)
const newUser = reactive({ username: '', password: '', selectedGroups: new Set(['smbusers']), sshKey: '' })
const modalPassword = ref('')
const modalSshKey = ref('')
const modalGroupName = ref('')

// Group helpers (mirrors bulk setup pattern)
const allGroupNames = computed(() => {
    const names = new Set<string>(['smbusers'])
    if (probe.value) {
        for (const g of probe.value.groups) names.add(g.name)
    }
    return [...names]
})
function isExistingGroup(name: string): boolean {
    return probe.value?.groups.some(g => g.name === name) ?? false
}
function toggleNewUserGroup(group: string) {
    if (newUser.selectedGroups.has(group)) newUser.selectedGroups.delete(group)
    else newUser.selectedGroups.add(group)
}

// Samba state
const showAddShare = ref(false)
const showEditSambaGlobal = ref(false)
const showSetSambaPasswordFor = ref<string | null>(null)
const newShare = reactive({ name: '', path: '', browseable: true, guestOk: false })
const sambaGlobalEdit = reactive<Record<string, string>>({})

// Confirm dialog
const confirmAction = ref<{ title: string; message: string; confirmLabel: string; onConfirm: () => void } | null>(null)

// ── Storage actions ──────────────────────────────────────────────────────

async function viewPoolStatus(pool: string) {
    if (poolStatusMap[pool]) { delete poolStatusMap[pool]; return }
    const r = await mgmt.getPoolStatus(pool)
    if (r.success) poolStatusMap[pool] = r.data.raw
}

// Curated dataset properties to show (user-friendly subset)
const CURATED_DATASET_PROPS = ['mountpoint', 'quota', 'compression', 'recordsize', 'refreservation']
const PROP_LABELS: Record<string, string> = {
    mountpoint: 'Mount Point',
    quota: 'Quota',
    compression: 'Compression',
    recordsize: 'Record Size',
    refreservation: 'Reserved Space',
}
function friendlyPropName(prop: string): string {
    return PROP_LABELS[prop] || prop
}

// Quota / refreservation number+unit state
const quotaNum = ref<number | string>('')
const quotaUnit = ref('none')
const refresNum = ref<number | string>('')
const refresUnit = ref('none')

function parseZfsSize(val: string): { num: number | string; unit: string } {
    if (!val || val === 'none' || val === '0') return { num: '', unit: 'none' }
    const m = val.match(/^([\d.]+)([KMGTP])/i)
    if (m) return { num: parseFloat(m[1]), unit: m[2].toUpperCase() }
    // Raw bytes
    const bytes = parseInt(val, 10)
    if (!isNaN(bytes) && bytes > 0) {
        if (bytes >= 1024 ** 4) return { num: +(bytes / 1024 ** 4).toFixed(2), unit: 'T' }
        if (bytes >= 1024 ** 3) return { num: +(bytes / 1024 ** 3).toFixed(2), unit: 'G' }
        if (bytes >= 1024 ** 2) return { num: +(bytes / 1024 ** 2).toFixed(2), unit: 'M' }
        return { num: bytes, unit: 'M' }
    }
    return { num: '', unit: 'none' }
}

function stageQuotaProp(prop: 'quota' | 'refreservation') {
    const num = prop === 'quota' ? quotaNum.value : refresNum.value
    const unit = prop === 'quota' ? quotaUnit.value : refresUnit.value
    const value = unit === 'none' || !num ? 'none' : `${num}${unit}`
    if (selectedDatasetName.value) {
        stageDatasetProp(prop, value)
    }
}

function stageDatasetProp(prop: string, value: string) {
    if (!selectedDatasetName.value || !selectedDatasetProps.value) return
    const oldValue = selectedDatasetProps.value[prop]?.value || ''
    const field = `dataset-prop:${selectedDatasetName.value}:${prop}`
    stageChange({
        field,
        tab: 'Storage',
        label: `${selectedDatasetName.value} → ${prop}`,
        oldValue,
        newValue: value,
        type: 'remote',
    })
}

async function applyDatasetPropChanges(changes: StagedChange[]): Promise<{ applied: string[]; failed: Array<{ label: string; error: string }> }> {
    const applied: string[] = []
    const failed: Array<{ label: string; error: string }> = []
    for (const c of changes) {
        // field format: dataset-prop:<dataset>:<property>
        const parts = c.field.split(':')
        const dataset = parts[1]
        const property = parts[2]
        const r = await mgmt.run('zfs:dataset-set-prop', { name: dataset, property, value: c.newValue })
        if (r.success) {
            applied.push(c.label)
        } else {
            failed.push({ label: c.label, error: r.error || 'Failed' })
        }
    }
    return { applied, failed }
}

async function viewDatasetProps(name: string) {
    if (selectedDatasetName.value === name) { selectedDatasetProps.value = null; selectedDatasetName.value = null; return }
    const r = await mgmt.getDatasetProps(name)
    if (r.success) {
        selectedDatasetName.value = name
        // Only show curated props
        const filtered: Record<string, { value: string; source: string }> = {}
        for (const prop of CURATED_DATASET_PROPS) {
            if (r.data[prop]) filtered[prop] = r.data[prop]
        }
        selectedDatasetProps.value = filtered
        // Pre-fill edit values
        for (const [k, v] of Object.entries(filtered)) {
            datasetPropEdits[k] = (v as { value: string }).value
        }
        // Parse quota/refreservation into number + unit
        const q = parseZfsSize(filtered.quota?.value || '')
        quotaNum.value = q.num; quotaUnit.value = q.unit
        const rr = parseZfsSize(filtered.refreservation?.value || '')
        refresNum.value = rr.num; refresUnit.value = rr.unit
    }
}

async function doCreateDataset() {
    const fullName = `${newDataset.parent}/${newDataset.name.trim()}`
    const properties: Record<string, string> = { compression: newDataset.compression }
    if (newDataset.recordsize) properties.recordsize = newDataset.recordsize
    // Build quota from number+unit
    if (newDataset.quotaUnit !== 'none' && newDataset.quotaNum) {
        properties.quota = `${newDataset.quotaNum}${newDataset.quotaUnit}`
    }
    if (newDataset.refresUnit !== 'none' && newDataset.refresNum) {
        properties.refreservation = `${newDataset.refresNum}${newDataset.refresUnit}`
    }
    const r = await mgmt.runWithNotify('zfs:dataset-create', { name: fullName, properties }, `Dataset "${fullName}" created.`)
    if (r.success) {
        showCreateDataset.value = false
        newDataset.name = ''; newDataset.compression = 'lz4'; newDataset.recordsize = '128K'
        newDataset.quotaNum = ''; newDataset.quotaUnit = 'none'
        newDataset.refresNum = ''; newDataset.refresUnit = 'none'
        probeServer()
    }
}

async function openCreatePool() {
    showCreatePool.value = true
    selectedNewPoolDisks.value = new Set()
    loadingDisks.value = true
    const r = await mgmt.run('zfs:list-disks', {})
    loadingDisks.value = false
    if (r.success) {
        availableDisks.value = r.data.available || []
    }
}

function togglePoolDisk(name: string) {
    const s = selectedNewPoolDisks.value
    if (s.has(name)) s.delete(name)
    else s.add(name)
    selectedNewPoolDisks.value = new Set(s)
}

async function doCreatePool() {
    const disks = availableDisks.value
        .filter(d => selectedNewPoolDisks.value.has(d.name))
        .map(d => ({ name: d.name, alias: d.alias }))
    const r = await mgmt.runWithNotify('zfs:pool-create', {
        name: newPool.name.trim(), vdevType: newPool.vdevType, disks,
    }, `Pool "${newPool.name}" created.`)
    if (r.success) { showCreatePool.value = false; newPool.name = ''; selectedNewPoolDisks.value = new Set(); probeServer() }
}

function confirmDestroyDataset(name: string) {
    confirmAction.value = {
        title: 'Delete Dataset?',
        message: `This will permanently destroy "${name}" and all its data. This cannot be undone.`,
        confirmLabel: 'Delete',
        onConfirm: async () => {
            const r = await mgmt.runWithNotify('zfs:dataset-destroy', { name }, `Dataset "${name}" deleted.`)
            if (r.success) probeServer()
        },
    }
}

// ── User actions ─────────────────────────────────────────────────────────

async function doAddUser() {
    const groups = [...newUser.selectedGroups]
    const r = await mgmt.runWithNotify('user:add', {
        username: newUser.username.trim(), password: newUser.password || undefined, groups,
    }, `User "${newUser.username}" created.`)
    if (r.success) {
        // If SSH key provided, add it too
        if (newUser.sshKey.trim()) {
            await mgmt.runWithNotify('user:add-ssh-key', {
                username: newUser.username.trim(), publicKey: newUser.sshKey.trim(),
            }, `SSH key added for "${newUser.username}".`)
        }
        showAddUser.value = false
        newUser.username = ''; newUser.password = ''; newUser.sshKey = ''
        newUser.selectedGroups = new Set(['smbusers'])
        probeServer()
    }
}

async function doSetPassword() {
    if (!showSetPasswordFor.value) return
    const r = await mgmt.runWithNotify('user:set-password', {
        username: showSetPasswordFor.value, password: modalPassword.value,
    }, `Password updated for "${showSetPasswordFor.value}".`)
    if (r.success) { showSetPasswordFor.value = null; modalPassword.value = '' }
}

async function doAddSshKey() {
    if (!showSshKeyFor.value) return
    const r = await mgmt.runWithNotify('user:add-ssh-key', {
        username: showSshKeyFor.value, publicKey: modalSshKey.value,
    }, `SSH key added for "${showSshKeyFor.value}".`)
    if (r.success) { showSshKeyFor.value = null; modalSshKey.value = '' }
}

function confirmDeleteUser(username: string) {
    confirmAction.value = {
        title: 'Delete User?',
        message: `This will delete user "${username}". Their home directory will NOT be removed. Backup tasks using this user may stop working.`,
        confirmLabel: 'Delete User',
        onConfirm: async () => {
            const r = await mgmt.runWithNotify('user:delete', { username }, `User "${username}" deleted.`)
            if (r.success) probeServer()
        },
    }
}

async function doAddGroup() {
    const r = await mgmt.runWithNotify('group:add', { name: modalGroupName.value.trim() }, `Group "${modalGroupName.value}" created.`)
    if (r.success) { showAddGroup.value = false; modalGroupName.value = ''; probeServer() }
}

function confirmDeleteGroup(name: string) {
    confirmAction.value = {
        title: 'Delete Group?',
        message: `This will delete the group "${name}". Users currently in this group will be unaffected.`,
        confirmLabel: 'Delete Group',
        onConfirm: async () => {
            const r = await mgmt.runWithNotify('group:delete', { name }, `Group "${name}" deleted.`)
            if (r.success) probeServer()
        },
    }
}

// ── Samba actions ────────────────────────────────────────────────────────

function openEditSambaGlobal() {
    if (probe.value) {
        sambaGlobalEdit['workgroup'] = probe.value.samba.global['workgroup'] || 'WORKGROUP'
        sambaGlobalEdit['server string'] = probe.value.samba.global['server string'] || ''
        sambaGlobalEdit['log level'] = probe.value.samba.global['log level'] || '1'
    }
    showEditSambaGlobal.value = true
}

async function doAddShare() {
    const r = await mgmt.runWithNotify('samba:share-add', {
        name: newShare.name.trim(), path: newShare.path.trim(),
        browseable: newShare.browseable, guestOk: newShare.guestOk,
    }, `Share "[${newShare.name}]" created.`)
    if (r.success) { showAddShare.value = false; newShare.name = ''; newShare.path = ''; probeServer() }
}

function confirmRemoveShare(name: string) {
    confirmAction.value = {
        title: 'Remove Samba Share?',
        message: `This will remove the share "[${name}]" from the Samba configuration. The files on disk will NOT be deleted.`,
        confirmLabel: 'Remove Share',
        onConfirm: async () => {
            const r = await mgmt.runWithNotify('samba:share-remove', { name }, `Share "[${name}]" removed.`)
            if (r.success) probeServer()
        },
    }
}

async function doEditSambaGlobal() {
    const settings: Record<string, string> = {}
    for (const [k, v] of Object.entries(sambaGlobalEdit)) {
        if (v.trim()) settings[k] = v.trim()
    }
    const r = await mgmt.runWithNotify('samba:global-edit', { settings }, 'Samba global settings updated.')
    if (r.success) { showEditSambaGlobal.value = false; probeServer() }
}

async function doSetSambaPassword() {
    if (!showSetSambaPasswordFor.value) return
    const r = await mgmt.runWithNotify('samba:set-user-password', {
        username: showSetSambaPasswordFor.value, password: modalPassword.value,
    }, `Samba password set for "${showSetSambaPasswordFor.value}".`)
    if (r.success) { showSetSambaPasswordFor.value = null; modalPassword.value = ''; probeServer() }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

onMounted(() => {
    if (server.value) {
        probeServer()
        loadVpnStatus()
    }
})

onBeforeUnmount(() => {
    if (rebootPollTimer) clearTimeout(rebootPollTimer)
})

watch(server, (s) => {
    if (s && !editing.value) initEditForm()
}, { immediate: true })
</script>

<!-- ═══ Inline sub-components ═══ -->

<script lang="ts">
import { defineComponent, h, ref, watch, type PropType } from 'vue'
import { EyeIcon, EyeSlashIcon } from '@heroicons/vue/20/solid'

/** Read-only info row */
const InfoRow = defineComponent({
    name: 'InfoRow',
    props: {
        label: { type: String, required: true },
        value: { type: String, required: true },
    },
    setup(props) {
        return () => h('div', { class: 'flex items-center gap-3 px-3 py-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700' }, [
            h('span', { class: 'text-xs font-medium text-gray-500 dark:text-gray-400 min-w-[120px] shrink-0' }, props.label),
            h('span', { class: 'text-sm text-default truncate' }, props.value),
        ])
    },
})

/** Section divider */
const SectionDivider = defineComponent({
    name: 'SectionDivider',
    props: {
        label: { type: String, required: true },
    },
    setup(props) {
        return () => h('div', { class: 'pt-2 border-t border-neutral-100 dark:border-neutral-700/50' }, [
            h('span', { class: 'text-xs font-semibold text-gray-500 uppercase tracking-wide' }, props.label),
        ])
    },
})

/** Editable field card */
const FieldCard = defineComponent({
    name: 'FieldCard',
    props: {
        label: { type: String, required: true },
        value: { type: String, required: true },
        editing: { type: Boolean, default: false },
        editValue: { type: String, default: '' },
        field: { type: String, default: '' },
        tab: { type: String, default: '' },
        type: { type: String as PropType<'local' | 'remote'>, default: 'local' },
        inputType: { type: String, default: 'text' },
    },
    emits: ['update:editValue', 'stage'],
    setup(props, { emit }) {
        const showPassword = ref(false)
        // Local value to avoid controlled-input render-cycle bugs
        const localVal = ref(props.editValue)
        watch(() => props.editValue, (v) => { localVal.value = v })
        watch(() => props.editing, (editing) => { if (editing) localVal.value = props.editValue })

        function onInput(e: Event) {
            const val = (e.target as HTMLInputElement).value
            localVal.value = val
            emit('update:editValue', val)
            emit('stage', {
                field: props.field,
                tab: props.tab,
                label: props.label,
                oldValue: props.value === '••••••••' ? '' : props.value,
                newValue: val,
                type: props.type,
            })
        }

        return () => {
            const labelEl = h('label', { class: 'text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block' }, props.label)

            if (!props.editing) {
                return h('div', {}, [
                    labelEl,
                    h('div', { class: 'px-3 py-1.5 text-sm text-default bg-neutral-100 dark:bg-neutral-900/50 rounded-lg border border-neutral-200/80 dark:border-neutral-700 text-gray-600 dark:text-gray-300' },
                        props.value || '—'
                    ),
                ])
            }

            const isPassword = props.inputType === 'password'
            const inputEl = h('input', {
                value: localVal.value,
                type: isPassword && !showPassword.value ? 'password' : 'text',
                placeholder: props.value === '••••••••' ? 'Leave blank to keep current' : props.value,
                class: 'w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-neutral-900 border border-blue-300 dark:border-blue-600/50 text-default placeholder:text-gray-400 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30' + (isPassword ? ' pr-9' : ''),
                onInput,
            })

            if (isPassword) {
                const toggleBtn = h('button', {
                    type: 'button',
                    class: 'absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-default',
                    onClick: () => { showPassword.value = !showPassword.value },
                }, [
                    h(showPassword.value ? EyeSlashIcon : EyeIcon, { class: 'w-4 h-4' }),
                ])
                return h('div', {}, [
                    labelEl,
                    h('div', { class: 'relative' }, [inputEl, toggleBtn]),
                ])
            }

            return h('div', {}, [labelEl, inputEl])
        }
    },
})

export default {}
</script>

<style scoped>
.slide-panel-enter-active,
.slide-panel-leave-active {
    transition: transform 0.2s ease, opacity 0.2s ease;
}
.slide-panel-enter-from,
.slide-panel-leave-to {
    transform: translateX(100%);
    opacity: 0;
}
</style>
