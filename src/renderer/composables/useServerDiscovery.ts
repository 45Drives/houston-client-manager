// useServerDiscovery.ts
import { reactive, onMounted, onBeforeUnmount } from 'vue'
import type { Server } from '../types'

export function useServerDiscovery() {
  const discoveryState = reactive<{ servers: Server[]; fallbackTriggered: boolean }>({
    servers: [],
    fallbackTriggered: false,
  })

  function onDiscovered(_evt:any, mdnsList: Server[]) {
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
  }

  async function runFallbackScanOnce() {
    if (discoveryState.fallbackTriggered) return
    discoveryState.fallbackTriggered = true
    try {
      const fallback: Server[] = await window.electron.ipcRenderer.invoke('scan-network-fallback')
      const toAdd = fallback.filter(fb => !discoveryState.servers.some(existing => existing.ip === fb.ip))
      if (toAdd.length) {
        discoveryState.servers.push(...toAdd)
        // toast is optional; you can show it where this composable is used
      }
    } catch (err) {
      console.error('Fallback scan failed:', err)
    }
  }

  onMounted(() => {
    window.electron?.ipcRenderer.on('discovered-servers', onDiscovered)
    setTimeout(runFallbackScanOnce, 1200)
  })

  onBeforeUnmount(() => {
    window.electron?.ipcRenderer.removeListener?.('discovered-servers', onDiscovered)
  })

  return { discoveryState }
}
