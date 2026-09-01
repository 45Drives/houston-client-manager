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

  /** Setup results relayed by the Cockpit module. The SMB password is never sent. */
  type SetupResult = {
    serverName?: string
    shareName?: string
    smbUser?: string
    setupComplete?: boolean
  }

  /**
   * Auto-save the current server to the credential vault if we have
   * in-memory credentials (from the setup wizard login).
   */
  async function autoSaveCurrentServer(setup?: SetupResult) {
    const srv = getServer()
    if (!srv?.ip) return
    const creds = getCredentials(srv.ip)
    if (!creds?.username || !creds?.password) return

    try {
      await addServer({
        host: srv.ip,
        // A just-completed setup is authoritative; discovery is still reporting pre-setup values.
        shareName: setup?.shareName || srv.shareName || '',
        username: creds.username,
        password: creds.password,
        hostname: setup?.serverName || undefined,
        smbUser: setup?.smbUser || undefined,
        name: srv.name || srv.serverName || setup?.serverName || srv.ip,
        setupComplete: setup?.setupComplete,
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
        const map: Record<string, string> = { storage: 'setup', backup: 'backup-manage', 'restore-backup': 'restore', dashboard: 'dashboard' }
        await autoSaveCurrentServer(msg.setup)
        if (map[msg.wizard]) router.push({ name: map[msg.wizard] })
        break
      }
      case 'reboot_and_show_wizard': {
        const srv = getServer()
        if (!srv?.ip) return
        const map: Record<string, string> = { storage: 'setup', backup: 'backup-manage', 'restore-backup': 'restore', dashboard: 'dashboard' }
        await autoSaveCurrentServer(msg.setup)
        waitFor(srv.ip).then(async (ok) => {
          if (ok && map[msg.wizard]) {
            router.push({ name: map[msg.wizard] })
          }
        })
        break
      }
      case 'show_webview':
        await autoSaveCurrentServer(msg.setup)
        router.push({ name: 'houston' })
        break
      case 'reboot_and_show_webview': {
        const srv = getServer()
        if (!srv?.ip) return
        await autoSaveCurrentServer(msg.setup)
        waitFor(srv.ip).then(ok => { if (ok) router.push({ name: 'houston' }) })
        break
      }
    }
  }

  onMounted(() => ipc.addEventListener('action', handleAction))
  onBeforeUnmount(() => ipc.removeEventListener('action', handleAction))
}
