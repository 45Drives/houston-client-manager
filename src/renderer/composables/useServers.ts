/**
 * useServers — Unified server list composable
 *
 * Single source of truth for all stored servers (host + share + user combinations).
 * Merges stored server entries with live discovery online status.
 * Used by: Dashboard, Backup task creation, Manage Connections, Settings.
 */
import { ref, computed, inject, watch } from 'vue'
import { Notification, pushNotification } from '@45drives/houston-common-ui'
import { discoveryStateInjectionKey } from '../keys/injection-keys'
import type { DiscoveryState } from '../types'

export interface StoredServer {
  id: string
  host: string
  shareName: string
  /** Admin/cockpit login username */
  username: string
  name?: string
  /** Resolved hostname (e.g. greenbastard.local) */
  hostname?: string
  /** Resolved IP address */
  ip?: string
  /** SMB username for local backups (may differ from login username) */
  smbUser?: string
  favorite?: boolean
  lastUsedAt?: number
  createdAt?: string
  updatedAt?: string
  /** Transient — merged from discovery state, not stored */
  online?: boolean
  /** Transient — from discovery, indicates server has been set up */
  setupComplete?: boolean
  /** True when server comes from discovery only (not explicitly saved by user) */
  discovered?: boolean
}

// Module-level cache so multiple components share the same reactive state
const _servers = ref<StoredServer[]>([])
const _loaded = ref(false)
let _refreshPromise: Promise<void> | null = null

// Module-level watcher state (shared across all useServers() calls)
let _watcherRegistered = false
const _prevOnline = new Map<string, boolean>()
const _syncedNames = new Map<string, string>()

export function useServers() {
  const discoveryState = inject<DiscoveryState>(discoveryStateInjectionKey, undefined as any)

  async function refresh(): Promise<StoredServer[]> {
    if (_refreshPromise) await _refreshPromise
    _refreshPromise = (async () => {
      try {
        const raw: StoredServer[] = await window.electron.ipcRenderer.invoke('servers:list') ?? []
        _servers.value = raw
        _loaded.value = true
      } catch (e) {
        console.error('useServers: Failed to load servers:', e)
      }
    })()
    await _refreshPromise
    _refreshPromise = null
    return _servers.value
  }

  // Merge online status from discovery + include discovered-only servers
  const servers = computed<StoredServer[]>(() => {
    if (!discoveryState) return _servers.value

    // Start with stored servers, enriched with online status
    const merged: StoredServer[] = _servers.value.map(s => ({
      ...s,
      discovered: false,
      online: discoveryState.servers.some(d => d.ip === s.host || d.name === s.host),
    }))

    // Add discovered servers that have no stored entry (by IP match)
    const storedHosts = new Set(_servers.value.map(s => s.host))
    for (const d of discoveryState.servers) {
      if (storedHosts.has(d.ip)) continue
      // Also check by hostname
      if (d.name && storedHosts.has(d.name)) continue

      merged.push({
        id: `discovered:${d.ip}`,
        host: d.ip,
        shareName: d.shareName || '',
        username: '',
        name: d.name || d.serverName || '',
        online: true,
        setupComplete: d.setupComplete,
        discovered: true,
      })
    }

    return merged
  })

  // ── Online-transition notifications + discovery sync ──────────────────
  if (!_watcherRegistered) {
    _watcherRegistered = true
    watch(servers, (list) => {
      if (!discoveryState) return
      for (const s of list) {
        // Only track stored servers (not discovered-only)
        if (s.id.startsWith('discovered:')) continue

        // ── Online transition notification ──
        const prev = _prevOnline.get(s.id)
        if (prev === false && s.online === true) {
          pushNotification(new Notification(
            'Server Back Online',
            `${s.name || s.host} is now reachable.`,
            'success',
            6000
          ))
        }
        _prevOnline.set(s.id, s.online ?? false)

        // ── Sync name from discovery (handles hostname changes after reboot) ──
        if (!s.online) continue
        const disc = discoveryState.servers.find(d => d.ip === s.host || d.name === s.host)
        if (!disc) continue
        const discoveredName = disc.name || disc.serverName || ''
        const discoveredShare = disc.shareName || ''
        // Only sync if discovery has a real name that differs from stored
        if (discoveredName && discoveredName !== disc.ip && discoveredName !== s.name) {
          // Prevent firing the same update repeatedly
          if (_syncedNames.get(s.id) === discoveredName) continue
          _syncedNames.set(s.id, discoveredName)
          // Fire-and-forget update to persist the new name
          window.electron?.ipcRenderer.invoke('servers:update', {
            id: s.id,
            name: discoveredName,
            ...(discoveredShare && !s.shareName ? { shareName: discoveredShare } : {}),
          }).then(() => refresh()).catch(e => console.error('Failed to sync server name:', e))
        }
      }
    }, { deep: true })
  }

  // Convenience filtered views
  /** Only explicitly saved servers (not discovered-only) */
  const savedServers = computed(() => servers.value.filter(s => !s.discovered))

  const favoriteServers = computed(() => servers.value.filter(s => s.favorite))

  const displayServers = computed(() =>
    [...savedServers.value].sort((a, b) => {
      if (a.favorite && !b.favorite) return -1
      if (!a.favorite && b.favorite) return 1
      return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)
    })
  )

  // ── Mutations ──────────────────────────────────────────────────────────

  async function addServer(opts: {
    host: string
    shareName: string
    username: string
    password: string
    name?: string
    favorite?: boolean
  }): Promise<StoredServer> {
    const result = await window.electron.ipcRenderer.invoke('servers:add', opts)
    await refresh()
    return result
  }

  async function updateServer(id: string, opts: {
    host?: string
    hostname?: string
    ip?: string
    shareName?: string
    username?: string
    password?: string
    smbUser?: string
    smbPass?: string
    name?: string
    favorite?: boolean
  }): Promise<void> {
    await window.electron.ipcRenderer.invoke('servers:update', { id, ...opts })
    await refresh()
  }

  async function removeServer(id: string): Promise<void> {
    await window.electron.ipcRenderer.invoke('servers:remove', id)
    await refresh()
  }

  async function setFavorite(id: string, favorite: boolean): Promise<void> {
    await window.electron.ipcRenderer.invoke('servers:set-favorite', id, favorite)
    const s = _servers.value.find(x => x.id === id)
    if (s) s.favorite = favorite
  }

  async function touch(id: string): Promise<void> {
    await window.electron.ipcRenderer.invoke('servers:touch', id)
    const s = _servers.value.find(x => x.id === id)
    if (s) s.lastUsedAt = Date.now()
  }

  // Auto-load on first use
  if (!_loaded.value) refresh()

  return {
    /** All servers: stored + discovered-only */
    servers,
    /** Only explicitly saved servers */
    savedServers,
    displayServers,
    favoriteServers,
    loaded: _loaded,
    refresh,
    addServer,
    updateServer,
    removeServer,
    setFavorite,
    touch,
  }
}
