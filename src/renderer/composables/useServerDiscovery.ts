// useServerDiscovery.ts
import { reactive, onMounted, onBeforeUnmount } from 'vue'
import type { Server } from '../types'

export function useServerDiscovery() {
  const discoveryState = reactive<{ servers: Server[]; fallbackTriggered: boolean; loading: boolean }>({
    servers: [],
    fallbackTriggered: false,
    loading: true,
  })

  function onDiscovered(_evt:any, mdnsList: Server[]) {
    // Build set of IPs the main process currently considers active
    const activeIps = new Set(mdnsList.map(m => m.ip))

    // Remove servers no longer in the main process list (timed out / offline)
    // Keep manually-added and fallback servers since main process manages their lifecycle
    for (let i = discoveryState.servers.length - 1; i >= 0; i--) {
      const s = discoveryState.servers[i]
      if (!activeIps.has(s.ip) && !s.manuallyAdded && !s.fallbackAdded) {
        discoveryState.servers.splice(i, 1)
      }
    }

    // Update or add servers from the main process list
    mdnsList.forEach(m => {
      const idx = discoveryState.servers.findIndex(s => s.ip === m.ip)
      if (idx > -1) {
        const current = discoveryState.servers[idx]
        const hasRealHostname = m.name && m.name !== m.ip
        const updated = {
          ...current, ...m,
          name: hasRealHostname ? m.name : current.name,
          fallbackAdded: m.fallbackAdded ?? (hasRealHostname ? false : current.fallbackAdded),
        }
        discoveryState.servers.splice(idx, 1, updated)
      } else {
        discoveryState.servers.push(m)
      }
    })
    discoveryState.servers.sort((a, b) => {
      if (a.name === a.ip && b.name !== b.ip) return 1
      if (a.name !== a.ip && b.name === b.ip) return -1
      return 0
    })
    // An empty push means the sweep dropped a host, not that discovery finished.
    if (discoveryState.servers.length) discoveryState.loading = false
  }

  async function runFallbackScanOnce() {
    if (discoveryState.fallbackTriggered) return
    discoveryState.fallbackTriggered = true
    try {
      const fallback: Server[] = await window.electron.ipcRenderer.invoke('scan-network-fallback')
      const toAdd = fallback.filter(fb => !discoveryState.servers.some(existing => existing.ip === fb.ip))
      if (toAdd.length) {
        discoveryState.servers.push(...toAdd)
      }
    } catch (err) {
      console.error('Fallback scan failed:', err)
    } finally {
      discoveryState.loading = false
    }
  }

  function rescan() {
    discoveryState.loading = true
    discoveryState.fallbackTriggered = false
    discoveryState.servers.splice(0)
    window.electron?.ipcRenderer.invoke('discovery:setEnabled', false).then(() => {
      window.electron?.ipcRenderer.invoke('discovery:setEnabled', true)
    })
    setTimeout(runFallbackScanOnce, 3000)
  }

  onMounted(() => {
    window.electron?.ipcRenderer.on('discovered-servers', onDiscovered)
    window.electron?.ipcRenderer.invoke('discovery:setEnabled', true)
    setTimeout(runFallbackScanOnce, 3000)
  })

  onBeforeUnmount(() => {
    window.electron?.ipcRenderer.removeListener?.('discovered-servers', onDiscovered)
    window.electron?.ipcRenderer.invoke('discovery:setEnabled', false)
  })

  return { discoveryState, rescan }
}
