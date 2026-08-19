import { computed, ref } from 'vue'
import { IPCRouter, type BackUpTask } from '@45drives/houston-common-lib'
import { useServers } from './useServers'

export type TopologyNodeKind = 'client' | 'local-server' | 'remote-server' | 'cloud'
export type TopologyEdgeKind = 'client-backup' | 'rsync' | 'zfs-remote' | 'cloud'

export interface TopologyNode {
  id: string
  kind: TopologyNodeKind
  label: string
  host?: string
  meta?: string
  localPoolToPoolCount?: number
  unreachable?: boolean
}

export interface TopologyEdge {
  id: string
  from: string
  to: string
  kind: TopologyEdgeKind
  label: string
  viaWireGuard?: boolean
}

export interface BackupTopologyGraph {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
  localPoolToPoolDetails: Array<{ serverHost: string; taskName: string; sourceDataset: string; destDataset: string }>
}

interface RemoteRsyncTask {
  name: string
  localPath: string
  remoteHost: string
  remotePort: number
  remoteUser: string
  remotePath: string
  direction: 'push' | 'pull'
}

interface RemoteReplicationTask {
  name: string
  sourceDataset: string
  destDataset: string
  destHost: string
  destUser: string
  destSshPort: number
  direction: 'push' | 'pull'
}

interface CloudSyncTask {
  name: string
  localPath: string
  targetPath: string
  remote: string
  provider: string
  direction: string
}

interface ServerTopologyProbe {
  host: string
  probedAt: number
  reachable: boolean
  error?: string
  identity?: {
    hostname: string
    fqdn: string
    machineId: string
    addresses: string[]
    lanSubnets?: string[]
  }
  rsyncTasks: RemoteRsyncTask[]
  replicationTasks: RemoteReplicationTask[]
  cloudSyncTasks: CloudSyncTask[]
  cloudRemotes: Array<{ name: string; type: string }>
}

interface WireWizardStatus {
  installed: boolean
  configured: boolean
  interfaces: Array<{
    peers: Array<{ endpoint: string }>
  }>
}

function normalizeHost(x?: string | null): string {
  return (x || '').trim().toLowerCase().replace(/\.$/, '')
}

function isIpAddress(value: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value) || value.includes(':')
}

/**
 * Identity keys for a host. Only DNS names get a short-name alias — splitting an
 * IP on `.` would make every `192.*` address collide on the key `192`.
 */
function hostAliasKeys(value?: string | null): string[] {
  const norm = normalizeHost(value)
  if (!norm) return []
  if (isIpAddress(norm)) return [norm]

  const keys = new Set<string>([norm])
  const short = norm.split('.')[0]
  if (short && short !== norm) keys.add(short)
  return [...keys]
}

/** Nicknames are free-form, so only trust them as an alias when they look like a host. */
function isHostLikeAlias(value?: string | null): boolean {
  const norm = normalizeHost(value)
  return !!norm && !/\s/.test(norm)
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let out = 0
  for (const part of parts) {
    const n = Number(part)
    if (!Number.isInteger(n) || n < 0 || n > 255) return null
    out = (out << 8) | n
  }
  return out >>> 0
}

function isInSubnet(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split('/')
  const bits = Number(bitsRaw)
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false

  const ipInt = ipv4ToInt(ip)
  const baseInt = ipv4ToInt(base)
  if (ipInt === null || baseInt === null) return false

  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return ((ipInt & mask) >>> 0) === ((baseInt & mask) >>> 0)
}

function friendlyHostLabel(host: string): string {
  if (!host) return 'Unknown Host'
  return host
}

/** `cloud:`, `cloud:test/`, and `Cloud` all describe the same rclone remote. */
function cloudRemoteKey(value?: string | null): string {
  return (value || '').trim().split(':')[0].trim().toLowerCase()
}

function parseTaskLocalHost(task: BackUpTask): string {
  if (task.host) return task.host
  const target = (task.target || '').trim()
  const idx = target.indexOf(':')
  if (idx > 0) return target.slice(0, idx)
  return ''
}

function parseWireGuardPeerHosts(status: WireWizardStatus | null): string[] {
  if (!status?.interfaces?.length) return []
  const hosts = new Set<string>()
  for (const iface of status.interfaces) {
    for (const peer of iface.peers || []) {
      const endpoint = (peer.endpoint || '').trim()
      if (!endpoint) continue
      const noBrackets = endpoint.replace(/^\[/, '').replace(/\]$/, '')
      const host = noBrackets.split(':')[0]?.trim()
      if (host) hosts.add(normalizeHost(host))
    }
  }
  return [...hosts]
}

async function requestBackupTasks(): Promise<BackUpTask[]> {
  return await new Promise((resolve) => {
    const router = IPCRouter.getInstance()
    const timeout = setTimeout(() => {
      router.removeEventListener('action', onMessage)
      resolve([])
    }, 7000)

    const onMessage = (raw: string) => {
      try {
        const msg = JSON.parse(raw)
        if (msg?.type === 'sendBackupTasks') {
          clearTimeout(timeout)
          router.removeEventListener('action', onMessage)
          resolve(Array.isArray(msg.tasks) ? msg.tasks : [])
        }
      } catch {
        // Ignore non-JSON messages
      }
    }

    router.addEventListener('action', onMessage)
    router.send('backend', 'action', 'requestBackUpTasks')
  })
}

export function useBackupTopology(opts?: { onlyServerHost?: string }) {
  const { savedServers } = useServers()
  const graph = ref<BackupTopologyGraph>({ nodes: [], edges: [], localPoolToPoolDetails: [] })
  const loading = ref(false)
  const error = ref('')
  const lastUpdatedAt = ref<number | null>(null)

  const stats = computed(() => {
    const localServers = graph.value.nodes.filter(n => n.kind === 'local-server').length
    const remoteServers = graph.value.nodes.filter(n => n.kind === 'remote-server').length
    const cloudTargets = graph.value.nodes.filter(n => n.kind === 'cloud').length
    const localPoolToPool = graph.value.localPoolToPoolDetails.length
    return { localServers, remoteServers, cloudTargets, localPoolToPool }
  })

  async function refresh() {
    loading.value = true
    error.value = ''

    try {
      const localHostFilter = normalizeHost(opts?.onlyServerHost)
      const allBackupTasks = await requestBackupTasks()

      const nodes = new Map<string, TopologyNode>()
      const edges = new Map<string, TopologyEdge>()
      const localPoolToPoolDetails: BackupTopologyGraph['localPoolToPoolDetails'] = []

      const addNode = (node: TopologyNode, opts?: { preferLabel?: boolean }) => {
        const existing = nodes.get(node.id)
        if (!existing) {
          nodes.set(node.id, node)
          return
        }
        if (opts?.preferLabel && node.label) existing.label = node.label
        if (node.host && !existing.host) existing.host = node.host
        if (node.meta && !existing.meta) existing.meta = node.meta
        if (node.localPoolToPoolCount) {
          existing.localPoolToPoolCount = (existing.localPoolToPoolCount || 0) + node.localPoolToPoolCount
        }
        if (node.unreachable !== undefined) existing.unreachable = node.unreachable
      }

      const addEdge = (edge: TopologyEdge) => {
        const existing = edges.get(edge.id)
        if (!existing) {
          edges.set(edge.id, edge)
          return
        }
        const currentLabelCount = parseInt(existing.label.match(/\d+/)?.[0] || '1', 10)
        const nextCount = Number.isFinite(currentLabelCount) ? currentLabelCount + 1 : 2
        if (existing.kind === edge.kind) {
          const base = existing.kind === 'client-backup'
            ? 'Client backups'
            : existing.kind === 'rsync'
              ? 'Rsync tasks'
              : existing.kind === 'zfs-remote'
                ? 'ZFS replications'
                : 'Cloud remotes'
          existing.label = `${base}: ${nextCount}`
        }
        if (edge.viaWireGuard) existing.viaWireGuard = true
      }

      const clientIdent = await window.electron.ipcRenderer.invoke('get-client-ident').catch(() => null)
      const clientLabel = clientIdent?.installId
        ? `This Computer (${String(clientIdent.installId).slice(0, 8)})`
        : 'This Computer'
      addNode({ id: 'client:desktop', kind: 'client', label: clientLabel })

      // Any of a server's known identities (host, hostname, ip, nickname) maps to one canonical node.
      const aliasToNodeId = new Map<string, string>()
      const ambiguousAliases = new Set<string>()
      const canonicalLabel = new Map<string, string>()

      // Remote/cloud relationships persisted from previous probes keep the map
      // populated (and identities resolvable) even while a server is offline.
      const cachedIndex: Record<string, ServerTopologyProbe> =
        (await window.electron.ipcRenderer.invoke('topology:get-index').catch(() => ({}))) || {}

      const registerAlias = (alias: string | undefined | null, canonicalId: string) => {
        if (!isHostLikeAlias(alias)) return
        for (const key of hostAliasKeys(alias)) {
          const existing = aliasToNodeId.get(key)
          // An alias claimed by two servers proves nothing, so it must not merge them.
          if (existing && existing !== canonicalId) ambiguousAliases.add(key)
          else aliasToNodeId.set(key, canonicalId)
        }
      }

      for (const s of savedServers.value) {
        const canonicalId = `local:${normalizeHost(s.host)}`
        if (canonicalId === 'local:') continue
        canonicalLabel.set(canonicalId, s.name || s.hostname || s.host)
        for (const alias of [s.host, s.hostname, s.ip, s.name]) registerAlias(alias, canonicalId)

        // Identity reported by the server itself outranks anything we guessed locally.
        const identity = (cachedIndex[normalizeHost(s.host)] || cachedIndex[s.host])?.identity
        if (identity) {
          registerAlias(identity.hostname, canonicalId)
          registerAlias(identity.fqdn, canonicalId)
          for (const addr of identity.addresses || []) registerAlias(addr, canonicalId)
        }
      }
      for (const key of ambiguousAliases) aliasToNodeId.delete(key)

      const resolveLocalNodeId = (host?: string | null): string | null => {
        const keys = hostAliasKeys(host)
        if (keys.length === 0) return null
        for (const key of keys) {
          const match = aliasToNodeId.get(key)
          if (match) return match
        }
        return `local:${keys[0]}`
      }

      const matchesFilter = (host?: string | null): boolean => {
        if (!localHostFilter) return true
        const target = resolveLocalNodeId(localHostFilter)
        return resolveLocalNodeId(host) === target
      }

      const servers = savedServers.value.filter(s => matchesFilter(s.host))

      const backupTasks = allBackupTasks.filter(t => {
        const host = parseTaskLocalHost(t)
        if (!host) return !localHostFilter
        return matchesFilter(host)
      })

      for (const t of backupTasks) {
        const host = parseTaskLocalHost(t)
        const localNodeId = resolveLocalNodeId(host)
        if (!localNodeId) continue

        addNode({
          id: localNodeId,
          kind: 'local-server',
          label: canonicalLabel.get(localNodeId) || friendlyHostLabel(host),
          host,
        })

        addEdge({
          id: `client-backup:${localNodeId}`,
          from: 'client:desktop',
          to: localNodeId,
          kind: 'client-backup',
          label: 'Client backups: 1',
        })
      }

      for (const s of servers) {
        const localHost = s.host
        const localNodeId = resolveLocalNodeId(localHost)
        if (!localNodeId) continue

        addNode({
          id: localNodeId,
          kind: 'local-server',
          label: s.name || s.hostname || localHost,
          host: localHost,
        }, { preferLabel: true })

        const cred = await window.electron.ipcRenderer.invoke('cred:get-for', s.host).catch(() => null)
        const password = cred?.password || ''

        // Only a live probe may draw links; cached data would show backups that no longer exist.
        let probe: ServerTopologyProbe | null = null
        if (password || cred?.sshKeyPath) {
          probe = await window.electron.ipcRenderer
            .invoke('topology:probe-server', { host: s.host, username: s.username })
            .catch(() => null) as ServerTopologyProbe | null
        }

        const reachable = !!probe?.reachable

        if (!reachable) {
          addNode({
            id: localNodeId,
            kind: 'local-server',
            label: s.name || s.hostname || localHost,
            host: localHost,
            unreachable: true,
          })
          continue
        }

        const s2sTasks = probe?.rsyncTasks ?? []
        const zfsTasks = probe?.replicationTasks ?? []
        const cloudSyncTasks = probe?.cloudSyncTasks ?? []
        const cloudRemotes = probe?.cloudRemotes ?? []

        let ww: WireWizardStatus | null = null
        if (password) {
          const wwResult = await window.electron.ipcRenderer
            .invoke('wirewizard:status', { host: s.host, username: s.username, password })
            .catch(() => null) as { success: boolean; data?: WireWizardStatus } | null
          ww = wwResult?.success ? wwResult.data || null : null
        }

        const wgPeerHosts = parseWireGuardPeerHosts(ww)

        addNode({
          id: localNodeId,
          kind: 'local-server',
          label: s.name || s.hostname || localHost,
          host: localHost,
        })

        // A replication peer that is also a saved server should collapse into that node.
        const lanSubnets = probe?.identity?.lanSubnets ?? []
        const resolveTargetNodeId = (
          host: string,
        ): { id: string; isSaved: boolean; kind: TopologyNodeKind } => {
          for (const key of hostAliasKeys(host)) {
            const match = aliasToNodeId.get(key)
            if (match) return { id: match, isSaved: true, kind: 'local-server' }
          }
          // A peer inside one of this server's own subnets is on the same LAN, not remote.
          const norm = normalizeHost(host)
          const onSameLan = lanSubnets.some(cidr => isInSubnet(norm, cidr))
          return onSameLan
            ? { id: `local:${norm}`, isSaved: false, kind: 'local-server' }
            : { id: `remote:${norm}`, isSaved: false, kind: 'remote-server' }
        }

        const isWireGuardPeer = (host: string): boolean => {
          const keys = new Set(hostAliasKeys(host))
          return wgPeerHosts.some(peer => hostAliasKeys(peer).some(k => keys.has(k)))
        }

        for (const task of s2sTasks) {
          const remoteHost = normalizeHost(task.remoteHost)
          if (!remoteHost) continue

          const target = resolveTargetNodeId(task.remoteHost)
          if (target.id === localNodeId) continue

          if (!target.isSaved) {
            addNode({
              id: target.id,
              kind: target.kind,
              label: task.remoteHost,
              host: task.remoteHost,
              meta: `${task.remoteUser}@${task.remoteHost}:${task.remotePort}`,
            })
          }

          const from = task.direction === 'pull' ? target.id : localNodeId
          const to = task.direction === 'pull' ? localNodeId : target.id

          addEdge({
            id: `rsync:${from}:${to}`,
            from,
            to,
            kind: 'rsync',
            label: 'Rsync tasks: 1',
            viaWireGuard: isWireGuardPeer(task.remoteHost),
          })
        }

        for (const task of zfsTasks) {
          const remoteHost = normalizeHost(task.destHost)
          const target = remoteHost ? resolveTargetNodeId(task.destHost) : null

          if (!target || target.id === localNodeId) {
            localPoolToPoolDetails.push({
              serverHost: s.host,
              taskName: task.name,
              sourceDataset: task.sourceDataset,
              destDataset: task.destDataset,
            })
            addNode({
              id: localNodeId,
              kind: 'local-server',
              label: s.name || s.hostname || localHost,
              host: localHost,
              localPoolToPoolCount: 1,
            })
            continue
          }

          if (!target.isSaved) {
            addNode({
              id: target.id,
              kind: target.kind,
              label: task.destHost,
              host: task.destHost,
              meta: `${task.destUser}@${task.destHost}:${task.destSshPort}`,
            })
          }

          const from = task.direction === 'pull' ? target.id : localNodeId
          const to = task.direction === 'pull' ? localNodeId : target.id

          addEdge({
            id: `zfs-remote:${from}:${to}`,
            from,
            to,
            kind: 'zfs-remote',
            label: 'ZFS replications: 1',
            viaWireGuard: isWireGuardPeer(task.destHost),
          })
        }

        const remoteTypeByName = new Map<string, string>()
        for (const remote of cloudRemotes) {
          const key = cloudRemoteKey(remote.name)
          if (key) remoteTypeByName.set(key, remote.type || 'cloud')
        }

        // Configured cloud sync tasks are the real cloud backups.
        for (const task of cloudSyncTasks) {
          const cloudKey = cloudRemoteKey(task.remote) || cloudRemoteKey(task.name)
          if (!cloudKey) continue

          const cloudNodeId = `cloud:${cloudKey}`
          const type = remoteTypeByName.get(cloudKey) || task.provider || 'cloud'
          addNode({
            id: cloudNodeId,
            kind: 'cloud',
            label: cloudKey,
            meta: task.targetPath ? `${type} · ${task.targetPath}` : type,
          })

          const pulling = (task.direction || '').toLowerCase() === 'pull'
          const from = pulling ? cloudNodeId : localNodeId
          const to = pulling ? localNodeId : cloudNodeId

          addEdge({
            id: `cloud:${from}:${to}`,
            from,
            to,
            kind: 'cloud',
            label: 'Cloud syncs: 1',
          })
        }
      }

      graph.value = {
        nodes: [...nodes.values()],
        edges: [...edges.values()],
        localPoolToPoolDetails,
      }
      lastUpdatedAt.value = Date.now()
    } catch (e: any) {
      error.value = e?.message || 'Failed to build topology graph'
    } finally {
      loading.value = false
    }
  }

  return {
    graph,
    stats,
    loading,
    error,
    lastUpdatedAt,
    refresh,
  }
}
