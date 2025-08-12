// useIpcActions.ts
import { onMounted, onBeforeUnmount } from 'vue'
import { router } from '../../app/routes'
import { IPCRouter } from '@45drives/houston-common-lib'
import { useRebootWatcher } from '../composables/useRebootWatcher'

export function useIpcActions(getServerIp: () => string | undefined) {
  const { waitFor } = useRebootWatcher()
  const ipc = IPCRouter.getInstance()

  function handleAction(raw:any) {
    const msg = typeof raw === 'string' ? JSON.parse(raw) : raw
    switch (msg.type) {
      case 'show_wizard':
      case 'wizard_go_back': {
        const map:Record<string, string> = { storage:'setup', backup:'backup', 'restore-backup':'restore' }
        if (map[msg.wizard]) router.push({ name: map[msg.wizard] })
        break
      }
      case 'reboot_and_show_wizard': {
        const ip = getServerIp()
        if (!ip) return
        const map:Record<string, string> = { storage:'setup', backup:'backup', 'restore-backup':'restore' }
        waitFor(ip).then(ok => { if (ok && map[msg.wizard]) router.push({ name: map[msg.wizard] }) })
        break
      }
      case 'show_webview':
        router.push({ name: 'houston' })
        break
      case 'reboot_and_show_webview': {
        const ip = getServerIp()
        if (!ip) return
        waitFor(ip).then(ok => { if (ok) router.push({ name: 'houston' }) })
        break
      }
    }
  }

  onMounted(() => ipc.addEventListener('action', handleAction))
  onBeforeUnmount(() => ipc.removeEventListener('action', handleAction))
}
