// useIpcActions.ts
import { onMounted, onBeforeUnmount } from 'vue'
import { router } from '../../app/routes'
import { IPCRouter } from '@45drives/houston-common-lib'
import { useRebootWatcher } from '../composables/useRebootWatcher'
import { useServerCredentials } from '../composables/useServerCredentials'
import { useServers } from '../composables/useServers'
import type { Server } from '../types'

export function useIpcActions(getServer: () => Server | null | undefined) {
  const { waitFor } = useRebootWatcher()
  const { getCredentials } = useServerCredentials()
  const { addServer, refresh } = useServers()
  const ipc = IPCRouter.getInstance()

  /**
   * Auto-save the current server to the credential vault if we have
   * in-memory credentials (from the setup wizard login).
   */
  async function autoSaveCurrentServer() {
    const srv = getServer()
    if (!srv?.ip) return
    const creds = getCredentials(srv.ip)
    if (!creds?.username || !creds?.password) return

    try {
      await addServer({
        host: srv.ip,
        shareName: srv.shareName || '',
        username: creds.username,
        password: creds.password,
        name: srv.name || srv.serverName || srv.ip,
      })
    } catch (e) {
      console.error('useIpcActions: failed to auto-save server:', e)
    }
  }

  async function handleAction(raw: any) {
    const msg = typeof raw === 'string' ? JSON.parse(raw) : raw
    switch (msg.type) {
      case 'show_wizard':
      case 'wizard_go_back': {
        const map: Record<string, string> = { storage: 'setup', backup: 'backup-manage', 'restore-backup': 'restore' }
        await autoSaveCurrentServer()
        if (map[msg.wizard]) router.push({ name: map[msg.wizard] })
        break
      }
      case 'reboot_and_show_wizard': {
        const srv = getServer()
        if (!srv?.ip) return
        const map: Record<string, string> = { storage: 'setup', backup: 'backup-manage', 'restore-backup': 'restore' }
        await autoSaveCurrentServer()
        waitFor(srv.ip).then(async (ok) => {
          if (ok && map[msg.wizard]) {
            router.push({ name: map[msg.wizard] })
          }
        })
        break
      }
      case 'show_webview':
        await autoSaveCurrentServer()
        router.push({ name: 'houston' })
        break
      case 'reboot_and_show_webview': {
        const srv = getServer()
        if (!srv?.ip) return
        await autoSaveCurrentServer()
        waitFor(srv.ip).then(ok => { if (ok) router.push({ name: 'houston' }) })
        break
      }
    }
  }

  onMounted(() => ipc.addEventListener('action', handleAction))
  onBeforeUnmount(() => ipc.removeEventListener('action', handleAction))
}
