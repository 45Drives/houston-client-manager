// useRebootWatcher.ts
import { ref } from 'vue'
import { Notification, pushNotification, reportError } from '@45drives/houston-common-ui'

export function useRebootWatcher() {
  const waiting = ref(false)
  let lastToastShownIp: string | null = null

  async function waitFor(serverIp: string, timeoutMs = 5 * 60 * 1000) {
    waiting.value = true
    const start = Date.now()
    const sleep = (ms:number) => new Promise(r => setTimeout(r, ms))
    const url = `https://${serverIp}:9090/`
    let serverUp = false
    while (!serverUp && (Date.now() - start) < timeoutMs) {
      try {
        const res = await fetch(url, { method: 'GET', cache: 'no-store' })
        serverUp = res.ok
      } catch {}
      if (!serverUp) await sleep(5000)
      else {
        // double-check after 5s like your original
        await sleep(5000)
        try { serverUp = (await fetch(url, { method: 'GET', cache: 'no-store' })).ok } catch { serverUp = false }
      }
    }
    waiting.value = false
    if (!serverUp) { reportError(new Error('Server did not come back online within timeout.')); return false }

    if (serverIp !== lastToastShownIp) {
      pushNotification(new Notification('Server Available', `${serverIp} is now accessible!`, 'success', 8000))
      lastToastShownIp = serverIp
    }
    return true
  }

  return { waiting, waitFor }
}
